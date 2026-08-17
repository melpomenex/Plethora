//! Loopback web proxy for the Web Browser tab.
//!
//! Serves `GET /web?url=<percent-encoded upstream>` on its **own** loopback
//! listener (design decision D2 — deliberately *not* merged into the shared
//! `media_server` listener). The proxy fetches the upstream document with
//! `reqwest`, strips `X-Frame-Options` / `Content-Security-Policy` so the page
//! can be framed, and injects a `<base href>` plus the selection bridge
//! `<script>` into HTML responses. Sub-resources then load directly from the
//! upstream origin, exactly as a browser would (D3).
//!
//! # Security model
//!
//! - The listener binds `127.0.0.1:0` only (loopback).
//! - Every fetched URL — the initial request **and** each redirect hop — is
//!   checked with [`crate::security::validate_url_not_private`]; non-`http(s)`
//!   schemes are rejected up front.
//! - No cookie jar and no credential forwarding: proxied browsing is
//!   logged-out by design.
//! - The bridge script is registered from the frontend via
//!   [`set_web_bridge_script`]; until then the proxy injects only the
//!   `<base>` tag (graceful degradation, no bridge).
//! - Proxied pages are served from their own port, so they are cross-origin
//!   from the media server's `/stream` and `/epub` routes (which send no CORS
//!   headers) and from the app origin.

use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::StreamExt;
use std::time::Duration;
use tokio::sync::OnceCell;

/// The port the web proxy is listening on. Initialized once per app process.
static WEB_PROXY_PORT: OnceCell<u16> = OnceCell::const_new();

/// The bridge script injected into proxied HTML documents, registered by the
/// frontend through [`set_web_bridge_script`]. `None` until registered.
static BRIDGE_SCRIPT: std::sync::RwLock<Option<String>> = std::sync::RwLock::new(None);

/// Desktop-browser user agent. The old `Incrementum/1.0` UA made many sites
/// serve a degraded or refusing response; an ordinary Chrome UA gets the
/// page the user's own browser would (D5).
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Upper bound on a buffered HTML response (bytes). Non-HTML responses are
/// streamed, so the cap only pins memory for the HTML path that needs
/// injection (D5).
const MAX_HTML_BYTES: usize = 32 * 1024 * 1024;
/// Upper bound on streamed non-HTML responses when the upstream declares a
/// `Content-Length`; protects the webview from hostile oversized downloads.
const MAX_STREAMED_BYTES: usize = 64 * 1024 * 1024;
/// Maximum redirect hops (D5).
const MAX_REDIRECTS: usize = 10;

/// Namespace field every bridge message carries (D4).
pub const BRIDGE_NS: &str = "plethora-web";

#[derive(serde::Deserialize)]
struct WebParams {
    url: String,
}

/// Start the web proxy server (idempotent) and return its port. Mirrors
/// `media_server::start`, but binds a **dedicated** listener per D2: proxied
/// third-party pages must never share an origin with `/stream` or `/epub`,
/// which serve files from the app data/cache directories.
pub async fn start() -> Result<u16, String> {
    let port = WEB_PROXY_PORT
        .get_or_try_init(|| async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|error| format!("web_proxy: failed to bind loopback: {error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("web_proxy: failed to read listener address: {error}"))?
                .port();

            let app = Router::new().route("/web", get(web_handler));

            tokio::spawn(async move {
                if let Err(error) = axum::serve(listener, app).await {
                    tracing::error!("[web_proxy] server stopped: {error}");
                }
            });

            tracing::info!("[web_proxy] listening on 127.0.0.1:{port}");
            Ok::<u16, String>(port)
        })
        .await?;
    Ok(*port)
}

/// Return the port the web proxy is on (0 if not started).
pub fn port() -> u16 {
    WEB_PROXY_PORT.get().copied().unwrap_or(0)
}

/// Validate a proxy target: parseable, `http(s)` scheme, and not a
/// private/loopback/link-local address. Runs before any network call.
fn validate_target(url: &str) -> Result<(), String> {
    let parsed =
        url::Url::parse(url).map_err(|error| format!("web_proxy: invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("web_proxy: unsupported scheme: {other}")),
    }
    crate::security::validate_url_not_private(url)
}

/// Validate one redirect hop. Pure, so it is unit-testable without an
/// `Attempt` (which `reqwest` only constructs internally).
fn validate_redirect_hop(next: &url::Url, hop_count: usize) -> Result<(), String> {
    if hop_count >= MAX_REDIRECTS {
        return Err(format!(
            "web_proxy: too many redirects (limit {MAX_REDIRECTS})"
        ));
    }
    if !matches!(next.scheme(), "http" | "https") {
        return Err(format!(
            "web_proxy: redirect to non-http(s) scheme: {}",
            next.scheme()
        ));
    }
    crate::security::validate_url_not_private(next.as_str())
        .map_err(|error| format!("web_proxy: redirect blocked: {error}"))
}

/// Redirect policy: validate every hop, refuse non-`http(s)` schemes, cap at
/// [`MAX_REDIRECTS`] (D5).
fn redirect_policy(attempt: reqwest::redirect::Attempt) -> reqwest::redirect::Action {
    match validate_redirect_hop(attempt.url(), attempt.previous().len()) {
        Ok(()) => attempt.follow(),
        Err(error) => attempt.error(error),
    }
}

/// Build the upstream client: desktop-browser UA, 30 s timeout, validated
/// redirect policy, no cookie jar, no credential forwarding (D5).
fn build_client(accept_language: Option<&HeaderValue>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(redirect_policy));
    if let Some(language) = accept_language {
        if let Ok(language) = language.to_str() {
            builder = builder.default_headers({
                let mut headers = HeaderMap::new();
                if let Ok(value) = HeaderValue::from_str(language) {
                    headers.insert(header::ACCEPT_LANGUAGE, value);
                }
                headers
            });
        }
    }
    builder
        .build()
        .map_err(|error| format!("web_proxy: failed to build HTTP client: {error}"))
}

/// Register the bridge script that the proxy injects into proxied HTML
/// documents. Called by the frontend before the first navigation; idempotent.
#[tauri::command]
pub fn set_web_bridge_script(script: String) -> Result<(), String> {
    *BRIDGE_SCRIPT
        .write()
        .map_err(|_| "web_proxy: bridge script lock poisoned".to_string())? = Some(script);
    Ok(())
}

fn bridge_script() -> Option<String> {
    BRIDGE_SCRIPT.read().ok().and_then(|guard| guard.clone())
}

/// Return an `http://127.0.0.1:<port>/web?url=<encoded>` URL for an upstream
/// page, starting the proxy on first call. Rejects invalid, non-`http(s)`, and
/// private targets up front so the frontend can surface the failure state
/// without loading an iframe (task 3.7).
#[tauri::command]
pub async fn get_web_proxy_url(url: String) -> Result<String, String> {
    validate_target(&url)?;
    let port = start().await?;
    let encoded = urlencoding::encode(&url);
    tracing::info!("[web_proxy] resolved proxy url for {}", url);
    Ok(format!("http://127.0.0.1:{port}/web?url={encoded}"))
}

/// Headers that must never reach the framed document. `X-Frame-Options` and
/// CSP are the whole reason the proxy exists; `Content-Length` is dropped on
/// the HTML path because injection changes the size. Hop-by-hop headers
/// (`Transfer-Encoding`, `Connection`, …) describe the *upstream* connection's
/// framing, not the body we re-serve: the proxy re-buffers (HTML) or re-streams
/// (non-HTML) a decoded body, so copying `Transfer-Encoding: chunked` would
/// make the webview try to de-chunk a body that is no longer chunked and the
/// page would fail to load.
fn is_blocked_header(name: &header::HeaderName, is_html: bool) -> bool {
    name == &header::X_FRAME_OPTIONS
        || name == &header::CONTENT_SECURITY_POLICY
        || name == &header::CONTENT_SECURITY_POLICY_REPORT_ONLY
        || name == &header::TRANSFER_ENCODING
        || name == &header::CONNECTION
        || name.as_str() == "keep-alive"
        || name == &header::TE
        || name == &header::TRAILER
        || name == &header::UPGRADE
        || name == &header::PROXY_AUTHENTICATE
        || name == &header::PROXY_AUTHORIZATION
        || (is_html && name == &header::CONTENT_LENGTH)
}

/// Copy upstream headers into a proxied response, skipping blocked ones.
fn copy_headers(from: &HeaderMap, to: &mut HeaderMap, is_html: bool) {
    for (name, value) in from {
        if is_blocked_header(name, is_html) {
            continue;
        }
        to.insert(name.clone(), value.clone());
    }
}

/// Find the byte offset at which to inject `<base>` + bridge.
///
/// Strategy (design D3): after the first `<head …>` open tag; else after a
/// leading `<!DOCTYPE …>` so the doctype stays first; else before the first
/// `<` (the first element tag); else prepend at 0.
fn find_injection_offset(body: &[u8]) -> usize {
    // 1. after the first <head …> tag (case-insensitive, tag boundary)
    let mut i = 0;
    while i + 5 <= body.len() {
        if body[i] == b'<' && body[i + 1..i + 5].eq_ignore_ascii_case(b"head") {
            // must be a tag boundary: whitespace, '>', or end-of-input after "head"
            let after = body.get(i + 5).copied();
            let is_boundary = after
                .map(|b| b == b'>' || b.is_ascii_whitespace())
                .unwrap_or(true);
            if is_boundary {
                // find the '>' closing the open tag
                if let Some(relative) = body[i + 5..].iter().position(|&b| b == b'>') {
                    return i + 5 + relative + 1;
                }
            }
            i += 1;
            continue;
        }
        i += 1;
    }

    // 2. after a leading <!DOCTYPE …> so it stays first in the document
    if body.starts_with(b"<!DOCTYPE") || body.starts_with(b"<!doctype") {
        if let Some(relative) = body.iter().position(|&b| b == b'>') {
            return relative + 1;
        }
    }

    // 3. before the first '<' (first element tag)
    if let Some(relative) = body.iter().position(|&b| b == b'<') {
        return relative;
    }

    // 4. prepend
    0
}

/// Escape a URL for use inside an HTML attribute value (`<base href="…">`).
fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Inject `<base href="<final url>">` and the bridge `<script>` into an HTML
/// body as ASCII bytes (safe for non-UTF-8 documents, D3).
fn inject_into_html(body: &[u8], final_url: &str, bridge: Option<&str>) -> Vec<u8> {
    let base_tag = format!(r#"<base href="{}">"#, escape_html_attribute(final_url));
    let script_tag = match bridge {
        Some(script) => format!("<script>{script}</script>"),
        None => String::new(),
    };
    let injection = format!("{base_tag}{script_tag}");

    let offset = find_injection_offset(body);
    let mut out = Vec::with_capacity(body.len() + injection.len());
    out.extend_from_slice(&body[..offset]);
    out.extend_from_slice(injection.as_bytes());
    out.extend_from_slice(&body[offset..]);
    out
}

/// A minimal error page served when the proxy itself cannot fulfill a request
/// (validation failure, non-success status, timeout, refused connection). It
/// contains a tiny inline script that posts a `proxy-error` bridge message to
/// `window.parent`, which the frontend surfaces as the failure state (3.7).
fn proxy_error_page(status: StatusCode, reason: &str, host: &str) -> Response {
    // The payload is embedded inside a <script> element, which browsers parse
    // as raw text (HTML character references are NOT decoded there). So the
    // values must be escaped for the JS string-literal context with JSON
    // escaping, and `<` must additionally become `\u003c` so a hostile value
    // can never close the script tag early.
    let json_escape = |value: &str| -> String {
        serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
    };
    let reason_js = json_escape(reason).replace('<', "\\u003c");
    let host_js = json_escape(host).replace('<', "\\u003c");
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>\
         (function(){{ try {{ window.parent.postMessage({{\
         ns:'{BRIDGE_NS}',type:'proxy-error',payload:{{\
         reason:{reason_js},host:{host_js}\
         }}}},'*'); }} catch(e) {{}} }})();\
         </script></head><body></body></html>"
    );
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
}

/// The `GET /web?url=…` handler.
async fn web_handler(Query(params): Query<WebParams>, headers: HeaderMap) -> Response {
    let requested_url = params.url; // axum's Query percent-decodes for us
    let host = url::Url::parse(&requested_url)
        .ok()
        .and_then(|u| u.host_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| requested_url.clone());

    if let Err(error) = validate_target(&requested_url) {
        tracing::warn!("[web_proxy] rejected url={} error={error}", requested_url);
        return proxy_error_page(StatusCode::BAD_REQUEST, &error, &host);
    }

    let accept_language = headers.get(header::ACCEPT_LANGUAGE).cloned();
    let client = match build_client(accept_language.as_ref()) {
        Ok(client) => client,
        Err(error) => {
            tracing::error!("[web_proxy] client build failed: {error}");
            return proxy_error_page(StatusCode::INTERNAL_SERVER_ERROR, &error, &host);
        }
    };

    let response = match client.get(&requested_url).send().await {
        Ok(response) => response,
        Err(error) => {
            let reason = if error.is_timeout() {
                "upstream timed out"
            } else if error.is_connect() {
                "upstream refused the connection"
            } else {
                "upstream request failed"
            };
            tracing::warn!(
                "[web_proxy] fetch failed url={} error={error}",
                requested_url
            );
            return proxy_error_page(StatusCode::BAD_GATEWAY, reason, &host);
        }
    };

    let status = response.status();
    if !status.is_success() {
        let reason = format!("upstream returned HTTP {}", status.as_u16());
        tracing::warn!(
            "[web_proxy] non-success url={} status={}",
            requested_url,
            status
        );
        return proxy_error_page(status, &reason, &host);
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_html = content_type.to_ascii_lowercase().starts_with("text/html")
        || content_type.to_ascii_lowercase().contains("xhtml");

    // Snapshot the upstream headers before the body is consumed.
    let mut upstream_headers = HeaderMap::new();
    copy_headers(response.headers(), &mut upstream_headers, is_html);

    if is_html {
        // Bounded read: check the declared length first, then read the body.
        let declared = upstream_headers
            .get(header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok());
        if let Some(length) = declared {
            if length > MAX_HTML_BYTES {
                return proxy_error_page(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    &format!(
                        "response exceeds the {} MiB limit",
                        MAX_HTML_BYTES / 1024 / 1024
                    ),
                    &host,
                );
            }
        }
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!(
                    "[web_proxy] body read failed url={} error={error}",
                    requested_url
                );
                return proxy_error_page(
                    StatusCode::BAD_GATEWAY,
                    "upstream body read failed",
                    &host,
                );
            }
        };
        if bytes.len() > MAX_HTML_BYTES {
            return proxy_error_page(
                StatusCode::PAYLOAD_TOO_LARGE,
                &format!(
                    "response exceeds the {} MiB limit",
                    MAX_HTML_BYTES / 1024 / 1024
                ),
                &host,
            );
        }
        let bridge = bridge_script();
        let injected = inject_into_html(&bytes, &final_url, bridge.as_deref());

        let mut response = Response::new(Body::from(injected));
        *response.status_mut() = status;
        *response.headers_mut() = upstream_headers;
        response
    } else {
        // Non-HTML: stream through untouched, only stripping blocked headers.
        // The size cap applies to declared lengths and to chunked streams
        // alike (take() truncates at the cap, protecting the webview).
        let declared = upstream_headers
            .get(header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok());
        if let Some(length) = declared {
            if length > MAX_STREAMED_BYTES {
                return proxy_error_page(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    &format!(
                        "response exceeds the {} MiB limit",
                        MAX_STREAMED_BYTES / 1024 / 1024
                    ),
                    &host,
                );
            }
        }

        let stream = response.bytes_stream().take(MAX_STREAMED_BYTES + 1);
        let mut proxied = Response::new(Body::from_stream(stream));
        *proxied.status_mut() = status;
        *proxied.headers_mut() = upstream_headers;
        proxied
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_html() -> &'static [u8] {
        b"<html><head><title>Test</title></head><body>hello</body></html>"
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(validate_target("ftp://example.com/file").is_err());
        assert!(validate_target("file:///etc/passwd").is_err());
        assert!(validate_target("javascript:alert(1)").is_err());
        assert!(validate_target("https://example.com/page").is_ok());
        assert!(validate_target("http://example.com/page").is_ok());
    }

    #[test]
    fn rejects_private_and_loopback_targets() {
        assert!(validate_target("http://127.0.0.1:9527/").is_err());
        assert!(validate_target("http://localhost/secret").is_err());
        assert!(validate_target("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_target("http://192.168.1.1/").is_err());
        assert!(validate_target("http://[::1]/api").is_err());
        assert!(validate_target("http://10.0.0.5/internal").is_err());
    }

    #[test]
    fn rejects_redirect_to_private_target() {
        let private = url::Url::parse("http://127.0.0.1:9527/").unwrap();
        assert!(validate_redirect_hop(&private, 0).is_err());
        let link_local = url::Url::parse("http://169.254.169.254/latest/meta-data").unwrap();
        assert!(validate_redirect_hop(&link_local, 0).is_err());
    }

    #[test]
    fn rejects_redirect_to_non_http_scheme() {
        let ftp = url::Url::parse("ftp://example.com/").unwrap();
        assert!(validate_redirect_hop(&ftp, 0).is_err());
    }

    #[test]
    fn caps_redirects_at_limit() {
        let public = url::Url::parse("https://example.com/next").unwrap();
        assert!(validate_redirect_hop(&public, MAX_REDIRECTS - 1).is_ok());
        assert!(validate_redirect_hop(&public, MAX_REDIRECTS).is_err());
    }

    #[test]
    fn allows_public_redirect_hop() {
        let public = url::Url::parse("https://example.com/next").unwrap();
        assert!(validate_redirect_hop(&public, 0).is_ok());
    }

    #[test]
    fn strips_frame_options_and_csp() {
        let mut upstream = HeaderMap::new();
        upstream.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
        upstream.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("frame-ancestors 'none'"),
        );
        upstream.insert(
            header::CONTENT_SECURITY_POLICY_REPORT_ONLY,
            HeaderValue::from_static("default-src 'self'"),
        );
        upstream.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        upstream.insert(header::CONTENT_LENGTH, HeaderValue::from_static("1234"));

        let mut stripped = HeaderMap::new();
        copy_headers(&upstream, &mut stripped, true);
        assert!(stripped.get(header::X_FRAME_OPTIONS).is_none());
        assert!(stripped.get(header::CONTENT_SECURITY_POLICY).is_none());
        assert!(stripped
            .get(header::CONTENT_SECURITY_POLICY_REPORT_ONLY)
            .is_none());
        assert!(stripped.get(header::CONTENT_LENGTH).is_none());
        // Content-Type preserved verbatim, charset included.
        assert_eq!(
            stripped.get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn strips_hop_by_hop_headers_from_chunked_upstream() {
        // Regression: Cloudflare-style upstreams (e.g. quantamagazine.org)
        // send `Transfer-Encoding: chunked` + `Connection: keep-alive`. The
        // proxy re-buffers/re-streams a decoded body, so those framing headers
        // must never reach the webview — a `Transfer-Encoding: chunked` on a
        // body that is no longer chunked makes the page fail to load.
        let mut upstream = HeaderMap::new();
        upstream.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        upstream.insert(
            header::TRANSFER_ENCODING,
            HeaderValue::from_static("chunked"),
        );
        upstream.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
        upstream.insert(
            header::HeaderName::from_static("keep-alive"),
            HeaderValue::from_static("timeout=5"),
        );
        upstream.insert(header::UPGRADE, HeaderValue::from_static("h2c"));
        upstream.insert(header::TE, HeaderValue::from_static("trailers"));

        let mut stripped_html = HeaderMap::new();
        copy_headers(&upstream, &mut stripped_html, true);
        assert!(stripped_html.get(header::TRANSFER_ENCODING).is_none());
        assert!(stripped_html.get(header::CONNECTION).is_none());
        assert!(stripped_html
            .get(header::HeaderName::from_static("keep-alive"))
            .is_none());
        assert!(stripped_html.get(header::UPGRADE).is_none());
        assert!(stripped_html.get(header::TE).is_none());

        let mut stripped_streamed = HeaderMap::new();
        copy_headers(&upstream, &mut stripped_streamed, false);
        assert!(stripped_streamed.get(header::TRANSFER_ENCODING).is_none());
        assert!(stripped_streamed.get(header::CONNECTION).is_none());
        // Content-Type still flows through on both paths.
        assert_eq!(
            stripped_streamed.get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn keeps_content_length_on_streamed_path() {
        let mut upstream = HeaderMap::new();
        upstream.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
        upstream.insert(header::CONTENT_LENGTH, HeaderValue::from_static("999"));
        upstream.insert(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("SAMEORIGIN"),
        );

        let mut stripped = HeaderMap::new();
        copy_headers(&upstream, &mut stripped, false);
        assert_eq!(stripped.get(header::CONTENT_LENGTH).unwrap(), "999");
        assert!(stripped.get(header::X_FRAME_OPTIONS).is_none());
    }

    #[test]
    fn injects_after_head_in_normal_document() {
        let out = inject_into_html(sample_html(), "https://example.com/a", Some("window.__x=1"));
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with(
            "<html><head><base href=\"https://example.com/a\"><script>window.__x=1</script><title>"
        ));
        assert!(text.ends_with("</html>"));
    }

    #[test]
    fn injects_before_first_tag_when_no_head() {
        let body = b"<html><body>no head</body></html>";
        let out = inject_into_html(body, "https://example.com/", None);
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("<base href=\"https://example.com/\"><html><body>"));
    }

    #[test]
    fn injects_after_doctype_only_document() {
        let body = b"<!DOCTYPE html>";
        let out = inject_into_html(body, "https://example.com/", Some("window.__x=1"));
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with(
            "<!DOCTYPE html><base href=\"https://example.com/\"><script>window.__x=1</script>"
        ));
    }

    #[test]
    fn injects_after_head_when_comment_precedes() {
        let body = b"<!-- comment --><head><title>x</title></head>";
        let out = inject_into_html(body, "https://example.com/", None);
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("<!-- comment --><head><base href=\"https://example.com/\">"));
    }

    #[test]
    fn non_utf8_body_round_trips_apart_from_injection() {
        // Shift-JIS / EUC-JP bytes (0x82 0xA0, 0x83 0x41) are invalid UTF-8.
        let body = b"<html><head></head><body>\x82\xa0\x83\x41</body></html>";
        let out = inject_into_html(body, "https://example.com/", None);
        // Original bytes must appear verbatim after the injection point.
        let offset = find_injection_offset(body);
        assert_eq!(&out[..offset], &body[..offset]);
        let injection_len = b"<base href=\"https://example.com/\">".len();
        assert_eq!(&out[offset + injection_len..], &body[offset..]);
        // The non-ASCII payload survives untouched.
        assert!(out.windows(2).any(|w| w == [0x82, 0xA0]));
        assert!(out.windows(2).any(|w| w == [0x83, 0x41]));
    }

    #[test]
    fn escapes_base_href_attribute() {
        let out = inject_into_html(sample_html(), "https://example.com/a?b=1&c=\"2\"", None);
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains(r#"<base href="https://example.com/a?b=1&amp;c=&quot;2&quot;">"#));
    }

    #[tokio::test]
    async fn proxy_error_page_escapes_js_and_script_breakout() {
        // A hostile reason containing a quote, backslash, and </script> must
        // not break out of the inline <script> block.
        let response = proxy_error_page(
            StatusCode::BAD_GATEWAY,
            "upstream 'refused' \\ connection </script><script>window.pwned=1",
            "evil.example</script><script>window.pwned=1",
        );
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024)
            .await
            .unwrap();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        // The hostile payload's literal </script> must not survive in a form
        // that terminates the script element; only the \u003c-escaped form
        // appears (the page's own closing </script> tag is legitimate).
        assert!(!body.contains("</script><script>window.pwned"));
        assert!(body.contains("\\u003c/script"));
        assert!(body.contains("proxy-error"));
        assert!(body.contains("evil.example"));
    }
}
