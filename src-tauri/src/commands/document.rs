//! Document commands

use crate::algorithms::calculate_document_priority_score;
use crate::commands::anna_archive::AnnaArchiveClient;
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::kindle_clippings;
use crate::models::{Document, DocumentMetadata, Extract, FileType};
use crate::processor;
use crate::youtube;
use lopdf::{Document as LoDocument, Object};
use std::path::{Path, PathBuf};
use tauri::State;

/// Copy a media file to app-managed storage so it survives macOS sandbox revocation.
/// Returns the destination path.
fn copy_media_to_app_storage(
    app: &tauri::AppHandle,
    source_path: &str,
    subdir: &str,
) -> Result<PathBuf> {
    use tauri::Manager;
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(PlethoraError::NotFound(format!(
            "Source file not found: {}",
            source_path
        )));
    }

    let dest_dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("incrementum").join(subdir))
        .map_err(|e| {
            PlethoraError::Internal(format!("Failed to resolve app data dir: {}", e))
        })?;

    std::fs::create_dir_all(&dest_dir).map_err(|e| {
        PlethoraError::Internal(format!("Failed to create {} directory: {}", subdir, e))
    })?;

    let timestamp = chrono::Utc::now().timestamp();
    let original_filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("media");
    let safe_filename = original_filename.replace(['/', '\\', ':'], "_");
    let stored_filename = format!("{}-{}", timestamp, safe_filename);
    let dest_path = dest_dir.join(&stored_filename);

    std::fs::copy(source, &dest_path)
        .map_err(|e| PlethoraError::Internal(format!("Failed to copy file: {}", e)))?;

    Ok(dest_path)
}

fn build_youtube_thumbnail_url(video_id: &str) -> String {
    format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id)
}

async fn resolve_cover_for_document(
    doc: &Document,
    allow_anna: bool,
) -> Result<(Option<String>, Option<String>)> {
    if let Some(url) = &doc.cover_image_url {
        return Ok((Some(url.clone()), doc.cover_image_source.clone()));
    }

    match doc.file_type {
        FileType::Pdf => {
            if let Ok(Some(url)) = processor::pdf::extract_pdf_cover_data_url(&doc.file_path).await
            {
                return Ok((Some(url), Some("embedded".to_string())));
            }
        }
        FileType::Epub => {
            if let Ok(Some(url)) =
                processor::epub::extract_epub_cover_data_url(&doc.file_path).await
            {
                return Ok((Some(url), Some("embedded".to_string())));
            }
        }
        FileType::Audio => {
            // In-process, ffmpeg-free extraction (lofty). Works on Android,
            // where no ffmpeg sidecar is bundled. Returns `None` for files
            // with no embedded cover (e.g. WAV, or MP3 without APIC), which
            // then falls through to the online lookup below.
            if let Ok(Some((url, _mime))) =
                processor::audio::extract_audio_cover_data_url(&doc.file_path)
            {
                return Ok((Some(url), Some("embedded".to_string())));
            }
        }
        FileType::Youtube => {
            if let Some(video_id) = youtube::extract_video_id(&doc.file_path) {
                return Ok((
                    Some(build_youtube_thumbnail_url(&video_id)),
                    Some("youtube".to_string()),
                ));
            }
        }
        _ => {}
    }

    if allow_anna
        && matches!(
            doc.file_type,
            FileType::Pdf
                | FileType::Epub
                | FileType::Audio
                | FileType::Markdown
                | FileType::Html
                | FileType::Other
        )
    {
        let author = doc.metadata.as_ref().and_then(|meta| meta.author.clone());
        let query = if let Some(author) = author {
            format!("{} {}", doc.title, author)
        } else {
            doc.title.clone()
        };

        if !query.trim().is_empty() {
            let client = AnnaArchiveClient::new();
            if let Ok(results) = client.search_books(&query, 5).await {
                if let Some(result) = results.into_iter().find(|item| {
                    item.cover_url
                        .as_ref()
                        .map(|u| !u.is_empty())
                        .unwrap_or(false)
                }) {
                    return Ok((result.cover_url, Some("anna".to_string())));
                }
            }
        }
    }

    if allow_anna {
        return Ok((None, Some("fallback".to_string())));
    }

    Ok((None, None))
}

#[tauri::command]
pub async fn open_file_picker(
    _title: Option<String>,
    _multiple: Option<bool>,
) -> Result<Vec<String>> {
    // This will be handled by the frontend using Tauri's dialog API
    // The command is a placeholder for future backend processing if needed
    Ok(vec![])
}

#[tauri::command]
pub async fn import_document(
    file_path: String,
    collection_id: Option<String>,
    app: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(PlethoraError::Import(crate::error::ImportError {
            code: crate::error::ImportErrorCode::FileNotFound,
            message: format!("File not found: {}", file_path),
            file_name: Some(file_path),
        }));
    }
    // Canonicalize to resolve symlinks and ..
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| PlethoraError::Internal(format!("Invalid path: {}", e)))?;

    import_from_path(
        canonical.to_string_lossy().to_string(),
        &file_path,
        collection_id,
        &app,
        &repo,
    )
    .await
}

/// Shared import pipeline used by both `import_document` (path-based, desktop)
/// and `import_document_from_bytes` (bytes-based, mobile). Given a readable
/// file on disk at `disk_path` plus the original `file_name` (for type/title
/// detection), extract content and persist the document.
///
/// If the file is detected as a Kindle `My Clippings.txt` (by filename + content
/// sniff), this delegates to the dedicated Kindle parser and returns one
/// (representative) document. Callers that need all the per-book documents
/// (one per book) should use [`import_document_multi`] instead.
async fn import_from_path(
    disk_path: String,
    file_name: &str,
    collection_id: Option<String>,
    app: &tauri::AppHandle,
    repo: &Repository,
) -> Result<Document> {
    let path = Path::new(&disk_path);

    // Kindle `My Clippings.txt` produces many documents (one per book); the
    // generic single-doc path can't represent that. Detect it here and delegate
    // to the dedicated parser, so a `My Clippings.txt` dropped onto the Library
    // no longer lands as a single unreadable `.txt` blob. See
    // `import_document_multi` for the multi-doc-returning variant.
    if kindle_clippings::is_kindle_clippings_path(path) {
        let documents =
            import_kindle_clippings_from_disk(&disk_path, collection_id.clone(), repo).await?;
        if let Some(first) = documents.into_iter().next() {
            return Ok(first);
        }
        // Detection fired but parsing produced no documents (e.g. file had
        // only bookmarks). Fall back to the generic text-import path so the
        // user still gets a document they can open, rather than an error.
    }

    // Determine file type from extension
    let file_type = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("pdf") => FileType::Pdf,
        Some("epub") => FileType::Epub,
        Some("md") | Some("markdown") => FileType::Markdown,
        Some("txt") | Some("text") => FileType::Markdown,
        Some("html") | Some("htm") => FileType::Html,
        Some("mp3") | Some("wav") | Some("m4a") | Some("aac") | Some("ogg") | Some("flac")
        | Some("opus") | Some("m4b") | Some("wma") => FileType::Audio,
        Some("mp4") | Some("webm") | Some("mov") | Some("avi") => FileType::Video,
        _ => FileType::Other,
    };

    let extracted = processor::extract_content(&disk_path, file_type.clone()).await?;

    // Persist the readable file location so viewers can re-open it later.
    // Audio is copied to a dedicated media dir (for macOS sandbox safety); all
    // other types keep the on-disk path they were extracted from. On mobile
    // (import_document_from_bytes) that's the staged temp file under the app's
    // private data dir, which remains readable. Storing the bare filename
    // (as the old code did) left the document unable to be re-opened.
    let stored_path = match file_type {
        FileType::Audio => copy_media_to_app_storage(app, &disk_path, "audio")?
            .to_string_lossy()
            .to_string(),
        _ => disk_path.clone(),
    };

    // Generate content hash for duplicate detection
    let content_hash = if !extracted.text.is_empty() {
        Some(processor::generate_content_hash(&extracted.text))
    } else {
        None
    };

    if let Some(ref hash) = content_hash {
        let existing_docs = repo.list_documents().await?;
        if let Some(duplicate) = existing_docs
            .iter()
            .find(|d| d.content_hash.as_ref() == Some(hash))
        {
            return Err(crate::error::PlethoraError::Import(crate::error::ImportError {
                code: crate::error::ImportErrorCode::DuplicateDocument,
                message: format!(
                    "Duplicate document detected: Already imported as '{}'",
                    duplicate.title
                ),
                file_name: Some(file_name.to_string()),
            }));
        }
    }

    // Use extracted title or fall back to filename
    let title = extracted.title.clone().unwrap_or_else(|| {
        Path::new(file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let metadata = Some(DocumentMetadata {
        author: extracted.author,
        page_count: extracted.page_count.map(|p| p as i32),
        ..Default::default()
    });

    let mut doc = Document::with_collection(title, stored_path, file_type, collection_id.clone());
    doc.content = Some(extracted.text);
    doc.tags = Vec::new();
    doc.content_hash = content_hash;
    doc.total_pages = extracted.page_count.map(|p| p as i32);
    doc.metadata = metadata;
    let (cover_url, cover_source) = resolve_cover_for_document(&doc, false).await?;
    doc.cover_image_url = cover_url;
    doc.cover_image_source = cover_source;

    let created = repo.create_document(&doc).await?;

    Ok(created)
}

/// Shared Kindle-clippings delegation used by both the generic
/// [`import_from_path`] (which returns the first document) and the multi-doc
/// [`import_document_multi`] command. Reads the file once, parses it via the
/// dedicated Kindle pipeline (`do_import_kindle_clippings_from_text`), then
/// fetches the resulting per-book `Document` rows by ID. Returns an empty vec
/// if no importable books were found — callers decide how to surface that.
///
/// The resulting documents use the same synthetic `kindle://<sha256>` path,
/// `category = "Kindle"`, `tags = ["kindle-import"]`, `metadata.source =
/// "kindle-clippings"`, and content-hash dedup as the dedicated Settings →
/// Import/Export Kindle flow, so re-imports and backfill behave identically.
async fn import_kindle_clippings_from_disk(
    disk_path: &str,
    collection_id: Option<String>,
    repo: &Repository,
) -> Result<Vec<Document>> {
    let path = Path::new(disk_path);
    let file_mtime: Option<chrono::DateTime<chrono::Utc>> = std::fs::metadata(disk_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(chrono::DateTime::<chrono::Utc>::from);

    let text = kindle_clippings::read_kindle_text(path)?;

    let result = kindle_clippings::do_import_kindle_clippings_from_text(
        &text,
        repo,
        collection_id,
        file_mtime,
    )
    .await?;

    let mut documents = Vec::with_capacity(result.document_ids.len());
    for id in &result.document_ids {
        if let Some(doc) = repo.get_document(id).await? {
            documents.push(doc);
        }
    }
    Ok(documents)
}

/// Import a file as one or more documents. Used by the frontend Kindle import
/// flow when a `My Clippings.txt` is detected via a generic entry point (drag &
/// drop, main file picker, folder import, paste). Returns one `Document` per
/// book found in the clippings file. For non-Kindle files this returns a single
/// document (delegating to the standard `import_document` path).
#[tauri::command]
pub async fn import_document_multi(
    file_path: String,
    collection_id: Option<String>,
    app: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<Vec<Document>> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(PlethoraError::NotFound(format!(
            "File not found: {}",
            file_path
        )));
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| PlethoraError::Internal(format!("Invalid path: {}", e)))?;
    let disk_path = canonical.to_string_lossy().to_string();

    if kindle_clippings::is_kindle_clippings_path(&canonical) {
        return import_kindle_clippings_from_disk(&disk_path, collection_id, &repo).await;
    }

    // Non-Kindle file: reuse the single-doc path and wrap as a one-element vec
    // so callers can treat the return shape uniformly.
    let doc = import_from_path(disk_path, &file_path, collection_id, &app, &repo).await?;
    Ok(vec![doc])
}

/// Import a document from raw bytes (mobile path). On Android/iOS the WebView's
/// file picker yields content:// URIs that aren't readable as filesystem paths,
/// so the frontend reads the File's bytes and sends them here. We stage the
/// bytes to a temp file in the app's private data dir and reuse the normal
/// extraction pipeline so the document lands in the same SQLite store as
/// desktop imports.
#[tauri::command]
pub async fn import_document_from_bytes(
    app_handle: tauri::AppHandle,
    file_name: String,
    file_bytes: Vec<u8>,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document> {
    use tauri::Manager;
    eprintln!(
        "[mobile-import] received '{}', {} bytes, collection={:?}",
        file_name,
        file_bytes.len(),
        collection_id
    );

    // Stage the bytes under the app's private data dir (writable on Android/iOS,
    // unlike the system data dir returned by dirs::data_dir()).
    let dest_dir = app_handle
        .path()
        .app_data_dir()
        .map(|d| d.join("imports"))
        .map_err(|e| {
            PlethoraError::Internal(format!("Failed to resolve app data dir: {}", e))
        })?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to create imports directory {}: {}",
            dest_dir.display(),
            e
        ))
    })?;

    let timestamp = chrono::Utc::now().timestamp();
    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("import")
        .replace(['/', '\\', ':'], "_");
    let staged_name = format!("{}-{}", timestamp, safe_name);
    let staged_path = dest_dir.join(&staged_name);

    std::fs::write(&staged_path, &file_bytes).map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to stage import file {}: {}",
            staged_path.display(),
            e
        ))
    })?;
    eprintln!("[mobile-import] staged to {}", staged_path.display());

    match import_from_path(
        staged_path.to_string_lossy().to_string(),
        &file_name,
        collection_id,
        &app_handle,
        &repo,
    )
    .await
    {
        Ok(doc) => {
            eprintln!(
                "[mobile-import] success: id={}, title={}",
                doc.id, doc.title
            );
            Ok(doc)
        }
        Err(e) => {
            eprintln!("[mobile-import] FAILED: {:?}", e);
            Err(e)
        }
    }
}

/// Begin streaming a large file to the app's private storage on mobile. Returns
/// the staged path the caller should pass to subsequent `append_import_file_chunk`
/// calls and finally `import_document`.
///
/// Why this exists: Tauri's IPC on Android is JSON-only — `Vec<u8>` args must be
/// sent as a JSON array of numbers (`Array.from(bytes)`), and raw-byte channels
/// (`tauri::ipc::Request`) don't work on Android (see tauri/ipc/mod.rs). For a
/// multi-hundred-MB audiobook that round-trip hangs/OOMs. So the mobile import
/// path streams the file to disk in modest (~256 KB) JSON chunks via these three
/// commands, then imports the staged path normally. Each chunk is small enough
/// that the JSON serialization is fast and bounded.
#[tauri::command]
pub async fn stage_import_file_start(
    app_handle: tauri::AppHandle,
    file_name: String,
) -> Result<String> {
    use tauri::Manager;
    let dest_dir = app_handle
        .path()
        .app_data_dir()
        .map(|d| d.join("imports"))
        .map_err(|e| {
            PlethoraError::Internal(format!("Failed to resolve app data dir: {}", e))
        })?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to create imports directory {}: {}",
            dest_dir.display(),
            e
        ))
    })?;

    let timestamp = chrono::Utc::now().timestamp();
    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("import")
        .replace(['/', '\\', ':'], "_");
    let staged_name = format!("{}-{}", timestamp, safe_name);
    let staged_path = dest_dir.join(&staged_name);

    // Create/truncate the target file so appends start fresh.
    std::fs::File::create(&staged_path).map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to create staged file {}: {}",
            staged_path.display(),
            e
        ))
    })?;

    Ok(staged_path.to_string_lossy().to_string())
}

/// Append a chunk of bytes (already JSON-deserialized into Vec<u8>) to a file
/// previously opened with `stage_import_file_start`. Returns the new total size.
#[tauri::command]
pub async fn append_import_file_chunk(staged_path: String, chunk: Vec<u8>) -> Result<u64> {
    use std::io::Write;
    let path = std::path::Path::new(&staged_path);
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| {
            PlethoraError::Internal(format!(
                "Failed to open staged file for append {}: {}",
                path.display(),
                e
            ))
        })?;
    file.write_all(&chunk).map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to append chunk to {}: {}",
            path.display(),
            e
        ))
    })?;
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(len)
}

#[tauri::command]
pub async fn import_documents(
    file_paths: Vec<String>,
    collection_id: Option<String>,
    app: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<Vec<Document>> {
    let mut imported = Vec::new();

    for file_path in file_paths {
        let path_clone = file_path.clone();
        let coll_id = collection_id.clone();
        match import_document(file_path, coll_id, app.clone(), repo.clone()).await {
            Ok(doc) => imported.push(doc),
            Err(e) => {
                eprintln!("Failed to import {}: {}", path_clone, e);
                // Continue with other files
            }
        }
    }

    Ok(imported)
}

fn pdf_object_to_text(object: &Object) -> Option<String> {
    match object {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
        Object::Name(bytes) => Some(String::from_utf8_lossy(bytes).to_string()),
        _ => None,
    }
}

#[tauri::command]
pub async fn import_pdf_highlights_as_extracts(
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<i32> {
    let document = repo
        .get_document(&document_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Document {} not found", document_id)))?;

    if !matches!(document.file_type, FileType::Pdf) {
        return Err(PlethoraError::InvalidInput(
            "Highlight import is only supported for PDF documents".to_string(),
        ));
    }

    let pdf = LoDocument::load(&document.file_path)
        .map_err(|e| PlethoraError::Internal(format!("Failed to open PDF: {}", e)))?;
    let mut imported_count = 0_i32;

    for (page_number, page_id) in pdf.get_pages() {
        let page_obj = match pdf.get_object(page_id) {
            Ok(obj) => obj,
            Err(_) => continue,
        };
        let page_dict = match page_obj.as_dict() {
            Ok(dict) => dict,
            Err(_) => continue,
        };

        let annots_obj = match page_dict.get(b"Annots") {
            Ok(obj) => obj,
            Err(_) => continue,
        };
        let annots_array = match annots_obj {
            Object::Array(arr) => arr.clone(),
            Object::Reference(reference) => match pdf.get_object(*reference) {
                Ok(Object::Array(arr)) => arr.clone(),
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };

        for annot in annots_array {
            let reference = match annot.as_reference() {
                Ok(reference) => reference,
                Err(_) => continue,
            };
            let annot_obj = match pdf.get_object(reference) {
                Ok(obj) => obj,
                Err(_) => continue,
            };
            let annot_dict = match annot_obj.as_dict() {
                Ok(dict) => dict,
                Err(_) => continue,
            };

            let subtype = annot_dict
                .get(b"Subtype")
                .ok()
                .and_then(pdf_object_to_text)
                .unwrap_or_default();
            let normalized_subtype = subtype.trim_start_matches('/').to_lowercase();
            if !matches!(
                normalized_subtype.as_str(),
                "highlight" | "underline" | "text" | "squiggly"
            ) {
                continue;
            }

            let contents = annot_dict
                .get(b"Contents")
                .ok()
                .and_then(pdf_object_to_text)
                .unwrap_or_else(|| format!("Imported highlight on page {}", page_number));

            let mut extract = Extract::new(document_id.clone(), contents);
            extract.page_number = Some(page_number as i32);
            extract.highlight_color = Some("imported".to_string());
            extract.tags.push("imported-highlight".to_string());
            repo.create_extract(&extract).await?;
            imported_count += 1;
        }
    }

    Ok(imported_count)
}

#[tauri::command]
pub async fn get_documents(
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<Document>> {
    // The library/list UI never renders full document text, so use the summary
    // accessors that NULL out the large content/content_hash/metadata columns
    // to avoid shipping them across IPC. Callers needing the body should use
    // get_document(id), which still loads full content.
    let docs = match collection_id {
        Some(ref cid) => repo.list_documents_summary_by_collection(cid).await?,
        None => repo.list_documents_summary().await?,
    };
    Ok(docs)
}

#[tauri::command]
pub async fn get_document(id: String, repo: State<'_, Repository>) -> Result<Option<Document>> {
    let mut doc = match repo.get_document(&id).await? {
        Some(doc) => doc,
        None => return Ok(None),
    };

    recover_document_content(&mut doc, &repo).await?;

    Ok(Some(doc))
}

fn recover_browser_import_text(doc: &Document) -> Option<String> {
    if !matches!(doc.file_type, FileType::Html) {
        return None;
    }
    let metadata = doc.metadata.as_ref()?;
    if metadata.source.as_deref() != Some("browser_extension") {
        return None;
    }
    let html = metadata.article_html.as_deref()?.trim();
    if html.is_empty() {
        return None;
    }
    let text = processor::html::extract_text_from_html_fragment(html);
    (!text.trim().is_empty()).then_some(text)
}

/// Threshold beyond which a single "line" of content cannot be real prose and
/// must be the pre-block-aware EPUB extractor's output — it joined every
/// chapter's words with single spaces, producing lines of tens of thousands of
/// characters. A real paragraph caps well under 1,000 chars; healthy extracted
/// books max out around 800 chars/line. 5,000 leaves a wide safety margin.
const FLATTENED_LINE_THRESHOLD: usize = 5_000;

/// Minimum total content length before flattening detection engages. Keeps
/// tiny but legitimately single-line documents (a short note, a one-paragraph
/// clipping) from being treated as broken.
const FLATTENED_MIN_TOTAL_CHARS: usize = 2_000;

/// Detects content flattened by the pre-block-aware EPUB extractor: the stored
/// text is non-empty but its longest line is implausibly long (an entire
/// chapter collapsed to one space-joined line). Such content has no line-
/// anchored headings, so `#`-mention resolution finds no body and the model
/// receives no focused context. Re-extraction with the current extractor
/// restores real paragraph/heading structure.
fn content_is_flattened(content: Option<&str>) -> bool {
    let content = match content {
        Some(c) if c.len() >= FLATTENED_MIN_TOTAL_CHARS => c,
        _ => return false,
    };
    // Find the longest line without splitting the whole string (it can be
    // megabytes). Stop as soon as one line exceeds the threshold.
    let mut line_start = 0;
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            if i - line_start > FLATTENED_LINE_THRESHOLD {
                return true;
            }
            line_start = i + 1;
        }
        i += 1;
    }
    // Check the final line.
    bytes.len() - line_start > FLATTENED_LINE_THRESHOLD
}

/// Detects content that should be self-healed — empty text, the legacy EPUB
/// placeholder, a sparse browser import whose full readable body is in
/// `metadata.article_html`, or content that was flattened by the pre-block-aware
/// EPUB extractor (every chapter collapsed to one long line, so headings are
/// invisible to `#`-mention resolution) — and persists the recovered full body.
///
/// This is the single source of truth for content recovery. Both `get_document`
/// and `extract_document_text` run it so they agree on content, which keeps the
/// section tree built for `#` mentions consistent regardless of which command
/// the frontend reached first. Returns `Ok(true)` when content was changed.
pub(crate) async fn recover_document_content(
    doc: &mut Document,
    repo: &Repository,
) -> Result<bool> {
    let content_before = doc.content.clone();

    let has_epub_placeholder = doc
        .content
        .as_ref()
        .map(|content| {
            let normalized = content.trim();
            normalized.starts_with("EPUB file loaded (")
                && normalized.contains(
                    "Full content extraction requires additional EPUB library integration.",
                )
        })
        .unwrap_or(false);

    let is_flattened = content_is_flattened(doc.content.as_deref());

    let needs_content = doc
        .content
        .as_ref()
        .map(|content| content.trim().is_empty())
        .unwrap_or(true)
        || has_epub_placeholder;

    if needs_content {
        if let Some(recovered) = recover_browser_import_text(&doc) {
            let content_hash = Some(processor::generate_content_hash(&recovered));
            repo.update_document_content(
                &doc.id,
                &recovered,
                content_hash.clone(),
                None,
                doc.metadata.clone(),
            )
            .await?;
            doc.content = Some(recovered);
            doc.content_hash = content_hash;
        }
    }

    let needs_content = doc
        .content
        .as_ref()
        .map(|content| content.trim().is_empty())
        .unwrap_or(true)
        || has_epub_placeholder
        || is_flattened;

    // Only re-extract when the source file is still reachable, so a book on an
    // unmounted drive (e.g. /Volumes/external offline) is never wiped — the
    // existing content, even if flattened, is better than none.
    let source_available = Path::new(&doc.file_path).exists();

    if needs_content
        && source_available
        && matches!(
            doc.file_type,
            FileType::Epub | FileType::Markdown | FileType::Html
        )
    {
        if let Ok(extracted) =
            processor::extract_content(&doc.file_path, doc.file_type.clone()).await
        {
            if !extracted.text.trim().is_empty() {
                let content_hash = Some(processor::generate_content_hash(&extracted.text));
                let metadata = Some(DocumentMetadata {
                    author: extracted.author.clone(),
                    language: extracted
                        .metadata
                        .get("language")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string()),
                    page_count: extracted.page_count.map(|p| p as i32),
                    ..Default::default()
                });

                repo.update_document_content(
                    &doc.id,
                    &extracted.text,
                    content_hash.clone(),
                    extracted.page_count.map(|p| p as i32),
                    metadata.clone(),
                )
                .await?;

                doc.content = Some(extracted.text);
                doc.content_hash = content_hash;
                doc.total_pages = extracted.page_count.map(|p| p as i32);
                doc.metadata = metadata;
            }
        }
    }

    // Report whether recovery changed the stored text. Comparing against the
    // snapshot taken on entry is more reliable than inferring from the needs
    // flags (which flip to false once content is healed).
    Ok(content_before.as_deref() != doc.content.as_deref())
}

#[tauri::command]
pub async fn resolve_document_cover(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<Document>> {
    let mut doc = match repo.get_document(&id).await? {
        Some(doc) => doc,
        None => return Ok(None),
    };

    if doc.cover_image_url.is_some() {
        return Ok(Some(doc));
    }

    let (cover_url, cover_source) = resolve_cover_for_document(&doc, true).await?;
    if cover_url.is_some() || cover_source.is_some() {
        repo.update_document_cover(&doc.id, cover_url.clone(), cover_source.clone())
            .await?;
        doc.cover_image_url = cover_url;
        doc.cover_image_source = cover_source;
    }

    Ok(Some(doc))
}

/// Persist a cover image (as a data URL) for a document, used by the frontend
/// PDF-cover renderer. After rendering page 1 to a JPEG in the webview (via
/// `pdfjs-dist`), the frontend sends the data URL here so it is cached in the
/// same `cover_image_url` / `cover_image_source` columns the rest of the cover
/// pipeline uses. `cover_image_source` is set to `"rendered"`.
///
/// A null/empty `cover_image_url` is stored as `None` so callers can clear a
/// stale cover. Only documents without an existing cover are written, matching
/// the `resolve_document_cover` fast path — a present cover is a no-op return.
#[tauri::command]
pub async fn set_document_cover(
    id: String,
    cover_image_url: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<Document>> {
    let doc = match repo.get_document(&id).await? {
        Some(doc) => doc,
        None => return Ok(None),
    };

    // Treat an empty/whitespace string as "no cover" to avoid storing a
    // blank data URL when the renderer bails out.
    let url = cover_image_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if doc.cover_image_url.is_some() {
        // Already has a cover (embedded/youtube/anna/rendered) — keep it.
        return Ok(Some(doc));
    }

    repo.update_document_cover(&doc.id, url.clone(), Some("rendered".to_string()))
        .await?;

    let mut doc = doc;
    doc.cover_image_url = url;
    doc.cover_image_source = Some("rendered".to_string());
    Ok(Some(doc))
}

#[tauri::command]
pub async fn create_document(
    title: String,
    file_path: String,
    file_type: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let file_type = match file_type.as_str() {
        "pdf" => FileType::Pdf,
        "epub" => FileType::Epub,
        "markdown" => FileType::Markdown,
        "html" => FileType::Html,
        "youtube" => FileType::Youtube,
        "audio" => FileType::Audio,
        "video" => FileType::Video,
        "image" => FileType::Image,
        _ => FileType::Other,
    };

    let doc = Document::with_collection(title, file_path, file_type, collection_id);
    let created = repo.create_document(&doc).await?;
    Ok(created)
}

#[tauri::command]
pub async fn update_document(
    id: String,
    updates: Document,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let updated = repo.update_document(&id, &updates).await?;
    Ok(updated)
}

/// Explicitly clear a document's category. `update_document` treats an empty
/// category as "not provided" (partial-update safety), so clearing needs its
/// own path (issue #44 bug 11).
#[tauri::command]
pub async fn clear_document_category(id: String, repo: State<'_, Repository>) -> Result<Document> {
    repo.clear_document_category(&id).await
}

#[tauri::command]
pub async fn update_document_content(
    id: String,
    content: String,
    repo: State<'_, Repository>,
) -> Result<Document> {
    repo.update_document_content(&id, &content, None, None, None)
        .await?;
    repo.get_document(&id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Document {}", id)))
}

#[tauri::command]
pub async fn update_document_priority(
    id: String,
    rating: i32,
    slider: i32,
    repo: State<'_, Repository>,
) -> Result<Document> {
    // The slider is the authoritative priority input. Derive the rating from it
    // so both fields (and the persisted score) stay consistent for any code that
    // still reads the rating. A caller may pass a stale rating; the slider wins.
    let slider_value = slider.clamp(0, 100);
    let rating_value = if slider_value > 0 {
        crate::algorithms::rating_from_slider(slider_value)
    } else if (1..=5).contains(&rating) {
        // Slider explicitly zero but a valid rating supplied: honor the rating
        // (legacy callers) and leave slider at 0 so resolve_priority_slider can
        // re-derive it at read time.
        rating
    } else {
        0
    };
    // The slider is a *position* request, not a stored value: resolve it into
    // an order key that lands the document at that rank in the one global
    // priority queue (see database::priority_rank).
    let score =
        crate::database::priority_rank::key_for_slider(repo.db_pool(), slider_value).await?;

    let updated = repo
        .update_document_priority(&id, rating_value, slider_value, score)
        .await?;
    Ok(updated)
}

/// Update the current page/progress of a document
/// For YouTube videos, this stores the current playback position in seconds
#[tauri::command]
pub async fn update_document_progress(
    id: String,
    current_page: Option<i32>,
    current_scroll_percent: Option<f64>,
    current_cfi: Option<String>,
    current_view_state: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let updated = repo
        .update_document_progress(
            &id,
            current_page,
            current_scroll_percent,
            current_cfi,
            current_view_state,
        )
        .await?;
    Ok(updated)
}

#[derive(serde::Serialize)]
pub struct TextExtractionResult {
    pub content: String,
    pub extracted: bool,
}

/// Extract text content from a document (for documents without content)
/// Returns the extracted text and whether it was newly extracted
#[tauri::command]
pub async fn extract_document_text(
    id: String,
    repo: State<'_, Repository>,
) -> Result<TextExtractionResult> {
    let mut doc = repo.get_document(&id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Document not found: {}", id))
    })?;

    // Heal content the same way `get_document` does before short-circuiting on
    // a non-empty stored value. Without this, a document whose stored content is
    // a legacy EPUB placeholder or a sparse browser-import stub is returned
    // as-is, so the section tree for a `#` mention is built from a short stub
    // while the full body sits one call away. Recovery is a no-op when content
    // is already complete.
    recover_document_content(&mut doc, &repo).await?;

    if let Some(content) = &doc.content {
        if !content.trim().is_empty() {
            return Ok(TextExtractionResult {
                content: content.clone(),
                extracted: false,
            });
        }
    }

    if let FileType::Youtube = doc.file_type {
        if let Some(video_id) = crate::youtube::extract_video_id(&doc.file_path) {
            let cached_transcript = repo
                .get_youtube_transcript_by_video_id(&video_id)
                .await
                .ok()
                .flatten();
            let (transcript, segments_json) = match cached_transcript {
                Some((t, s)) => (t, s),
                None => {
                    // Try to fetch it from YouTube
                    let url_clone = doc.file_path.clone();
                    let segments = tokio::task::spawn_blocking(move || {
                        crate::youtube::extract_transcript(&url_clone, None)
                    })
                    .await
                    .map_err(|e| {
                        crate::error::PlethoraError::Internal(format!(
                            "Failed to join transcript task: {}",
                            e
                        ))
                    })?
                    .map_err(crate::error::PlethoraError::Internal)?;

                    let transcript = crate::youtube::build_transcript_text(&segments);
                    let segments_json = serde_json::to_string(&segments).map_err(|e| {
                        crate::error::PlethoraError::Internal(format!(
                            "Failed to serialize transcript: {}",
                            e
                        ))
                    })?;

                    // Cache it
                    let _ = repo
                        .upsert_youtube_transcript(
                            Some(&doc.id),
                            &video_id,
                            &transcript,
                            &segments_json,
                            crate::youtube::YOUTUBE_WORD_TIMINGS_VERSION,
                        )
                        .await;
                    (transcript, segments_json)
                }
            };

            if !transcript.is_empty() {
                // If there are chapters, let's get them and build a structured transcript with chapters!
                let chapters = repo.get_video_chapters(&doc.id).await.unwrap_or_default();
                let structured_transcript = if !chapters.is_empty() {
                    let segments: Vec<crate::youtube::TranscriptSegment> =
                        serde_json::from_str(&segments_json).unwrap_or_default();
                    crate::youtube::build_transcript_text_with_chapters(&segments, &chapters)
                } else {
                    transcript.clone()
                };

                let content_hash = Some(processor::generate_content_hash(&structured_transcript));
                let mut metadata = doc.metadata.clone().unwrap_or_default();
                metadata.word_count = Some(structured_transcript.split_whitespace().count() as i32);
                metadata.source = Some("youtube".to_string());
                metadata.site_name = Some("YouTube".to_string());
                metadata.fetched_at = Some(chrono::Utc::now());

                repo.update_document_content(
                    &doc.id,
                    &structured_transcript,
                    content_hash,
                    None,
                    Some(metadata),
                )
                .await?;

                return Ok(TextExtractionResult {
                    content: structured_transcript,
                    extracted: true,
                });
            }
        }
    }

    // Skip file-based extraction for URL-based documents (web pages, YouTube, RSS, etc.)
    if doc.file_path.starts_with("http://") || doc.file_path.starts_with("https://") {
        return Ok(TextExtractionResult {
            content: String::new(),
            extracted: false,
        });
    }

    let extracted = processor::extract_content(&doc.file_path, doc.file_type.clone()).await?;

    if extracted.text.trim().is_empty() {
        return Ok(TextExtractionResult {
            content: String::new(),
            extracted: false,
        });
    }

    let content_hash = Some(processor::generate_content_hash(&extracted.text));
    let metadata = Some(DocumentMetadata {
        author: extracted
            .author
            .clone()
            .or(doc.metadata.as_ref().and_then(|m| m.author.clone())),
        language: extracted
            .metadata
            .get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(doc.metadata.as_ref().and_then(|m| m.language.clone())),
        page_count: extracted
            .page_count
            .map(|p| p as i32)
            .or(doc.metadata.as_ref().and_then(|m| m.page_count)),
        source: doc.metadata.as_ref().and_then(|m| m.source.clone()),
        fetched_at: doc.metadata.as_ref().and_then(|m| m.fetched_at),
        site_name: doc.metadata.as_ref().and_then(|m| m.site_name.clone()),
        browser_import_mode: doc
            .metadata
            .as_ref()
            .and_then(|m| m.browser_import_mode.clone()),
        article_html: doc.metadata.as_ref().and_then(|m| m.article_html.clone()),
        extracted_images: doc
            .metadata
            .as_ref()
            .and_then(|m| m.extracted_images.clone()),
        ..Default::default()
    });

    repo.update_document_content(
        &doc.id,
        &extracted.text,
        content_hash.clone(),
        extracted.page_count.map(|p| p as i32),
        metadata.clone(),
    )
    .await?;

    Ok(TextExtractionResult {
        content: extracted.text,
        extracted: true,
    })
}

#[tauri::command]
pub async fn delete_document(id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.delete_document(&id).await?;
    Ok(())
}

#[tauri::command]
pub async fn dismiss_document(
    id: String,
    dismissed: bool,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let updated = repo.update_document_dismiss(&id, dismissed).await?;
    Ok(updated)
}

/// Read a document file and return its RAW BYTES as a binary IPC response
/// (`ArrayBuffer` on the JS side).
///
/// This used to return the file as a base64 JSON string: a 100 MB file became
/// a ~133 MB string materialized in Rust, serialized through the IPC JSON
/// layer, and `atob()`-decoded back into bytes in the webview. Raw responses
/// skip all three steps (design D1 of optimize-performance-hotspots).
///
/// All file I/O is `tokio::fs` (offloaded to the blocking pool internally) so
/// large reads never stall an async runtime worker (design D5).
#[tauri::command]
pub async fn read_document_file(file_path: String) -> Result<tauri::ipc::Response> {
    let canonical = tokio::fs::canonicalize(&file_path)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Invalid path: {}", e)))?;

    // On Android, materializing a large file into a single webview allocation
    // reliably blows the WebView's Java heap (a 142MB podcast previously
    // caused an OutOfMemoryError at launch — raw transfer shrinks the payload
    // vs base64 but the single-allocation risk remains). Refuse files above a
    // conservative threshold so callers fall back to their streaming paths
    // (AudiobookViewer / localMediaSource use the local media server with
    // HTTP Range support; PDF/EPUB viewers accept a file URL). This is a hard
    // backstop — the preferred streaming fixes live in the JS layer.
    #[cfg(target_os = "android")]
    {
        let file_size = tokio::fs::metadata(&canonical)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        const MAX_INLINED_BYTES: u64 = 16 * 1024 * 1024; // 16 MiB
        if file_size > MAX_INLINED_BYTES {
            return Err(PlethoraError::Internal(format!(
                "File too large to read into memory on mobile ({} bytes); use the streaming media server instead. Path: {}",
                file_size,
                canonical.display()
            )));
        }
    }

    // Desktop backstop: the EPUB viewer now streams via the loopback epub_server
    // and the PDF viewer uses convertFileSrc / range reads, so nothing on the
    // desktop hot path should be calling this for a very large file. Refuse
    // files above a generous threshold so any caller that ignores the
    // streaming path fails loudly with an attributed error instead of
    // stalling the webview. Legitimate whole-file callers (collection archive
    // export, app-state export, file-sync registration) stay well under this
    // size; if a real use case crosses it, raise the cap or migrate the
    // caller to streaming. Design reference: openspec/changes/
    // stream-epub-resources/design.md (decision D4).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let file_size = tokio::fs::metadata(&canonical)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        const MAX_DESKTOP_INLINED_BYTES: u64 = 256 * 1024 * 1024; // 256 MiB
        if file_size > MAX_DESKTOP_INLINED_BYTES {
            return Err(PlethoraError::Internal(format!(
                "File too large to read into memory ({} bytes > {} cap); use the streaming server instead. Path: {}",
                file_size,
                MAX_DESKTOP_INLINED_BYTES,
                canonical.display()
            )));
        }
    }

    let bytes = match tokio::fs::read(&canonical).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(crate::error::PlethoraError::NotFound(format!(
                "Document file not found: {}",
                file_path
            )));
        }
        Err(e) => {
            return Err(crate::error::PlethoraError::Internal(format!(
                "Failed to read file: {}",
                e
            )));
        }
    };

    Ok(tauri::ipc::Response::new(bytes))
}

/// Hash a document file (SHA-256) and report its size without base64-encoding
/// the whole file over IPC. Used by the file-sync registration path to compute
/// a manifest entry's contentHash + sizeBytes cheaply.
///
/// Returns `[sha256-hex, size-bytes]`.
#[tauri::command]
pub async fn hash_document_file(file_path: String) -> Result<(String, u64)> {
    use sha2::{Digest, Sha256};

    let canonical = std::fs::canonicalize(&file_path)
        .map_err(|e| PlethoraError::Internal(format!("Invalid path: {}", e)))?;

    let metadata = std::fs::metadata(&canonical)
        .map_err(|e| PlethoraError::Internal(format!("Failed to stat file: {}", e)))?;
    let size = metadata.len();

    let mut file = std::fs::File::open(&canonical)
        .map_err(|e| PlethoraError::Internal(format!("Failed to open file: {}", e)))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|e| PlethoraError::Internal(format!("Failed to hash file: {}", e)))?;
    let hash_bytes = hasher.finalize();
    let hash_hex = hash_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    Ok((hash_hex, size))
}

/// Result from fetching URL content
#[derive(serde::Serialize)]
pub struct FetchedUrlContent {
    pub file_path: String,
    pub file_name: String,
    pub content_type: String,
    /// Final URL after redirects (article-import pipeline: canonicalization
    /// and relative-URL resolution base). `None` for pre-pipeline callers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    /// HTTP status of the final response (2xx here; errors surface as
    /// command errors carrying the status in the message).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Content type from the response headers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_content_type: Option<String>,
    /// Number of redirects followed to reach the final response.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_hops: Option<u32>,
}

/// Maximum response body accepted by `fetch_url_content`. Larger responses
/// are rejected with a typed error before the whole body is buffered.
const FETCH_MAX_BYTES: usize = 15 * 1024 * 1024;
/// Redirect hops beyond this are treated as a loop and the fetch fails.
const MAX_REDIRECT_HOPS: usize = 10;

/// Download core shared by `fetch_url_content` and the unit tests (tests hit a
/// local listener, so the SSRF guard — applied in the command — stays out).
///
/// Enforces the redirect-hop cap and the response-size cap while streaming the
/// body, and returns `(bytes, final_url, status, header_content_type, hops)`.
async fn download_with_caps(
    url: &str,
) -> std::result::Result<(Vec<u8>, String, u16, String, u32), String> {
    let hops = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter = hops.clone();
    let redirect_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("Plethora/1.0 (https://plethora.app)")
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            counter.store(
                attempt.previous().len() as u32,
                std::sync::atomic::Ordering::SeqCst,
            );
            if attempt.previous().len() > MAX_REDIRECT_HOPS {
                attempt.error("too many redirects")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut response = redirect_client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP error: {}", status));
    }

    if let Some(len) = response.content_length() {
        if len as usize > FETCH_MAX_BYTES {
            return Err(format!(
                "RESPONSE_TOO_LARGE: content-length {} exceeds limit of {} bytes",
                len, FETCH_MAX_BYTES
            ));
        }
    }

    let final_url = response.url().to_string();
    let header_content_type = response
        .headers()
        .get("content-type")
        .and_then(|ct| ct.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Stream the body so a lying/absent content-length cannot OOM the app.
    use futures::StreamExt;
    let mut body: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to download content: {}", e))?;
        if body.len() + chunk.len() > FETCH_MAX_BYTES {
            return Err(format!(
                "RESPONSE_TOO_LARGE: body exceeded limit of {} bytes",
                FETCH_MAX_BYTES
            ));
        }
        body.extend_from_slice(&chunk);
    }

    Ok((
        body,
        final_url,
        status.as_u16(),
        header_content_type,
        hops.load(std::sync::atomic::Ordering::SeqCst),
    ))
}

/// Result from converting PDF to HTML
#[derive(serde::Serialize)]
pub struct PdfToHtmlResult {
    /// The generated HTML content
    pub html_content: String,
    /// Path where the HTML file was saved (if save_to_file was true)
    pub saved_path: Option<String>,
    /// The original PDF filename
    pub original_filename: String,
}

/// Convert a PDF document to HTML format for better text selection and extraction
/// This creates a structured HTML document that preserves the text content with proper styling
#[tauri::command]
pub async fn convert_pdf_to_html(
    file_path: String,
    save_to_file: Option<bool>,
    output_path: Option<String>,
) -> Result<PdfToHtmlResult> {
    use std::path::Path;

    let path = Path::new(&file_path);
    let original_filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf")
        .to_string();

    // Convert PDF to HTML
    let html_content = processor::pdf::convert_pdf_to_html(&file_path).await?;

    // Optionally save to file
    let saved_path = if save_to_file.unwrap_or(false) {
        Some(processor::pdf::save_pdf_as_html(&file_path, output_path.as_deref()).await?)
    } else {
        None
    };

    Ok(PdfToHtmlResult {
        html_content,
        saved_path,
        original_filename,
    })
}

/// Convert a PDF document by ID to HTML format
#[tauri::command]
pub async fn convert_document_pdf_to_html(
    id: String,
    save_to_file: Option<bool>,
    output_path: Option<String>,
    repo: State<'_, Repository>,
) -> Result<PdfToHtmlResult> {
    use std::path::Path;

    let doc = repo.get_document(&id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Document not found: {}", id))
    })?;

    // Verify it's a PDF
    if !matches!(doc.file_type, FileType::Pdf) {
        return Err(crate::error::PlethoraError::Internal(
            "Document is not a PDF".to_string(),
        ));
    }

    let path = Path::new(&doc.file_path);
    let original_filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf")
        .to_string();

    // Convert PDF to HTML
    let html_content = processor::pdf::convert_pdf_to_html(&doc.file_path).await?;

    // Optionally save to file
    let saved_path = if save_to_file.unwrap_or(false) {
        Some(processor::pdf::save_pdf_as_html(&doc.file_path, output_path.as_deref()).await?)
    } else {
        None
    };

    Ok(PdfToHtmlResult {
        html_content,
        saved_path,
        original_filename,
    })
}

/// Fetch a web page preview (title, description, favicon) for URL import
#[tauri::command]
pub async fn fetch_web_page_preview(url: String) -> Result<serde_json::Value> {
    use regex::Regex;

    crate::security::validate_url_not_private(&url)
        .map_err(|e| PlethoraError::Internal(format!("URL not allowed: {}", e)))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Plethora/1.0 (https://plethora.app)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()).into());
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let title = Regex::new(r"<title[^>]*>([^<]+)</title>")
        .ok()
        .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
        .unwrap_or_default();

    // Extract meta description (prefer og:description)
    let description = Regex::new(
        r#"<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']+)["']"#,
    )
    .ok()
    .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    .or_else(|| {
        Regex::new(r#"<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']description["']"#)
            .ok()
            .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    })
    .or_else(|| {
        Regex::new(r#"<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']+)["']"#)
            .ok()
            .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    })
    .unwrap_or_default();

    let image = Regex::new(
        r#"<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']"#,
    )
    .ok()
    .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    .or_else(|| {
        Regex::new(
            r#"<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']"#,
        )
        .ok()
        .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    });

    let favicon = Regex::new(
        r#"<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']"#,
    )
    .ok()
    .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    .or_else(|| {
        Regex::new(
            r#"<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'][^"']*icon[^"']*["']"#,
        )
        .ok()
        .and_then(|re| re.captures(&body).map(|c| c[1].trim().to_string()))
    })
    .map(|href| {
        if href.starts_with("http://") || href.starts_with("https://") {
            href
        } else if href.starts_with("//") {
            format!("https:{}", href)
        } else {
            url.parse::<reqwest::Url>()
                .ok()
                .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or("")))
                .map(|base| {
                    format!(
                        "{}/{}",
                        base.trim_end_matches('/'),
                        href.trim_start_matches('/')
                    )
                })
                .unwrap_or(href)
        }
    });

    Ok(serde_json::json!({
        "url": url,
        "title": title,
        "description": description,
        "image": image,
        "favicon": favicon,
    }))
}

/// Fetch content from a URL and save it to a temporary location
/// Used for Arxiv PDF downloads and URL-based imports, and by the article
/// import pipeline (which additionally consumes `final_url`/`status`/
/// `header_content_type`/`redirect_hops`).
#[tauri::command]
pub async fn fetch_url_content(url: String) -> Result<FetchedUrlContent> {
    use reqwest;
    use std::time::Duration;

    crate::security::validate_url_not_private(&url)
        .map_err(|e| PlethoraError::Internal(format!("URL not allowed: {}", e)))?;

    let url_parsed = url
        .parse::<reqwest::Url>()
        .map_err(|e| crate::error::PlethoraError::Internal(format!("Invalid URL: {}", e)))?;

    let file_name = url_parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or("download")
        .to_string();

    // Determine content type from URL extension
    let content_type = if file_name.ends_with(".pdf") {
        "pdf"
    } else if file_name.ends_with(".epub") {
        "epub"
    } else if file_name.ends_with(".md") || file_name.ends_with(".markdown") {
        "markdown"
    } else if file_name.ends_with(".html") || file_name.ends_with(".htm") {
        "html"
    } else {
        // Try to determine from content type header
        "unknown"
    };

    let temp_dir = std::env::temp_dir();
    let download_dir = temp_dir.join("incrementum-downloads");

    std::fs::create_dir_all(&download_dir).map_err(|e| {
        crate::error::PlethoraError::Internal(format!(
            "Failed to create download directory: {}",
            e
        ))
    })?;

    // Generate a unique filename
    let timestamp = chrono::Utc::now().timestamp();
    let unique_filename = format!("{}-{}", timestamp, file_name);
    let file_path = download_dir.join(&unique_filename);

    // Download the file (client construction, redirect policy, and size cap
    // all live in download_with_caps)
    let (bytes, final_url, status, header_content_type, redirect_hops) = download_with_caps(&url)
        .await
        .map_err(crate::error::PlethoraError::Internal)?;

    let final_content_type = if content_type == "unknown" {
        header_content_type.clone()
    } else {
        content_type.to_string()
    };

    std::fs::write(&file_path, &bytes).map_err(|e| {
        crate::error::PlethoraError::Internal(format!("Failed to save downloaded file: {}", e))
    })?;

    Ok(FetchedUrlContent {
        file_path: file_path.to_string_lossy().to_string(),
        file_name,
        content_type: final_content_type,
        final_url: Some(final_url),
        status: Some(status),
        header_content_type: Some(header_content_type),
        redirect_hops: Some(redirect_hops),
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Article import: pipeline persistence + dedupe (design D10)
// ──────────────────────────────────────────────────────────────────────────

/// Persist a pipeline-imported article: content + metadata (with webArticle
/// provenance) + canonical source_url + cover image in one UPDATE.
#[tauri::command]
pub async fn update_web_article(
    id: String,
    content: String,
    metadata: DocumentMetadata,
    source_url: Option<String>,
    cover_image_url: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document> {
    repo.update_web_article(
        &id,
        &content,
        &metadata,
        source_url.as_deref(),
        cover_image_url.as_deref(),
    )
    .await?;
    repo.get_document(&id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Document {}", id)))
}

/// Canonical-URL dedupe lookup: earliest document id with this source_url.
#[tauri::command]
pub async fn find_document_id_by_source_url(
    source_url: String,
    repo: State<'_, Repository>,
) -> Result<Option<String>> {
    repo.find_document_id_by_source_url(&source_url).await
}

// ──────────────────────────────────────────────────────────────────────────
// Article import: raw-source snapshots (design D10)
// ──────────────────────────────────────────────────────────────────────────

/// Raw HTML beyond this size is not snapshotted (reported as skipped).
const SNAPSHOT_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshotResult {
    /// False when the snapshot was skipped (oversize / unreadable source).
    pub stored: bool,
    pub skipped_reason: Option<String>,
    pub path: Option<String>,
    pub sha256: Option<String>,
    pub raw_bytes: Option<u64>,
    pub gzip_bytes: Option<u64>,
}

fn source_snapshot_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PlethoraError::Internal(format!("Failed to resolve app data dir: {}", e)))?
        .join("source-snapshots");
    std::fs::create_dir_all(&dir).map_err(|e| {
        PlethoraError::Internal(format!("Failed to create source-snapshots dir: {}", e))
    })?;
    Ok(dir)
}

/// Keep only `[A-Za-z0-9_-]` in a document id for use as a file name;
/// anything else collapses to a hex digest so a hostile id can never escape
/// the snapshot directory.
fn safe_snapshot_stem(document_id: &str) -> String {
    let cleaned: String = document_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.len() >= 8 && cleaned == document_id {
        cleaned
    } else {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(document_id.as_bytes());
        format!("doc-{:x}", hasher.finalize())
    }
}

/// Testable core: gzip `raw` into `dir/{document_id}.html.gz` and return the
/// destination path, sha256 of the raw bytes, and the compressed size.
fn write_snapshot_to_dir(
    dir: &Path,
    document_id: &str,
    raw: &[u8],
) -> Result<(PathBuf, String, u64)> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    let dest = dir.join(format!("{}.html.gz", safe_snapshot_stem(document_id)));
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(raw)
        .map_err(|e| PlethoraError::Internal(format!("Failed to compress snapshot: {}", e)))?;
    let compressed = encoder.finish().map_err(|e| {
        PlethoraError::Internal(format!("Failed to finish snapshot gzip: {}", e))
    })?;
    std::fs::write(&dest, &compressed)
        .map_err(|e| PlethoraError::Internal(format!("Failed to write snapshot file: {}", e)))?;

    let mut hasher = Sha256::new();
    hasher.update(raw);
    let sha = format!("{:x}", hasher.finalize());
    Ok((dest, sha, compressed.len() as u64))
}

/// Store a gzip snapshot of a fetched page's raw HTML for future
/// re-extraction. The bytes are read from the temp file `fetch_url_content`
/// already wrote — no multi-MB payload crosses the (JSON, on Android) IPC.
#[tauri::command]
pub async fn store_source_snapshot(
    app: tauri::AppHandle,
    document_id: String,
    source_path: String,
) -> Result<SourceSnapshotResult> {
    let dir = source_snapshot_dir(&app)?;
    store_source_snapshot_to_dir(&dir, &document_id, &source_path)
}

fn store_source_snapshot_to_dir(
    dir: &Path,
    document_id: &str,
    source_path: &str,
) -> Result<SourceSnapshotResult> {
    let path = Path::new(source_path);
    let raw_len = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(e) => {
            return Ok(SourceSnapshotResult {
                stored: false,
                skipped_reason: Some(format!("source file unreadable: {}", e)),
                path: None,
                sha256: None,
                raw_bytes: None,
                gzip_bytes: None,
            });
        }
    };
    if raw_len > SNAPSHOT_MAX_BYTES {
        return Ok(SourceSnapshotResult {
            stored: false,
            skipped_reason: Some(format!(
                "raw source {} bytes exceeds snapshot cap of {} bytes",
                raw_len, SNAPSHOT_MAX_BYTES
            )),
            path: None,
            sha256: None,
            raw_bytes: Some(raw_len),
            gzip_bytes: None,
        });
    }

    let raw = std::fs::read(path).map_err(|e| {
        PlethoraError::Internal(format!("Failed to read source for snapshot: {}", e))
    })?;
    let (dest, sha, gzip_len) = write_snapshot_to_dir(dir, document_id, &raw)?;
    Ok(SourceSnapshotResult {
        stored: true,
        skipped_reason: None,
        path: Some(dest.to_string_lossy().to_string()),
        sha256: Some(sha),
        raw_bytes: Some(raw.len() as u64),
        gzip_bytes: Some(gzip_len),
    })
}

/// Delete the snapshots of specific documents (retention setting off,
/// document deleted).
#[tauri::command]
pub async fn delete_source_snapshots(
    app: tauri::AppHandle,
    document_ids: Vec<String>,
) -> Result<u32> {
    let dir = source_snapshot_dir(&app)?;
    let mut removed = 0u32;
    for id in &document_ids {
        let dest = dir.join(format!("{}.html.gz", safe_snapshot_stem(id)));
        if dest.exists() && std::fs::remove_file(&dest).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Remove snapshots older than `max_age_days` (retention cleanup pass).
#[tauri::command]
pub async fn cleanup_source_snapshots(app: tauri::AppHandle, max_age_days: i64) -> Result<u32> {
    let dir = source_snapshot_dir(&app)?;
    let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days.max(0));
    Ok(cleanup_snapshots_in_dir(&dir, cutoff.timestamp()))
}

fn cleanup_snapshots_in_dir(dir: &Path, cutoff_unix_secs: i64) -> u32 {
    let mut removed = 0u32;
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("gz") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if modified < cutoff_unix_secs {
                if std::fs::remove_file(&path).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    removed
}

#[cfg(test)]
mod browser_import_recovery_tests {
    use super::*;

    fn html_document(source: Option<&str>, article_html: Option<&str>) -> Document {
        let mut doc = Document::new(
            "Legacy browser import".to_string(),
            "https://example.com/article".to_string(),
            FileType::Html,
        );
        doc.content = Some(String::new());
        doc.metadata = Some(DocumentMetadata {
            source: source.map(str::to_string),
            article_html: article_html.map(str::to_string),
            ..Default::default()
        });
        doc
    }

    #[test]
    fn recovers_empty_browser_import_from_document_owned_html() {
        let doc = html_document(
            Some("browser_extension"),
            Some("<article><h1>Recovered</h1><p>Durable article body.</p></article>"),
        );
        let recovered = recover_browser_import_text(&doc).expect("recoverable text");
        assert!(recovered.contains("Recovered"));
        assert!(recovered.contains("Durable article body."));
    }

    #[test]
    fn does_not_recover_untrusted_non_extension_html() {
        let doc = html_document(None, Some("<p>Could be unrelated metadata.</p>"));
        assert!(recover_browser_import_text(&doc).is_none());
    }

    // The two Tauri commands that return document text — `get_document` and
    // `extract_document_text` — both run `recover_document_content`. This test
    // pins that the shared helper heals a sparse browser import (empty content
    // with the full readable body in `metadata.article_html`) so the two
    // commands agree, which is what keeps the `#`-mention section tree from
    // being built against a short stub while the full body is one call away.
    #[tokio::test]
    async fn recover_document_content_heals_sparse_browser_import() {
        let db = crate::database::Database::new(std::path::PathBuf::from(":memory:"))
            .await
            .expect("db");
        db.migrate().await.expect("migrate");
        let repo = crate::database::Repository::new(db.pool().clone());

        let mut doc = html_document(
            Some("browser_extension"),
            Some("<article><h1>Recovered</h1><p>Full readable article body.</p></article>"),
        );
        // create_document assigns the canonical id we heal against.
        doc = repo.create_document(&doc).await.expect("create document");

        let changed = recover_document_content(&mut doc, &repo)
            .await
            .expect("recover");
        assert!(changed, "sparse browser import should be healed");
        assert!(
            doc.content
                .as_deref()
                .map(|c| c.contains("Full readable article body"))
                .unwrap_or(false),
            "healed content should carry the readable body"
        );

        // A fresh load (simulating `extract_document_text`'s second read) must
        // now see the healed full body, not the original empty content — the
        // parity guarantee between the two commands.
        let mut reloaded = repo
            .get_document(&doc.id)
            .await
            .expect("reload")
            .expect("present");
        assert!(
            reloaded
                .content
                .as_deref()
                .map(|c| c.contains("Full readable article body"))
                .unwrap_or(false),
            "healed content must be persisted for the next command to read"
        );

        let changed_again = recover_document_content(&mut reloaded, &repo)
            .await
            .expect("repeat recovery");
        assert!(!changed_again, "a healed browser import should be idempotent");
    }

    #[test]
    fn does_not_recover_browser_import_without_article_html() {
        let doc = html_document(Some("browser_extension"), None);
        assert!(recover_browser_import_text(&doc).is_none());
    }

    #[test]
    fn content_is_flattened_detects_old_extractor_output() {
        // A whole chapter joined to one line by the old space-collapsing
        // extractor — tens of thousands of chars between newlines.
        let flattened = format!(
            "Title\n{}\nNext chapter\n{}",
            "word ".repeat(4000),
            "word ".repeat(4000)
        );
        assert!(content_is_flattened(Some(&flattened)));

        // A healthy extraction: many paragraphs, each well under the threshold.
        let healthy = (0..200)
            .map(|i| format!("Paragraph {i} with a normal sentence of prose."))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!content_is_flattened(Some(&healthy)));

        // Below the minimum total length: never flagged, even if single-line.
        assert!(!content_is_flattened(Some("short single-line note")));
        assert!(!content_is_flattened(None));
    }
}

#[cfg(test)]
mod article_import_backend_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// One scripted HTTP response: status line, extra headers, body.
    struct TestResponse {
        status: &'static str,
        headers: Vec<String>,
        body: Vec<u8>,
        /// When set, emit this Content-Length instead of the body length
        /// (server-lying-header tests).
        content_length_override: Option<u64>,
        /// Emit no Content-Length at all (EOF-delimited body streaming).
        no_content_length: bool,
    }

    impl TestResponse {
        fn ok(body: &str) -> Self {
            TestResponse {
                status: "200 OK",
                headers: vec!["Content-Type: text/html; charset=utf-8".to_string()],
                body: body.as_bytes().to_vec(),
                content_length_override: None,
                no_content_length: false,
            }
        }
        fn redirect(location: &str) -> Self {
            TestResponse {
                status: "302 Found",
                headers: vec![format!("Location: {}", location)],
                body: Vec::new(),
                content_length_override: None,
                no_content_length: false,
            }
        }
    }

    /// Minimal hermetic HTTP/1.1 server: routes by path via `handler`,
    /// serving up to `max_requests` requests on the listener thread.
    fn spawn_test_server<F>(handler: F, max_requests: usize) -> String
    where
        F: Fn(&str) -> TestResponse + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        let handler = std::sync::Arc::new(handler);
        std::thread::spawn(move || {
            for stream in listener.incoming().take(max_requests) {
                let mut stream = match stream {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let mut buf = [0u8; 8192];
                // Read until end of headers (tests never send a body).
                let mut raw = Vec::new();
                loop {
                    match stream.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            raw.extend_from_slice(&buf[..n]);
                            if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.len() > 65536 {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let request = String::from_utf8_lossy(&raw).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let resp = handler(&path);
                let mut out = format!("HTTP/1.1 {}\r\n", resp.status);
                for h in &resp.headers {
                    out.push_str(h);
                    out.push_str("\r\n");
                }
                if !resp.no_content_length {
                    let len = resp
                        .content_length_override
                        .unwrap_or(resp.body.len() as u64);
                    out.push_str(&format!("Content-Length: {}\r\n", len));
                }
                out.push_str("Connection: close\r\n\r\n");
                let _ = stream.write_all(out.as_bytes());
                let _ = stream.write_all(&resp.body);
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }

    #[tokio::test]
    async fn download_resolves_redirects_and_counts_hops() {
        let base = spawn_test_server(
            |path| {
                if path == "/start" {
                    TestResponse::redirect("/middle")
                } else if path == "/middle" {
                    TestResponse::redirect("/final")
                } else {
                    TestResponse::ok("<html><body>final page</body></html>")
                }
            },
            3,
        );
        let (bytes, final_url, status, content_type, hops) =
            download_with_caps(&format!("{}/start", base))
                .await
                .expect("download");
        assert!(final_url.ends_with("/final"), "final url: {}", final_url);
        assert_eq!(status, 200);
        assert_eq!(hops, 2);
        assert!(content_type.starts_with("text/html"));
        assert!(String::from_utf8(bytes).unwrap().contains("final page"));
    }

    #[tokio::test]
    async fn download_rejects_http_error_status() {
        let base = spawn_test_server(
            |_path| TestResponse {
                status: "403 Forbidden",
                headers: vec!["Content-Type: text/html".to_string()],
                body: b"<html>paywall</html>".to_vec(),
                content_length_override: None,
                no_content_length: false,
            },
            1,
        );
        let err = download_with_caps(&base).await.expect_err("must fail");
        assert!(err.contains("HTTP error: 403"), "error was: {}", err);
    }

    #[tokio::test]
    async fn download_rejects_oversized_content_length() {
        let base = spawn_test_server(
            |_path| TestResponse {
                status: "200 OK",
                headers: vec!["Content-Type: application/octet-stream".to_string()],
                body: Vec::new(),
                // Server lies with an oversized Content-Length up front.
                content_length_override: Some(FETCH_MAX_BYTES as u64 + 1),
                no_content_length: false,
            },
            1,
        );
        let err = download_with_caps(&base).await.expect_err("must fail");
        assert!(err.contains("RESPONSE_TOO_LARGE"), "error was: {}", err);
    }

    #[tokio::test]
    async fn download_enforces_streamed_size_cap_without_content_length() {
        // 15 MB + 1 KB streamed with NO content-length header (EOF-delimited),
        // so only the running body cap can catch it.
        let oversize_body = vec![b'x'; FETCH_MAX_BYTES + 1024];
        let base = spawn_test_server(
            move |_path| TestResponse {
                status: "200 OK",
                headers: vec!["Content-Type: application/octet-stream".to_string()],
                body: oversize_body.clone(),
                content_length_override: None,
                no_content_length: true,
            },
            1,
        );
        let err = download_with_caps(&base).await.expect_err("must fail");
        assert!(err.contains("RESPONSE_TOO_LARGE"), "error was: {}", err);
    }

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "incrementum-test-{}-{}-{}",
            tag,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn snapshot_round_trip_digest_and_gzip() {
        let dir = unique_temp_dir("snapshot");
        let src_dir = unique_temp_dir("snapshot-src");
        // Large enough that gzip overhead can't dominate — real pages compress.
        let paragraph = "<p>The quick brown fox jumps over the lazy dog and keeps running through the meadow.</p>\n";
        let raw = format!(
            "<html><body><h1>Hello</h1>{}</body></html>",
            paragraph.repeat(600)
        )
        .into_bytes();
        let src = src_dir.join("raw.html");
        std::fs::write(&src, &raw).expect("write raw");

        let result =
            store_source_snapshot_to_dir(&dir, "doc-abc-123", src.to_str().unwrap()).expect("ok");
        assert!(result.stored);
        assert_eq!(result.raw_bytes, Some(raw.len() as u64));
        assert!(result.gzip_bytes.unwrap() > 0);
        assert!(result.gzip_bytes.unwrap() < raw.len() as u64);

        let dest = PathBuf::from(result.path.clone().unwrap());
        assert!(dest.exists(), "snapshot written to {:?}", dest);
        assert!(dest.to_string_lossy().contains("doc-abc-123.html.gz"));

        // Digest matches sha256 of the raw bytes.
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&raw);
        assert_eq!(result.sha256.unwrap(), format!("{:x}", hasher.finalize()));

        // Decompress and compare — round-trip integrity.
        let compressed = std::fs::read(&dest).expect("read snapshot");
        let mut decoder = flate2::read::GzDecoder::new(&compressed[..]);
        let mut round_tripped = Vec::new();
        decoder.read_to_end(&mut round_tripped).expect("gunzip");
        assert_eq!(round_tripped, raw);

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&src_dir).ok();
    }

    #[test]
    fn snapshot_skips_oversize_source() {
        let dir = unique_temp_dir("snapshot-skip");
        let src_dir = unique_temp_dir("snapshot-skip-src");
        let src = src_dir.join("big.html");
        std::fs::write(&src, vec![b'a'; 5 * 1024 * 1024 + 1]).expect("write big");

        let result =
            store_source_snapshot_to_dir(&dir, "doc-big", src.to_str().unwrap()).expect("ok");
        assert!(!result.stored);
        assert!(result
            .skipped_reason
            .unwrap()
            .contains("exceeds snapshot cap"));
        assert_eq!(result.raw_bytes, Some(5 * 1024 * 1024 as u64 + 1));

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&src_dir).ok();
    }

    #[test]
    fn snapshot_rejects_hostile_document_ids() {
        let stem = safe_snapshot_stem("../../etc/passwd");
        assert!(!stem.contains('/'));
        assert!(!stem.contains(".."));
        assert!(stem.starts_with("doc-"));
        // Plain uuid-like ids pass through untouched.
        assert_eq!(safe_snapshot_stem("01234567-abcd"), "01234567-abcd");
    }

    #[test]
    fn cleanup_removes_only_stale_snapshots() {
        let dir = unique_temp_dir("snapshot-cleanup");
        let src_dir = unique_temp_dir("snapshot-cleanup-src");
        let src = src_dir.join("raw.html");
        std::fs::write(&src, b"<html></html>").expect("write raw");

        let fresh = store_source_snapshot_to_dir(&dir, "fresh-doc", src.to_str().unwrap())
            .expect("ok")
            .path
            .unwrap();
        let stale = store_source_snapshot_to_dir(&dir, "stale-doc", src.to_str().unwrap())
            .expect("ok")
            .path
            .unwrap();

        // Age the stale snapshot by 200 days.
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(200 * 86_400);
        let f = std::fs::File::options()
            .write(true)
            .open(&stale)
            .expect("open");
        f.set_times(std::fs::FileTimes::new().set_modified(old))
            .expect("set mtime");

        let removed = cleanup_snapshots_in_dir(&dir, chrono::Utc::now().timestamp());
        assert_eq!(removed, 1);
        assert!(!PathBuf::from(&stale).exists());
        assert!(PathBuf::from(&fresh).exists());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&src_dir).ok();
    }
}

/// Sweep unreferenced staged import files older than 24 hours from app_data_dir/imports/
pub fn sweep_stale_staging_files(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(data_dir) = app.path().app_data_dir() {
        let imports_dir = data_dir.join("imports");
        if imports_dir.is_dir() {
            let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(24 * 60 * 60);
            if let Ok(entries) = std::fs::read_dir(&imports_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(meta) = path.metadata() {
                            if let Ok(modified) = meta.modified() {
                                if modified < cutoff {
                                    let _ = std::fs::remove_file(&path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
