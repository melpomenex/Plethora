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
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::{path::PathBuf, time::Instant};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use tokio_util::io::ReaderStream;

/// `Content-Type` for EPUB resources. EPUBs are ZIP containers; the registered
/// media type is `application/epub+zip` (RFC 4839).
const EPUB_CONTENT_TYPE: &str = "application/epub+zip";
const EPUB_ZIP_LOCAL_FILE_HEADER: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];

#[derive(serde::Deserialize)]
struct EpubParams {
    path: String,
}

/// Build the `/epub` route, meant to be merged into the shared media-server
/// `Router` (see `media_server::start`).
pub(crate) fn router() -> Router<MediaServerState> {
    Router::new()
        .route("/epub", get(epub_handler))
        // epub.js decides whether a URL is an archived EPUB or an unpacked
        // directory from the URL pathname.  Keep the legacy route above for
        // compatibility, but advertise this extension-bearing route so it
        // opens the streamed ZIP instead of requesting /META-INF/container.xml.
        .route("/epub/book.epub", get(epub_handler))
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

/// Copy `source` into `app_cache_dir/incrementum/epub-mirror` so it becomes
/// servable under [`canonical_path_within_roots`], and return the mirror's
/// canonical path. Idempotent: reuses an existing mirror whose size still
/// matches the source instead of re-copying on every open.
///
/// Unlike audio (copied into app storage once, at import time), EPUBs are
/// imported in place and normally live wherever the user picked them from on
/// disk (`document.rs`, `import_from_path`) — outside `app_data_dir` /
/// `app_cache_dir`. That was fine for the whole-file Tauri IPC read this
/// module replaced (reachable only from the app's own webview), but the
/// loopback HTTP server it introduced is reachable by any local process, so
/// `canonical_path_within_roots` correctly refuses to serve the original path
/// directly. Mirroring lazily here — rather than widening the allowed roots —
/// keeps that containment check meaningful while still letting every
/// already-imported book stream.
fn mirror_epub_into_app_storage(
    app_handle: &tauri::AppHandle,
    source: &std::path::Path,
) -> Result<PathBuf, String> {
    use std::hash::{Hash, Hasher};
    use tauri::Manager;

    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve app cache directory: {error}"))?
        .join("incrementum")
        .join("epub-mirror");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create epub mirror directory: {error}"))?;

    let source_len = std::fs::metadata(source)
        .map_err(|error| format!("Cannot stat epub file: {error}"))?
        .len();

    // Stable per-source-path filename so repeated opens of the same document
    // reuse one mirror instead of accumulating copies.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    let path_hash = hasher.finish();
    let original_filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("book.epub");
    let safe_filename = original_filename.replace(['/', '\\', ':'], "_");
    let dest = cache_dir.join(format!("{path_hash:016x}-{safe_filename}"));

    let up_to_date = std::fs::metadata(&dest)
        .map(|dest_meta| dest_meta.len() == source_len)
        .unwrap_or(false);
    if !up_to_date {
        std::fs::copy(source, &dest)
            .map_err(|error| format!("Failed to stage epub for streaming: {error}"))?;
    }

    std::fs::canonicalize(&dest)
        .map_err(|error| format!("Cannot resolve staged epub path: {error}"))
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

/// Return an `http://127.0.0.1:<port>/epub/book.epub?path=<encoded>` URL for an EPUB
/// file. Starts the shared media/epub server on first call.
///
/// Mirrors `media_server::get_media_stream_url`; the URL it returns is handed
/// directly to epubjs in the frontend (`ePub(url)`). If `file_path` isn't
/// already under an allowed root, it's mirrored into app storage first (see
/// [`mirror_epub_into_app_storage`]).
#[tauri::command]
pub async fn get_epub_stream_url(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    let roots = crate::media_server::allowed_media_roots(&app_handle)?;
    let source_canonical = std::fs::canonicalize(&file_path)
        .map_err(|error| format!("Cannot stat epub file: {error}"))?;
    validate_epub_archive(&source_canonical)?;

    let canonical = match canonical_path_within_roots(&source_canonical, &roots) {
        Ok(path) => path,
        Err(_) => mirror_epub_into_app_storage(&app_handle, &source_canonical)?,
    };

    let metadata =
        std::fs::metadata(&canonical).map_err(|error| format!("Cannot stat epub file: {error}"))?;
    let port = crate::media_server::start(&app_handle).await?;
    let canonical_string = canonical.to_string_lossy().into_owned();
    let encoded = urlencoding::encode(&canonical_string);
    tracing::info!(
        "[epub.source_resolution] file={} size={} strategy=local-epub-server port={}",
        path_label(&canonical),
        metadata.len(),
        port
    );
    Ok(format!(
        "http://127.0.0.1:{port}/epub/book.epub?path={encoded}"
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
}
