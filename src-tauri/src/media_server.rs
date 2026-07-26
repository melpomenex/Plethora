//! Lightweight local HTTP server for streaming large media files on Android.
//!
//! On Android, the Tauri asset protocol (`asset://localhost/…`) can buffer the
//! entire file into a `WebResourceResponse` body, which causes an
//! `OutOfMemoryError` for large audiobooks. This module serves app-managed files
//! over loopback with correct full-response and byte-range semantics.
//!
//! # Shared loopback listener
//!
//! There is exactly one loopback HTTP listener per process
//! (`MEDIA_SERVER_PORT`). The sibling [`crate::epub_server`] module mounts its
//! `/epub` route onto this same listener via [`epub_server::router`], merged
//! into the Router below in [`start`]. Design reference: `openspec/changes/
//! stream-epub-resources/design.md` (decision D2 — "sibling module, same
//! listener"). The shared helpers in this file (`canonical_path_within_roots`,
//! `parse_range`, `response_with_body`, etc.) are `pub(crate)` so the EPUB
//! route reuses them unchanged.

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
    sync::OnceCell,
};
use tokio_util::io::ReaderStream;

/// The port the media server is listening on. Initialized once per app
/// process, so concurrent source resolutions cannot publish different ports.
static MEDIA_SERVER_PORT: OnceCell<u16> = OnceCell::const_new();

#[derive(Clone)]
pub(crate) struct MediaServerState {
    pub(crate) allowed_roots: Arc<Vec<PathBuf>>,
}

#[derive(serde::Deserialize)]
struct StreamParams {
    path: String,
}

/// Start the media streaming server (idempotent) and return its port.
pub async fn start(app_handle: &tauri::AppHandle) -> Result<u16, String> {
    let allowed_roots = allowed_media_roots(app_handle)?;
    let port = MEDIA_SERVER_PORT
        .get_or_try_init(|| async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|error| format!("media_server: failed to bind loopback: {error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("media_server: failed to read listener address: {error}"))?
                .port();

            let state = MediaServerState {
                allowed_roots: Arc::new(allowed_roots),
            };
            let app = Router::new()
                .route("/stream", get(stream_handler))
                .merge(crate::epub_server::router())
                .with_state(state);

            tokio::spawn(async move {
                if let Err(error) = axum::serve(listener, app).await {
                    tracing::error!("[audiobook.media_server] server stopped: {error}");
                }
            });

            tracing::info!("[audiobook.media_server] listening on 127.0.0.1:{port}");
            Ok::<u16, String>(port)
        })
        .await?;
    Ok(*port)
}

/// Return the port the media server is on (0 if not started).
pub fn port() -> u16 {
    MEDIA_SERVER_PORT.get().copied().unwrap_or(0)
}

pub(crate) fn allowed_media_roots(app_handle: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    use tauri::Manager;

    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let app_cache = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve app cache directory: {error}"))?;

    Ok(vec![app_data, app_cache])
}

pub(crate) fn canonical_path_within_roots(
    path: &Path,
    roots: &[PathBuf],
) -> Result<PathBuf, StatusCode> {
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::FORBIDDEN
        }
    })?;

    let metadata = std::fs::metadata(&canonical).map_err(|_| StatusCode::NOT_FOUND)?;
    if !metadata.is_file() {
        return Err(StatusCode::FORBIDDEN);
    }

    if roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .map(|canonical_root| canonical.starts_with(canonical_root))
            .unwrap_or(false)
    }) {
        Ok(canonical)
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

fn media_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "m4a" | "m4b" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

pub(crate) fn path_label(path: &Path) -> &str {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("<unnamed>")
}

pub(crate) fn set_common_headers(response: &mut Response, content_type: &str, length: u64) {
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, value);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
}

pub(crate) fn response_with_body(
    status: StatusCode,
    content_type: &str,
    length: u64,
    content_range: Option<String>,
    body: Body,
) -> Response {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    set_common_headers(&mut response, content_type, length);
    if let Some(content_range) = content_range {
        if let Ok(value) = HeaderValue::from_str(&content_range) {
            response.headers_mut().insert(header::CONTENT_RANGE, value);
        }
    }
    response
}

/// Parse a single `bytes=START-END` range header.
pub(crate) fn parse_range(value: &str, total: u64) -> Result<(u64, u64), ()> {
    if total == 0 {
        return Err(());
    }

    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.contains(',') {
        return Err(());
    }
    let (start_raw, end_raw) = range.split_once('-').ok_or(())?;

    let (start, end) = if start_raw.is_empty() {
        let suffix_length = end_raw.parse::<u64>().map_err(|_| ())?;
        if suffix_length == 0 {
            return Err(());
        }
        (total.saturating_sub(suffix_length), total - 1)
    } else {
        let start = start_raw.parse::<u64>().map_err(|_| ())?;
        if start >= total {
            return Err(());
        }
        let end = if end_raw.is_empty() {
            total - 1
        } else {
            end_raw.parse::<u64>().map_err(|_| ())?
        };
        if start > end {
            return Err(());
        }
        (start, end.min(total - 1))
    };

    if start > end || start >= total {
        return Err(());
    }
    Ok((start, end))
}

/// Serve a local media file with complete or single-range responses.
async fn stream_handler(
    State(state): State<MediaServerState>,
    Query(params): Query<StreamParams>,
    headers: HeaderMap,
) -> Response {
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
                "[audiobook.media_request] file={} status={} range={:?} elapsed_ms={}",
                requested_label,
                status.as_u16(),
                range_header,
                started.elapsed().as_millis()
            );
            return (status, "media file unavailable").into_response();
        }
    };

    let file = match File::open(&file_path).await {
        Ok(file) => file,
        Err(error) => {
            tracing::warn!(
                "[audiobook.media_request] file={} status=404 range={:?} error={} elapsed_ms={}",
                path_label(&file_path),
                range_header,
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::NOT_FOUND, "media file unavailable").into_response();
        }
    };
    let total = match file.metadata().await {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            tracing::warn!(
                "[audiobook.media_request] file={} status=500 error={} elapsed_ms={}",
                path_label(&file_path),
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot stat media file").into_response();
        }
    };
    let content_type = media_content_type(&file_path);

    if let Some(range_header) = range_header.as_deref() {
        let (start, end) = match parse_range(range_header, total) {
            Ok(range) => range,
            Err(()) => {
                let mut response =
                    (StatusCode::RANGE_NOT_SATISFIABLE, "invalid media range").into_response();
                response.headers_mut().insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes */{total}"))
                        .unwrap_or_else(|_| HeaderValue::from_static("bytes */0")),
                );
                tracing::warn!(
                    "[audiobook.media_request] file={} status=416 total={} range={} elapsed_ms={}",
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
                "[audiobook.media_request] file={} status=500 range={} error={} elapsed_ms={}",
                path_label(&file_path),
                range_header,
                error,
                started.elapsed().as_millis()
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, "media seek failed").into_response();
        }

        tracing::info!(
            "[audiobook.media_request] file={} status=206 total={} range={} elapsed_ms={}",
            path_label(&file_path),
            total,
            range_header,
            started.elapsed().as_millis()
        );
        return response_with_body(
            StatusCode::PARTIAL_CONTENT,
            content_type,
            length,
            Some(format!("bytes {start}-{end}/{total}")),
            Body::from_stream(ReaderStream::new(file.take(length))),
        );
    }

    tracing::info!(
        "[audiobook.media_request] file={} status=200 total={} range=none elapsed_ms={}",
        path_label(&file_path),
        total,
        started.elapsed().as_millis()
    );
    response_with_body(
        StatusCode::OK,
        content_type,
        total,
        None,
        Body::from_stream(ReaderStream::new(file)),
    )
}

/// Return an `http://127.0.0.1:<port>/stream?path=<encoded>` URL for a
/// validated app-managed file. Starts the media server on first call.
#[tauri::command]
pub async fn get_media_stream_url(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    let roots = allowed_media_roots(&app_handle)?;
    let canonical = canonical_path_within_roots(Path::new(&file_path), &roots)
        .map_err(|status| format!("Cannot stream media file (HTTP {})", status.as_u16()))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("Cannot stat media file: {error}"))?;
    let port = start(&app_handle).await?;
    let canonical_string = canonical.to_string_lossy().into_owned();
    let encoded = urlencoding::encode(&canonical_string);
    tracing::info!(
        "[audiobook.source_resolution] file={} size={} strategy=local-media-server port={}",
        path_label(&canonical),
        metadata.len(),
        port
    );
    Ok(format!("http://127.0.0.1:{port}/stream?path={encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;
    use std::fs::{self, OpenOptions};
    use tower05::ServiceExt;
    use uuid::Uuid;

    fn test_state(root: &Path) -> MediaServerState {
        MediaServerState {
            allowed_roots: Arc::new(vec![root.to_path_buf()]),
        }
    }

    fn temp_file(bytes: &[u8]) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("incrementum-media-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("fixture.m4b");
        fs::write(&path, bytes).expect("write test media");
        (root, path)
    }

    #[tokio::test]
    async fn no_range_streams_complete_body_with_matching_headers() {
        let bytes = b"0123456789abcdef";
        let (root, path) = temp_file(bytes);
        let app = Router::new()
            .route("/stream", get(stream_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/stream?path={}",
                        urlencoding::encode(&path.to_string_lossy())
                    ))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "audio/mp4");
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
        let (root, path) = temp_file(bytes);
        let app = Router::new()
            .route("/stream", get(stream_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/stream?path={}",
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
        let (root, path) = temp_file(b"0123456789");
        let app = Router::new()
            .route("/stream", get(stream_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/stream?path={}",
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
        let root = std::env::temp_dir().join(format!("incrementum-media-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("missing.m4b");
        let app = Router::new()
            .route("/stream", get(stream_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/stream?path={}",
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
    async fn large_file_response_keeps_streaming_body_lazy() {
        let root = std::env::temp_dir().join(format!("incrementum-media-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let path = root.join("large-fixture.m4b");
        let large_size = 64 * 1024 * 1024;
        OpenOptions::new()
            .create(true)
            .write(true)
            .open(&path)
            .expect("create sparse fixture")
            .set_len(large_size)
            .expect("size sparse fixture");

        let app = Router::new()
            .route("/stream", get(stream_handler))
            .with_state(test_state(&root));
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/stream?path={}",
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

    #[test]
    fn parses_open_ended_and_suffix_ranges() {
        assert_eq!(parse_range("bytes=3-", 10), Ok((3, 9)));
        assert_eq!(parse_range("bytes=-3", 10), Ok((7, 9)));
        assert!(parse_range("bytes=10-", 10).is_err());
        assert!(parse_range("bytes=1-2,4-5", 10).is_err());
    }
}
