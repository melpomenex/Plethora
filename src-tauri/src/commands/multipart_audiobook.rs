//! Multi-file audiobook import (openspec change
//! fix-multipart-audiobook-language-gating-and-entitlement-persistence).
//!
//! A directory representing one audiobook must become ONE library document
//! with an ordered, ready Audio Edition whose sections are the physical
//! chapter files — never N separate documents. This command owns the whole
//! semantic unit: probe tags → fingerprint → dedup → stage every part →
//! create document + edition + sections in ONE transaction, cleaning up
//! staged files on failure.

use crate::commands::document::stage_media_file_unique;
use crate::database::{AudioEditionRepository, Repository};
use crate::error::{PlethoraError, Result};
use crate::models::audio_edition::{AudioEdition, AudioEditionSection};
use crate::models::{Document, DocumentMetadata, FileType};
use crate::processor::audio::{extract_audio_cover_data_url, probe_audio_metadata, AudioMetadataProbe};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, State};

/// One physical chapter file of a multi-file audiobook.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartPartInput {
    pub path: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartImportResult {
    pub document: Document,
    pub edition_id: String,
    pub section_count: usize,
    /// True when the fingerprint matched an existing logical audiobook and no
    /// new document was created.
    pub deduplicated: bool,
    /// True when local media (edition/sections/files) was attached to an
    /// existing document row that lacked it (the cross-device synced-row case).
    pub attached_to_existing: bool,
}

/// In-flight fingerprint set: concurrent imports of the same book are
/// serialized so the check-then-insert dedup cannot race itself.
fn in_flight_fingerprints() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Natural (numeric-aware) comparison so "2" sorts before "10".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ia = a.char_indices().peekable();
    let mut ib = b.char_indices().peekable();
    loop {
        match (ia.peek(), ib.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(&(i, ca)), Some(&(j, cb))) => {
                let a_digits = ca.is_ascii_digit();
                let b_digits = cb.is_ascii_digit();
                if a_digits && b_digits {
                    let a_run: String = a[i..].chars().take_while(|c| c.is_ascii_digit()).collect();
                    let b_run: String = b[j..].chars().take_while(|c| c.is_ascii_digit()).collect();
                    let na = a_run.trim_start_matches('0');
                    let nb = b_run.trim_start_matches('0');
                    let ord = na
                        .len()
                        .cmp(&nb.len())
                        .then_with(|| na.cmp(nb))
                        .then_with(|| a_run.len().cmp(&b_run.len()));
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                    // Skip both digit runs entirely.
                    while ia.peek().is_some_and(|&(_, c)| c.is_ascii_digit()) {
                        ia.next();
                    }
                    while ib.peek().is_some_and(|&(_, c)| c.is_ascii_digit()) {
                        ib.next();
                    }
                } else {
                    let ord = ca
                        .to_ascii_lowercase()
                        .cmp(&cb.to_ascii_lowercase());
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                    ia.next();
                    ib.next();
                }
            }
        }
    }
}

fn display_name(part: &MultipartPartInput) -> String {
    if let Some(name) = part.file_name.as_deref().filter(|s| !s.is_empty()) {
        return name.to_string();
    }
    if let Some(rel) = part.relative_path.as_deref().filter(|s| !s.is_empty()) {
        if let Some(name) = rel.rsplit(['/', '\\']).next() {
            return name.to_string();
        }
    }
    part.path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&part.path)
        .to_string()
}

fn stem_of(name: &str) -> &str {
    match name.rfind('.') {
        Some(idx) if idx > 0 => &name[..idx],
        _ => name,
    }
}

/// Chapter title from a file name: strip obvious numbering
/// ("004 - The Troll.mp3" → "The Troll"); trailing bare numbers stay.
fn chapter_title_from_file_name(name: &str) -> String {
    let base = stem_of(name);
    let stripped = base
        .trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start();
    let stripped = stripped
        .trim_start_matches(['-', '–', '—', ':', '.', '_'])
        .trim_start();
    // Trailing part number behind an explicit separator only ("Title - 03").
    let trimmed = if let Some(idx) = stripped.rfind(['-', '–', '—', ':']) {
        let tail = &stripped[idx + 1..].trim();
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            stripped[..idx].trim_end()
        } else {
            stripped
        }
    } else {
        stripped
    };
    let cleaned = trimmed.trim();
    if cleaned.is_empty() {
        base.trim().to_string()
    } else {
        cleaned.to_string()
    }
}

/// Normalized basename for fingerprinting: lowercase, alphanumerics only, so
/// moved files, staging renames, and unicode variants compare stably.
fn normalized_basename(name: &str) -> String {
    stem_of(name)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn audio_mime_for(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mp3",
        "m4b" | "m4a" | "mp4" => "audio/mp4",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "wma" => "audio/x-ms-wma",
        _ => "audio/mpeg",
    }
    .to_string()
}

/// Per-part fingerprint identity: normalized basename + size; duration (rounded
/// to the nearest second) is included only when probing succeeded, so a
/// partially-probed import still matches a fully-probed one.
fn part_identity(part: &MultipartPartInput, probe: &AudioMetadataProbe, size_bytes: u64) -> String {
    let name = normalized_basename(&display_name(part));
    match probe.duration_sec {
        Some(duration) if duration.is_finite() && duration > 0.0 => {
            format!("{name}|{size_bytes}|{}", duration.round() as i64)
        }
        _ => format!("{name}|{size_bytes}"),
    }
}

fn fingerprint_of(identities: &[String]) -> String {
    let mut hasher = Sha256::new();
    for identity in identities {
        hasher.update(identity.as_bytes());
        hasher.update(b"\n");
    }
    hex::encode(hasher.finalize())
}

/// Prefer the embedded album/artist when EVERY part agrees on it.
fn consistent(values: Vec<Option<String>>) -> Option<String> {
    let mut iter = values.into_iter().flatten();
    let first = iter.next()?;
    if iter.all(|v| v == first) {
        Some(first)
    } else {
        None
    }
}

/// Find an existing audio document whose persisted metadata carries the given
/// import fingerprint (works for locally imported books and for synced rows —
/// metadata syncs while editions/audio do not).
async fn find_document_by_import_fingerprint(
    repo: &Repository,
    fingerprint: &str,
) -> Result<Option<Document>> {
    let row = sqlx::query(
        r#"
        SELECT * FROM documents
        WHERE file_type = 'audio'
          AND json_extract(metadata, '$.importFingerprint') = ?1
        LIMIT 1
        "#,
    )
    .bind(fingerprint)
    .fetch_optional(repo.pool())
    .await
    .map_err(|e| PlethoraError::Internal(format!("fingerprint lookup failed: {e}")))?;
    row.as_ref().map(Repository::row_to_document).transpose()
}

async fn has_imported_edition(repo: &Repository, document_id: &str) -> Result<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM audio_editions WHERE source_document_id = ?1 AND provider = 'imported'",
    )
    .bind(document_id)
    .fetch_optional(repo.pool())
    .await
    .map_err(|e| PlethoraError::Internal(format!("edition lookup failed: {e}")))?;
    Ok(row.map(|(n,)| n > 0).unwrap_or(false))
}

struct PlannedPart {
    input: MultipartPartInput,
    probe: AudioMetadataProbe,
    staged_path: String,
    identity: String,
}

/// Probe and stage every part (blocking work off the async runtime), in the
/// frontend's natural order.
async fn probe_and_stage(
    app: &AppHandle,
    parts: &[MultipartPartInput],
) -> Result<Vec<PlannedPart>> {
    let mut planned: Vec<PlannedPart> = Vec::with_capacity(parts.len());
    for input in parts {
        let path = input.path.clone();
        let probe = tauri::async_runtime::spawn_blocking(move || probe_audio_metadata(&path))
            .await
            .map_err(|e| PlethoraError::Internal(format!("probe task failed: {e}")))?;
        let size = std::fs::metadata(&input.path)
            .map(|m| m.len())
            .map_err(|e| PlethoraError::Internal(format!("cannot stat {}: {e}", input.path)))?;
        let staged_path = match stage_with_app(app, &input.path).await {
            Ok(path) => path,
            Err(err) => {
                // A partial staging pass must not leak the copies it already
                // made — nothing references them yet.
                for part in &planned {
                    let _ = std::fs::remove_file(&part.staged_path);
                }
                return Err(err);
            }
        };
        let identity = part_identity(input, &probe, size);
        planned.push(PlannedPart {
            input: input.clone(),
            probe,
            staged_path,
            identity,
        });
    }
    Ok(planned)
}

// stage_media_file_unique needs the AppHandle inside spawn_blocking, which
// requires moving it (it is Send + Clone).
async fn stage_with_app(app: &AppHandle, source: &str) -> Result<String> {
    let app = app.clone();
    let source = source.to_string();
    let staged = tauri::async_runtime::spawn_blocking(move || {
        stage_media_file_unique(&app, &source, "audio")
    })
    .await
    .map_err(|e| PlethoraError::Internal(format!("stage task failed: {e}")))?;
    let staged = staged?;
    Ok(staged.to_string_lossy().to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn import_multipart_audiobook(
    parts: Vec<MultipartPartInput>,
    title: Option<String>,
    author: Option<String>,
    fallback_title: Option<String>,
    fallback_author: Option<String>,
    cover_url: Option<String>,
    tags: Option<Vec<String>>,
    collection_id: Option<String>,
    app: AppHandle,
    repo: State<'_, Repository>,
) -> Result<MultipartImportResult> {
    if parts.len() < 2 {
        return Err(PlethoraError::Internal(
            "A multi-file audiobook needs at least two parts".into(),
        ));
    }
    for part in &parts {
        if !Path::new(&part.path).exists() {
            return Err(PlethoraError::NotFound(format!(
                "Part file not found: {}",
                part.path
            )));
        }
    }

    let mut planned = probe_and_stage(&app, &parts).await?;

    // Canonical order: embedded disc/track metadata outranks filenames when
    // every part carries a track number; otherwise keep the incoming natural
    // order (the frontend already natural-sorted).
    let all_tracked = planned.iter().all(|p| p.probe.track_number.is_some());
    if all_tracked {
        planned.sort_by(|a, b| {
            let da = a.probe.disc_number.unwrap_or(1);
            let db = b.probe.disc_number.unwrap_or(1);
            da.cmp(&db)
                .then(
                    a.probe
                        .track_number
                        .unwrap_or(0)
                        .cmp(&b.probe.track_number.unwrap_or(0)),
                )
                .then_with(|| {
                    natural_cmp(&display_name(&a.input), &display_name(&b.input))
                })
        });
    }

    let identities: Vec<String> = planned.iter().map(|p| p.identity.clone()).collect();
    let fingerprint = fingerprint_of(&identities);

    // Serialize concurrent imports of the same book.
    {
        let mut guard = in_flight_fingerprints()
            .lock()
            .map_err(|_| PlethoraError::Internal("fingerprint lock poisoned".into()))?;
        if !guard.insert(fingerprint.clone()) {
            // A concurrent import of the same book is already staging its own
            // copies — ours would be orphaned, so remove them.
            for part in &planned {
                let _ = std::fs::remove_file(&part.staged_path);
            }
            return Err(PlethoraError::Internal(
                "The same audiobook is already being imported".into(),
            ));
        }
    }
    let result = import_with_fingerprint(
        &app,
        &repo,
        planned,
        &fingerprint,
        title,
        author,
        fallback_title,
        fallback_author,
        cover_url,
        tags,
        collection_id,
    )
    .await;
    in_flight_fingerprints()
        .lock()
        .map(|mut guard| guard.remove(&fingerprint))
        .ok();
    result
}

#[allow(clippy::too_many_arguments)]
async fn import_with_fingerprint(
    app: &AppHandle,
    repo: &Repository,
    planned: Vec<PlannedPart>,
    fingerprint: &str,
    title: Option<String>,
    author: Option<String>,
    fallback_title: Option<String>,
    fallback_author: Option<String>,
    cover_url: Option<String>,
    tags: Option<Vec<String>>,
    collection_id: Option<String>,
) -> Result<MultipartImportResult> {
    // Book-level metadata: explicit override > consistent embedded tags >
    // planner-derived fallback.
    let album = consistent(planned.iter().map(|p| p.probe.album.clone()).collect());
    let album_artist = consistent(
        planned
            .iter()
            .map(|p| {
                p.probe
                    .album_artist
                    .clone()
                    .or_else(|| p.probe.artist.clone())
            })
            .collect(),
    );
    let book_title = title
        .filter(|s| !s.trim().is_empty())
        .or(album)
        .or(fallback_title)
        .unwrap_or_else(|| "Audiobook".to_string());
    let book_author = author
        .filter(|s| !s.trim().is_empty())
        .or(album_artist)
        .or(fallback_author);

    let staged_paths: Vec<String> = planned.iter().map(|p| p.staged_path.clone()).collect();
    let cleanup = |paths: &[String]| {
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    };

    // Cover: explicit > first embedded cover among the parts.
    let cover = match cover_url.filter(|s| !s.trim().is_empty()) {
        Some(url) => Some(url),
        None => planned
            .iter()
            .find_map(|p| extract_audio_cover_data_url(&p.staged_path).ok().flatten())
            .map(|(url, _)| url),
    };

    let total_duration: f64 = planned
        .iter()
        .map(|p| p.probe.duration_sec.unwrap_or(0.0))
        .sum();

    // Dedup against an existing logical audiobook with the same fingerprint.
    if let Some(existing) = find_document_by_import_fingerprint(repo, fingerprint).await? {
        if has_imported_edition(repo, &existing.id).await? {
            cleanup(&staged_paths);
            return Ok(MultipartImportResult {
                document: existing,
                edition_id: String::new(),
                section_count: 0,
                deduplicated: true,
                attached_to_existing: false,
            });
        }
        // Synced row (or edition-less local row): attach local media to it so
        // the book is playable on this device.
        let edition = build_edition(&existing.id, fingerprint, total_duration, planned.len());
        let sections = build_sections(&edition.id, &planned, fingerprint);
        let mut tx = repo
            .pool()
            .begin()
            .await
            .map_err(|e| PlethoraError::Internal(format!("tx begin failed: {e}")))?;
        if let Err(err) = async {
            sqlx::query("UPDATE documents SET file_path = ?2 WHERE id = ?1 AND (file_path IS NULL OR file_path = '')")
                .bind(&existing.id)
                .bind(staged_paths.first().cloned().unwrap_or_default())
                .execute(&mut *tx)
                .await
                .map_err(|e| PlethoraError::Internal(format!("file_path update failed: {e}")))?;
            AudioEditionRepository::create_audio_edition_tx(&mut tx, &edition, &sections).await
        }
        .await
        {
            let _ = tx.rollback().await;
            cleanup(&staged_paths);
            return Err(err);
        }
        if let Err(e) = tx.commit().await {
            cleanup(&staged_paths);
            return Err(PlethoraError::Internal(format!("tx commit failed: {e}")));
        }
        crate::sync::journal::notify_after_commit();
        return Ok(MultipartImportResult {
            document: existing,
            edition_id: edition.id,
            section_count: sections.len(),
            deduplicated: true,
            attached_to_existing: true,
        });
    }
    // Fresh logical audiobook: document + edition + sections in ONE tx.
    let mut doc = Document::with_collection(
        book_title,
        staged_paths.first().cloned().unwrap_or_default(),
        FileType::Audio,
        collection_id,
    );
    doc.tags = tags.unwrap_or_else(|| vec!["audiobook".to_string(), "audio".to_string()]);
    doc.metadata = Some(DocumentMetadata {
        author: book_author,
        import_fingerprint: Some(fingerprint.to_string()),
        ..Default::default()
    });
    doc.cover_image_url = cover;
    doc.cover_image_source = doc.cover_image_url.as_ref().map(|_| "imported".to_string());

    let edition = build_edition(&doc.id, fingerprint, total_duration, planned.len());
    let sections = build_sections(&edition.id, &planned, fingerprint);

    let mut tx = repo
        .pool()
        .begin()
        .await
        .map_err(|e| PlethoraError::Internal(format!("tx begin failed: {e}")))?;
    if let Err(err) = async {
        Repository::create_document_tx(&mut tx, &doc).await?;
        AudioEditionRepository::create_audio_edition_tx(&mut tx, &edition, &sections).await
    }
    .await
    {
        let _ = tx.rollback().await;
        cleanup(&staged_paths);
        return Err(err);
    }
    if let Err(e) = tx.commit().await {
        cleanup(&staged_paths);
        return Err(PlethoraError::Internal(format!("tx commit failed: {e}")));
    }
    crate::sync::journal::notify_after_commit();

    Ok(MultipartImportResult {
        document: doc,
        edition_id: edition.id,
        section_count: sections.len(),
        deduplicated: false,
        attached_to_existing: false,
    })
}

fn build_edition(
    document_id: &str,
    fingerprint: &str,
    total_duration: f64,
    part_count: usize,
) -> AudioEdition {
    let now = chrono::Utc::now().timestamp_millis();
    AudioEdition {
        id: uuid::Uuid::new_v4().to_string(),
        source_document_id: document_id.to_string(),
        source_revision_hash: fingerprint.to_string(),
        provider: "imported".to_string(),
        model: String::new(),
        voice: String::new(),
        quality_preset: None,
        generation_settings: Some(
            serde_json::json!({ "fingerprint": fingerprint, "partCount": part_count })
                .to_string(),
        ),
        total_duration_sec: total_duration,
        status: "ready".to_string(),
        created_at: now,
        updated_at: now,
    }
}

fn build_sections(edition_id: &str, planned: &[PlannedPart], fingerprint: &str) -> Vec<AudioEditionSection> {
    let now = chrono::Utc::now().timestamp_millis();
    planned
        .iter()
        .enumerate()
        .map(|(index, part)| {
            let name = display_name(&part.input);
            let title = part
                .probe
                .title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| {
                    let derived = chapter_title_from_file_name(&name);
                    if derived.is_empty() {
                        format!("Chapter {}", index + 1)
                    } else {
                        derived
                    }
                });
            let cache_key = {
                let mut hasher = Sha256::new();
                hasher.update(fingerprint.as_bytes());
                hasher.update(index.to_le_bytes());
                hex::encode(hasher.finalize())
            };
            AudioEditionSection {
                id: uuid::Uuid::new_v4().to_string(),
                edition_id: edition_id.to_string(),
                section_index: index as i32,
                title,
                source_section_id: None,
                source_start_anchor: None,
                source_end_anchor: None,
                character_count: 0,
                audio_file_path: Some(part.staged_path.clone()),
                audio_mime_type: audio_mime_for(&name),
                duration_sec: part.probe.duration_sec.unwrap_or(0.0),
                generation_status: "ready".to_string(),
                failure_reason: None,
                retry_count: 0,
                cache_key,
                created_at: now,
                updated_at: now,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_cmp_orders_numbers_numerically() {
        let mut names = vec!["10.mp3", "1.mp3", "2.mp3"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["1.mp3", "2.mp3", "10.mp3"]);
    }

    #[test]
    fn natural_cmp_handles_disc_layouts() {
        let mut names = vec!["Disc 10/01.mp3", "Disc 2/01.mp3", "Disc 1/02.mp3"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["Disc 1/02.mp3", "Disc 2/01.mp3", "Disc 10/01.mp3"]);
    }

    #[test]
    fn chapter_titles_strip_numbering() {
        assert_eq!(chapter_title_from_file_name("004 - The Troll.mp3"), "The Troll");
        assert_eq!(chapter_title_from_file_name("01 An Unexpected Party.mp3"), "An Unexpected Party");
        assert_eq!(chapter_title_from_file_name("Title - 03.mp3"), "Title");
        // Bare trailing numbers are titles, not track numbers.
        assert_eq!(chapter_title_from_file_name("Catch 22.mp3"), "Catch 22");
    }

    #[test]
    fn fingerprint_is_order_sensitive_and_stable() {
        let a = fingerprint_of(&["one|100|10".into(), "two|200|20".into()]);
        let b = fingerprint_of(&["one|100|10".into(), "two|200|20".into()]);
        let c = fingerprint_of(&["two|200|20".into(), "one|100|10".into()]);
        let d = fingerprint_of(&["one|100".into(), "two|200|20".into()]);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, d);
    }

    #[test]
    fn normalized_basename_is_unicode_and_case_stable() {
        assert_eq!(normalized_basename("The_Hobbit-01.MP3"), "thehobbit01");
        assert!(!normalized_basename("第七章.mp3").is_empty());
    }

    #[test]
    fn audio_mime_covers_common_formats() {
        assert_eq!(audio_mime_for("01.mp3"), "audio/mp3");
        assert_eq!(audio_mime_for("book.m4b"), "audio/mp4");
        assert_eq!(audio_mime_for("track.flac"), "audio/flac");
        assert_eq!(audio_mime_for("weird.xyz"), "audio/mpeg");
    }
}
