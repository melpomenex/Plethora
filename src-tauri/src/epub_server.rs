//! Loopback HTTP route that streams `.epub` files to the webview with full
//! `GET` and HTTP `Range` / `206 Partial Content` semantics.
//!
//! This exists so that EPUB documents of arbitrary size can be opened in the
//! reader without materializing the whole file over Tauri IPC and decompressing
//! the entire zip in the webview (the previous failure mode for files above
//! ~20–30 MB). epubjs/JSZip load a ZIP by URL and issue their own byte-range
//! requests against it; serving the raw `.epub` bytes with Range support lets
//! the reader fetch only the central directory and the spine entries it needs.
//!
//! # Architecture
//!
//! There is exactly one loopback HTTP listener per process, owned by
//! [`crate::media_server`]. This module contributes a `GET /epub` route that is
//! merged into that listener's `axum::Router` (see `media_server::start`). It
//! reuses the shared `media_server` helpers for path canonicalization, range
//! parsing, and response construction so that EPUB and audio streaming behave
//! identically. Design reference: `openspec/changes/stream-epub-resources/
//! design.md`.
//!
//! The frontend resolves a URL via the [`get_epub_stream_url`] Tauri command
//! and hands it to epubjs (`ePub(url)`), replacing the previous whole-file
//! `ePub(fileData.slice().buffer)` path.

use crate::media_server::{
    canonical_path_within_roots, parse_range, path_label, response_with_body, MediaServerState,
};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufReader, Read},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Instant,
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use zip::ZipArchive;

/// `Content-Type` for EPUB resources. EPUBs are ZIP containers; the registered
/// media type is `application/epub+zip` (RFC 4839).
const EPUB_CONTENT_TYPE: &str = "application/epub+zip";
const EPUB_ZIP_LOCAL_FILE_HEADER: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];

#[derive(serde::Deserialize)]
struct EpubParams {
    path: String,
}

/// Build the `/epub` and `/epub-entries` routes, meant to be merged into the
/// shared media-server `Router` (see `media_server::start`).
pub(crate) fn router() -> Router<MediaServerState> {
    Router::new()
        .route("/epub", get(epub_handler))
        // epub.js decides whether a URL is an archived EPUB or an unpacked
        // directory from the URL pathname.  Keep the legacy routes for
        // compatibility, while primary opens use `/epub-entries/<token>/`
        // so epub.js fetches only the entries it needs on demand.
        .route("/epub/book.epub", get(epub_handler))
        .route("/epub-entries/:token/*entry_path", get(epub_entries_handler))
}

type CachedZip = Arc<Mutex<ZipArchive<BufReader<std::fs::File>>>>;

const MAX_REGISTERED_EPUBS: usize = 256;
const MAX_CACHED_ARCHIVES: usize = 6;

#[derive(Default)]
struct EpubRegistry {
    token_to_path: HashMap<String, PathBuf>,
    path_to_token: HashMap<PathBuf, String>,
    token_order: VecDeque<String>,
    archive_cache: Vec<(String, CachedZip)>,
}

impl EpubRegistry {
    fn register(&mut self, canonical_path: PathBuf) -> String {
        if let Some(existing) = self.path_to_token.get(&canonical_path) {
            return existing.clone();
        }
        let token = Uuid::new_v4().simple().to_string();
        self.token_to_path
            .insert(token.clone(), canonical_path.clone());
        self.path_to_token.insert(canonical_path, token.clone());
        self.token_order.push_back(token.clone());

        while self.token_order.len() > MAX_REGISTERED_EPUBS {
            if let Some(evicted) = self.token_order.pop_front() {
                if let Some(old_path) = self.token_to_path.remove(&evicted) {
                    self.path_to_token.remove(&old_path);
                }
                self.archive_cache.retain(|(t, _)| t != &evicted);
            }
        }
        token
    }

    fn resolve_path(&self, token: &str) -> Option<PathBuf> {
        self.token_to_path.get(token).cloned()
    }

    fn get_cached_archive(&mut self, token: &str) -> Option<CachedZip> {
        let idx = self
            .archive_cache
            .iter()
            .position(|(t, _)| t == token)?;
        let entry = self.archive_cache.remove(idx);
        let arc = Arc::clone(&entry.1);
        self.archive_cache.push(entry);
        Some(arc)
    }

    fn insert_cached_archive(&mut self, token: String, archive: CachedZip) {
        self.archive_cache.retain(|(t, _)| t != &token);
        if self.archive_cache.len() >= MAX_CACHED_ARCHIVES {
            self.archive_cache.remove(0);
        }
        self.archive_cache.push((token, archive));
    }
}

static EPUB_REGISTRY: OnceLock<Mutex<EpubRegistry>> = OnceLock::new();

fn epub_registry() -> &'static Mutex<EpubRegistry> {
    EPUB_REGISTRY.get_or_init(|| Mutex::new(EpubRegistry::default()))
}

fn register_epub_path(canonical_path: PathBuf) -> Result<String, String> {
    let mut guard = epub_registry()
        .lock()
        .map_err(|_| "EPUB registry lock poisoned".to_string())?;
    Ok(guard.register(canonical_path))
}

fn normalize_epub_entry_path(raw: &str) -> Result<String, StatusCode> {
    let trimmed = raw.trim_start_matches('/');
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut parts = Vec::new();
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(StatusCode::BAD_REQUEST);
        }
        parts.push(segment);
    }
    if parts.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(parts.join("/"))
}

fn content_type_for_epub_entry(entry_path: &str) -> &'static str {
    let ext = entry_path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "xhtml" | "xht" => "application/xhtml+xml; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "opf" => "application/oebps-package+xml; charset=utf-8",
        "ncx" => "application/x-dtbncx+xml; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

async fn read_epub_entry(token: &str, entry_path: &str) -> Result<Vec<u8>, StatusCode> {
    let (file_path, cached_archive) = {
        let mut guard = epub_registry()
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let path = guard.resolve_path(token).ok_or(StatusCode::NOT_FOUND)?;
        let cached = guard.get_cached_archive(token);
        (path, cached)
    };

    let token_owned = token.to_string();
    let entry_owned = entry_path.to_string();

    tokio::task::spawn_blocking(move || -> Result<Vec<u8>, StatusCode> {
        let archive_arc = match cached_archive {
            Some(arc) => arc,
            None => {
                let file =
                    std::fs::File::open(&file_path).map_err(|_| StatusCode::NOT_FOUND)?;
                let archive = ZipArchive::new(BufReader::new(file))
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let arc = Arc::new(Mutex::new(archive));
                if let Ok(mut guard) = epub_registry().lock() {
                    guard.insert_cached_archive(token_owned, Arc::clone(&arc));
                }
                arc
            }
        };

        let mut archive = archive_arc
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let lookup_result = match archive.by_name(&entry_owned) {
            Ok(_) => Ok(Some(entry_owned.clone())),
            Err(zip::result::ZipError::FileNotFound) => Ok(None),
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }?;
        let target_name = match lookup_result {
            Some(name) => name,
            None => archive
                .file_names()
                .find(|name| {
                    let normalized = name.trim_start_matches("./");
                    normalized == entry_owned || normalized.eq_ignore_ascii_case(&entry_owned)
                })
                .map(ToOwned::to_owned)
                .ok_or(StatusCode::NOT_FOUND)?,
        };
        let mut entry = match archive.by_name(&target_name) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::FileNotFound) => return Err(StatusCode::NOT_FOUND),
            Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
        };
        let mut buf = Vec::with_capacity(entry.size().min(16 * 1024 * 1024) as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(buf)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

/// Serve a single entry from a token-registered `.epub` archive on demand.
async fn epub_entries_handler(
    Path((token, raw_entry_path)): Path<(String, String)>,
) -> axum::response::Response {
    let entry_path = match normalize_epub_entry_path(&raw_entry_path) {
        Ok(path) => path,
        Err(status) => return (status, "invalid epub entry path").into_response(),
    };

    match read_epub_entry(&token, &entry_path).await {
        Ok(bytes) => {
            let content_type = content_type_for_epub_entry(&entry_path);
            let len = bytes.len() as u64;
            let mut response = response_with_body(
                StatusCode::OK,
                content_type,
                len,
                None,
                Body::from(bytes),
            );
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=3600"),
            );
            response
        }
        Err(StatusCode::NOT_FOUND) => (StatusCode::NOT_FOUND, "epub entry not found").into_response(),
        Err(status) => (status, "failed to read epub entry").into_response(),
    }
}

/// Serve a local `.epub` file with complete or single-range responses.
///
/// Mirrors `media_server::stream_handler` line-for-line; the only differences
/// are the fixed `application/epub+zip` content type, the
/// `[epub.resource_request]` log prefix, and the slightly different 404 reason
/// string. The shared helpers (`canonical_path_within_roots`, `parse_range`,
/// `response_with_body`) keep the two paths from drifting apart.
async fn epub_handler(
    State(state): State<MediaServerState>,
    Query(params): Query<EpubParams>,
    headers: HeaderMap,
) -> axum::response::Response {
    let started = Instant::now();
    let requested_path = PathBuf::from(&params.path);
    let requested_label = path_label(&requested_path).to_string();
    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);

    let file_path = match canonical_path_within_roots(&requested_path, &state.allowed_roots) {
        Ok(path) => path,
        Err(status) => {
            tracing::warn!(
                "[epub.resource_request] file={} status={} range={:?} elapsed_ms={}",
                requested_label,
                status.as_u16(),
                range_header,
                started.elapsed().as_millis()
            );
            return (status, "epub file unavailable").into_response();
        }
    };

    let file = match File::open(&file_path).await {
        Ok(file) => file,
        Err(error) => {
            tracing::warn!(
                "[epub.resource_request] file={} status=404 range={:?} error={} elapsed_ms={}",
                path_label(&file_path),
                range_header,
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::NOT_FOUND, "epub file unavailable").into_response();
        }
    };
    let total = match file.metadata().await {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            tracing::warn!(
                "[epub.resource_request] file={} status=500 error={} elapsed_ms={}",
                path_label(&file_path),
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot stat epub file").into_response();
        }
    };

    if let Some(range_header) = range_header.as_deref() {
        let (start, end) = match parse_range(range_header, total) {
            Ok(range) => range,
            Err(()) => {
                let mut response =
                    (StatusCode::RANGE_NOT_SATISFIABLE, "invalid epub range").into_response();
                response.headers_mut().insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes */{total}"))
                        .unwrap_or_else(|_| HeaderValue::from_static("bytes */0")),
                );
                tracing::warn!(
                    "[epub.resource_request] file={} status=416 total={} range={} elapsed_ms={}",
                    path_label(&file_path),
                    total,
                    range_header,
                    started.elapsed().as_millis()
                );
                return response;
            }
        };

        let length = end - start + 1;
        let mut file = file;
        if let Err(error) = file.seek(SeekFrom::Start(start)).await {
            tracing::error!(
                "[epub.resource_request] file={} status=500 range={} error={} elapsed_ms={}",
                path_label(&file_path),
                range_header,
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, "epub seek failed").into_response();
        }

        tracing::info!(
            "[epub.resource_request] file={} status=206 total={} range={} elapsed_ms={}",
            path_label(&file_path),
            total,
            range_header,
            started.elapsed().as_millis()
        );
        return response_with_body(
            StatusCode::PARTIAL_CONTENT,
            EPUB_CONTENT_TYPE,
            length,
            Some(format!("bytes {start}-{end}/{total}")),
            Body::from_stream(ReaderStream::new(file.take(length))),
        );
    }

    tracing::info!(
        "[epub.resource_request] file={} status=200 total={} range=none elapsed_ms={}",
        path_label(&file_path),
        total,
        started.elapsed().as_millis()
    );
    response_with_body(
        StatusCode::OK,
        EPUB_CONTENT_TYPE,
        total,
        None,
        Body::from_stream(ReaderStream::new(file)),
    )
}

/// Reject payloads that cannot possibly be EPUB archives before handing them
/// to epub.js. A malformed/ciphertext file can leave JSZip's asynchronous open
/// unresolved on Android, which presents as an infinite "Loading EPUB" screen.
/// EPUB 3 requires the uncompressed `mimetype` entry to be the first ZIP local
/// file entry, so a valid EPUB begins with the standard PK\x03\x04 signature.
fn validate_epub_archive(path: &std::path::Path) -> Result<(), String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Cannot open epub file: {error}"))?;
    let mut signature = [0_u8; 4];
    std::io::Read::read_exact(&mut file, &mut signature)
        .map_err(|error| format!("Invalid EPUB archive: cannot read ZIP signature: {error}"))?;
    if signature != EPUB_ZIP_LOCAL_FILE_HEADER {
        return Err(
            "Invalid EPUB archive: file does not start with the required ZIP signature. Re-download the synced file."
                .to_string(),
        );
    }
    Ok(())
}

/// Return an `http://127.0.0.1:<port>/epub-entries/<token>/` directory-style
/// base URL for an EPUB file. Starts the shared media/epub server on first call.
///
/// The frontend opens this URL with `ePub(url, { openAs: "directory" })` so
/// epub.js fetches only `META-INF/container.xml`, the `.opf` manifest,
/// navigation, and the active spine entries on demand — without copying the
/// archive to mirror storage or downloading the entire `.epub` into JS memory.
pub(crate) fn resolve_epub_path_candidates(
    file_path: &str,
    app_data_dir: Option<&std::path::Path>,
) -> Vec<PathBuf> {
    let raw = PathBuf::from(file_path);
    let mut candidates = vec![raw.clone()];
    if let Some(data_dir) = app_data_dir {
        if raw.is_relative() {
            candidates.push(data_dir.join(&raw));
        }
        if let Some(file_name) = raw.file_name() {
            candidates.push(data_dir.join("incrementum").join("documents").join(file_name));
            candidates.push(data_dir.join("imports").join(file_name));
        }
    }
    candidates
}

#[tauri::command]
pub async fn get_epub_stream_url(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    use tauri::Manager;
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("EPUB file path is empty. Please re-import the document.".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Err(
            "This EPUB references a remote URL rather than a local file. Re-import the EPUB to open it."
                .to_string(),
        );
    }

    let app_data_dir = app_handle.path().app_data_dir().ok();
    let candidates = resolve_epub_path_candidates(trimmed, app_data_dir.as_deref());
    let mut source_canonical = None;
    let mut last_err = None;
    for candidate in &candidates {
        match std::fs::canonicalize(candidate) {
            Ok(p) => {
                source_canonical = Some(p);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let source_canonical = source_canonical.ok_or_else(|| {
        format!(
            "Cannot stat epub file '{}': {}",
            trimmed,
            last_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "file not found".to_string())
        )
    })?;
    validate_epub_archive(&source_canonical)?;

    let metadata = std::fs::metadata(&source_canonical)
        .map_err(|error| format!("Cannot stat epub file: {error}"))?;
    let token = register_epub_path(source_canonical.clone())?;
    let port = crate::media_server::start(&app_handle).await?;
    tracing::info!(
        "[epub.source_resolution] file={} size={} strategy=local-epub-entries port={}",
        path_label(&source_canonical),
        metadata.len(),
        port
    );
    Ok(format!(
        "http://127.0.0.1:{port}/epub-entries/{token}/"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;
    use std::fs::{self, OpenOptions};
    use std::sync::Arc;
    use tower05::ServiceExt;
    use uuid::Uuid;

    fn test_state(root: &std::path::Path) -> MediaServerState {
        MediaServerState {
            allowed_roots: Arc::new(vec![root.to_path_buf()]),
            granted_paths: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
        }
    }

    fn temp_epub(bytes: &[u8]) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("plethora-epub-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("fixture.epub");
        fs::write(&path, bytes).expect("write test epub");
        (root, path)
    }

    #[test]
    fn archive_validation_accepts_epub_zip_signature() {
        let (root, path) = temp_epub(b"PK\x03\x04fixture");
        assert_eq!(validate_epub_archive(&path), Ok(()));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn archive_validation_rejects_ciphertext_payload() {
        let (root, path) = temp_epub(&[0x0e, 0x65, 0xfe, 0x6c, 0xc8, 0x67]);
        let error = validate_epub_archive(&path).expect_err("ciphertext must not open as EPUB");
        assert!(error.contains("required ZIP signature"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn extension_bearing_route_streams_archived_epub() {
        let bytes = b"PK fixture";
        let (root, path) = temp_epub(bytes);
        let response = router()
            .with_state(test_state(&root))
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub/book.epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/epub+zip"
        );
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            bytes
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn no_range_streams_complete_body_with_epub_content_type() {
        let bytes = b"0123456789abcdef";
        let (root, path) = temp_epub(bytes);
        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/epub+zip"
        );
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH],
            bytes.len().to_string()
        );
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            bytes
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn range_stream_returns_exact_partial_body() {
        let bytes = b"0123456789abcdef";
        let (root, path) = temp_epub(bytes);
        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .header(header::RANGE, "bytes=3-7")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "5");
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 3-7/16");
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap(),
            &bytes[3..=7]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn invalid_range_returns_416() {
        let (root, path) = temp_epub(b"0123456789");
        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .header(header::RANGE, "bytes=99-100")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes */10");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn missing_file_returns_not_found() {
        let root = std::env::temp_dir().join(format!("plethora-epub-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("missing.epub");
        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn path_outside_allowed_roots_is_forbidden() {
        // A temp file whose canonical path is NOT under the "allowed root"
        // we register with the test state.
        let outside_root =
            std::env::temp_dir().join(format!("plethora-epub-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&outside_root).expect("create outside root");
        let outside_file = outside_root.join("elsewhere.epub");
        fs::write(&outside_file, b"hidden").expect("write outside file");

        let allowed_root =
            std::env::temp_dir().join(format!("plethora-epub-allowed-{}", Uuid::new_v4()));
        fs::create_dir_all(&allowed_root).expect("create allowed root");

        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&allowed_root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&outside_file.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        fs::remove_dir_all(outside_root).expect("cleanup outside");
        fs::remove_dir_all(allowed_root).expect("cleanup allowed");
    }

    #[tokio::test]
    async fn large_file_response_keeps_streaming_body_lazy() {
        let root = std::env::temp_dir().join(format!("plethora-epub-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("large-fixture.epub");
        let large_size = 64 * 1024 * 1024;
        OpenOptions::new()
            .create(true)
            .write(true)
            .open(&path)
            .expect("create sparse fixture")
            .set_len(large_size)
            .expect("size sparse fixture");

        let app = Router::new()
            .route("/epub", get(epub_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/epub?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH],
            large_size.to_string()
        );
        // Do not consume the body: constructing a response for a large file
        // must not read it into memory before the client requests bytes.
        drop(response);
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn create_zip_epub(entries: &[(&str, &[u8])]) -> (std::path::PathBuf, std::path::PathBuf) {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("plethora-epub-zip-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("book.epub");
        let file = fs::File::create(&path).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(content).expect("write zip entry");
        }
        writer.finish().expect("finish zip");
        (root, path)
    }

    #[tokio::test]
    async fn epub_entries_serves_individual_files_with_mime_types() {
        let container_xml = br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
        let opf = br#"<package version="3.0"></package>"#;
        let chapter = br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello</p></body></html>"#;
        let css = b"body { color: #111; }";
        let png = b"\x89PNG\r\n\x1a\n";

        let (root, path) = create_zip_epub(&[
            ("META-INF/container.xml", container_xml),
            ("OEBPS/content.opf", opf),
            ("OEBPS/ch1.xhtml", chapter),
            ("OEBPS/Styles/main.css", css),
            ("OEBPS/Images/cover.png", png),
        ]);
        let canonical = fs::canonicalize(&path).expect("canonical");
        let token = register_epub_path(canonical).expect("register token");
        let app = router().with_state(test_state(&root));

        let req_cases: Vec<(&str, &str, &[u8])> = vec![
            ("META-INF/container.xml", "application/xml; charset=utf-8", container_xml),
            ("OEBPS/content.opf", "application/oebps-package+xml; charset=utf-8", opf),
            ("OEBPS/ch1.xhtml", "application/xhtml+xml; charset=utf-8", chapter),
            ("OEBPS/Styles/main.css", "text/css; charset=utf-8", css),
            ("OEBPS/Images/cover.png", "image/png", png),
        ];

        for (entry, expected_ct, expected_body) in req_cases {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/epub-entries/{token}/{entry}"))
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::OK, "entry {entry}");
            assert_eq!(response.headers()[header::CONTENT_TYPE], expected_ct);
            assert_eq!(
                to_bytes(response.into_body(), 4096).await.unwrap().as_ref(),
                expected_body
            );
        }

        // Missing entry -> 404
        let missing_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/epub-entries/{token}/OEBPS/missing.xhtml"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(missing_resp.status(), StatusCode::NOT_FOUND);

        // Unknown token -> 404
        let bad_token_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/epub-entries/nonexistent-token/META-INF/container.xml")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(bad_token_resp.status(), StatusCode::NOT_FOUND);

        // Path traversal -> 400
        let traversal_resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/epub-entries/{token}/OEBPS/../../etc/passwd"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(traversal_resp.status(), StatusCode::BAD_REQUEST);

        fs::remove_dir_all(root).expect("cleanup");
    }
}
