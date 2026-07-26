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
    canonical_path_within_roots, path_label, parse_range, response_with_body, MediaServerState,
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

#[derive(serde::Deserialize)]
struct EpubParams {
    path: String,
}

/// Build the `/epub` route, meant to be merged into the shared media-server
/// `Router` (see `media_server::start`).
pub(crate) fn router() -> Router<MediaServerState> {
    Router::new().route("/epub", get(epub_handler))
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "cannot stat epub file",
            )
                .into_response();
        }
    };

    if let Some(range_header) = range_header.as_deref() {
        let (start, end) = match parse_range(range_header, total) {
            Ok(range) => range,
            Err(()) => {
                let mut response = (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "invalid epub range",
                )
                    .into_response();
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "epub seek failed",
            )
                .into_response();
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

/// Return an `http://127.0.0.1:<port>/epub?path=<encoded>` URL for a validated
/// app-managed EPUB file. Starts the shared media/epub server on first call.
///
/// Mirrors `media_server::get_media_stream_url`; the URL it returns is handed
/// directly to epubjs in the frontend (`ePub(url)`).
#[tauri::command]
pub async fn get_epub_stream_url(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    use std::path::Path;

    let roots = crate::media_server::allowed_media_roots(&app_handle)?;
    let canonical = canonical_path_within_roots(Path::new(&file_path), &roots)
        .map_err(|status| format!("Cannot stream epub file (HTTP {})", status.as_u16()))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("Cannot stat epub file: {error}"))?;
    let port = crate::media_server::start(&app_handle).await?;
    let canonical_string = canonical.to_string_lossy().into_owned();
    let encoded = urlencoding::encode(&canonical_string);
    tracing::info!(
        "[epub.source_resolution] file={} size={} strategy=local-epub-server port={}",
        path_label(&canonical),
        metadata.len(),
        port
    );
    Ok(format!("http://127.0.0.1:{port}/epub?path={encoded}"))
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
        }
    }

    fn temp_epub(bytes: &[u8]) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("incrementum-epub-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("fixture.epub");
        fs::write(&path, bytes).expect("write test epub");
        (root, path)
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
        let root = std::env::temp_dir().join(format!("incrementum-epub-{}", Uuid::new_v4()));
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
            std::env::temp_dir().join(format!("incrementum-epub-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&outside_root).expect("create outside root");
        let outside_file = outside_root.join("elsewhere.epub");
        fs::write(&outside_file, b"hidden").expect("write outside file");

        let allowed_root =
            std::env::temp_dir().join(format!("incrementum-epub-allowed-{}", Uuid::new_v4()));
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
        let root = std::env::temp_dir().join(format!("incrementum-epub-{}", Uuid::new_v4()));
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
