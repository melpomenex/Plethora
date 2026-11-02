//! Loopback-only HTTP transport evidence for playback classification.

use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use reqwest::redirect::Policy;

use super::types::{MediaCompatError, MediaFailureCode, MediaTransportProbe, MediaUrlKind};

fn validate_probe_url(raw: &str) -> Result<reqwest::Url, MediaCompatError> {
    let url = reqwest::Url::parse(raw).map_err(|_| {
        MediaCompatError::new(
            MediaFailureCode::SourceTransportFailed,
            "The media URL could not be parsed.",
        )
        .with_detail("probe_unsupported_url")
    })?;

    let unsupported = || {
        MediaCompatError::new(
            MediaFailureCode::SourceTransportFailed,
            "The media URL is not a loopback media-server URL.",
        )
        .with_detail("probe_unsupported_url")
    };

    if url.scheme() != "http" {
        return Err(unsupported());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(unsupported());
    }
    if url.path() != "/stream" {
        return Err(unsupported());
    }
    let host = url.host_str().unwrap_or_default();
    if !matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]") {
        return Err(unsupported());
    }

    let port = url.port().unwrap_or(80);
    let server_port = crate::media_server::port();
    if server_port == 0 {
        return Err(MediaCompatError::new(
            MediaFailureCode::SourceServerUnavailable,
            "The local media server is not running.",
        )
        .with_detail("media_server_port=0"));
    }
    if port != server_port {
        return Err(unsupported());
    }

    Ok(url)
}

/// Probe a loopback media URL without downloading the file.
///
/// A `200`/`206` response with bytes proves transport access; it does not prove
/// that the container or codecs are playable. `reachable` is true whenever an
/// HTTP response was received, even for 4xx/5xx; callers use `status` to
/// classify those.
pub async fn probe_media_transport(raw: &str) -> Result<MediaTransportProbe, MediaCompatError> {
    let url = validate_probe_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::SourceTransportFailed,
                "The media transport probe could not be created.",
            )
            .with_detail(error.to_string())
        })?;

    let started = Instant::now();
    let response = client
        .get(url)
        .header(RANGE, "bytes=0-1")
        .header(reqwest::header::ACCEPT, "*/*")
        .send()
        .await;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let mut response = match response {
        Ok(response) => response,
        Err(error) => {
            return Ok(MediaTransportProbe {
                url_kind: MediaUrlKind::LoopbackMediaServer,
                reachable: false,
                status: None,
                content_type: None,
                content_length: None,
                accept_ranges: None,
                content_range: None,
                elapsed_ms,
                error: Some(error.to_string()),
            })
        }
    };

    let status = response.status().as_u16();
    let header_string = |name: &reqwest::header::HeaderName| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned)
    };
    let content_type = header_string(&CONTENT_TYPE);
    let accept_ranges = header_string(&ACCEPT_RANGES);
    let content_range = header_string(&CONTENT_RANGE);
    let content_length = header_string(&CONTENT_LENGTH).and_then(|value| value.parse().ok());

    // Read at most one chunk (and only if the server honored the range), then
    // drop the response. Never materialize a full file for a health check.
    let mut body_error = None;
    if status == 200 || status == 206 {
        match response.chunk().await {
            Ok(Some(chunk)) if chunk.is_empty() => {
                body_error = Some("probe_empty_body".to_string());
            }
            Ok(None) => body_error = Some("probe_empty_body".to_string()),
            Ok(Some(_)) => {}
            Err(error) => body_error = Some(error.to_string()),
        }
    }

    Ok(MediaTransportProbe {
        url_kind: MediaUrlKind::LoopbackMediaServer,
        reachable: true,
        status: Some(status),
        content_type,
        content_length,
        accept_ranges,
        content_range,
        elapsed_ms,
        error: body_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_loopback_and_unsupported_urls() {
        for url in [
            "https://127.0.0.1:1234/stream?path=x",
            "http://example.com/stream?path=x",
            "http://127.0.0.1:1234/other?path=x",
            "http://user:pass@127.0.0.1:1234/stream?path=x",
            "not a url",
        ] {
            let error = validate_probe_url(url).expect_err("url must be rejected");
            assert!(
                error.detail.as_deref() == Some("probe_unsupported_url")
                    || error.code == MediaFailureCode::SourceServerUnavailable,
                "unexpected rejection for {url}: {error:?}"
            );
        }
    }
}
