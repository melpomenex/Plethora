//! ThreadReaderApp (TRA) adapter — full-thread unrolling.
//!
//! Ports the retrieval strategy of the project's `xcom.py` reference:
//! ThreadReaderApp's unrolled-thread surface returns the complete authored
//! thread (text + images, in order) with one no-auth request, which the X
//! GraphQL `TweetResultByRestId` endpoint can never provide (it returns a
//! single tweet, no conversation timeline).
//!
//! Live surface (verified 2026-08-19 and 2026-08-2x against
//! threadreaderapp.com):
//! - `GET /api/v0/ping/{id}.json` — alive; any in-thread id resolves to the
//!   thread root: `{"code":200,"pong":"<root id>"}`; missing threads return
//!   `{"code":404,"message":"Thread not found"}`.
//! - `GET /thread/{root_id}.html` — alive; server-renders the full ordered
//!   thread: `<div id="tweet_N" class="content-tweet allow-preview"
//!   data-screenname="..." data-tweet="{id}" dir="auto">` blocks with
//!   `<br />`-separated text, `<span class="entity-image">` images
//!   (`pbs.twimg.com/media/...`), and `<span class="entity-embed">`
//!   blockquotes for quoted/embedded posts.
//! - `GET /api/v0/thread/{id}.json` — DEAD as of 2026-08-19 (404 HTML for
//!   every id); kept as a compatibility probe: if it ever returns the
//!   documented `{"code":200,"content":[...]}` contract again, the JSON
//!   `content[]` array is preferred (exactly like `xcom.py.thread()`).
//!
//! All network access goes through the [`TraHttp`] trait so the pipeline and
//! every function are unit-testable against fixtures/mocks without network.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

const TRA_BASE: &str = "https://threadreaderapp.com";

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/// TRA page fetch timeout (these pages are small; a hung server must not
/// block the reader for long).
const TRA_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(TRA_TIMEOUT)
        .build()
        .expect("failed to build reqwest client")
});

// ── typed errors ──────────────────────────────────────────────────────────

/// Typed retrieval errors, serialized `{type, message}` to match the app's
/// established `PlethoraError` contract so the frontend can branch on
/// `error.type` (see `src/lib/tauri.ts` `coerceError`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", content = "message")]
pub enum ThreadError {
    /// Post is private, deleted, or otherwise unavailable on X itself.
    ThreadUnavailable(String),
    /// ThreadReaderApp failed (server error, malformed page, ...).
    ThreadReaderUnavailable(String),
    /// Rate limited by ThreadReaderApp or X.
    RateLimited(String),
    /// Network-level failure (DNS, TLS, connect, timeout).
    NetworkError(String),
    /// The input URL does not contain a valid status id.
    InvalidUrl(String),
}

impl std::fmt::Display for ThreadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ThreadUnavailable(m) => write!(f, "Thread unavailable: {m}"),
            Self::ThreadReaderUnavailable(m) => write!(f, "ThreadReaderApp unavailable: {m}"),
            Self::RateLimited(m) => write!(f, "Rate limited: {m}"),
            Self::NetworkError(m) => write!(f, "Network error: {m}"),
            Self::InvalidUrl(m) => write!(f, "Invalid URL: {m}"),
        }
    }
}

// ── injectable HTTP layer ─────────────────────────────────────────────────

/// A minimal HTTP response (status + body) so the adapter can classify
/// 200 / 404 / 429 without depending on a concrete client.
#[derive(Debug, Clone)]
pub struct TraResponse {
    pub status: u16,
    pub body: String,
}

/// Injectable GET layer for ThreadReaderApp calls. Tests substitute a mock;
/// production uses [`LiveTraHttp`].
#[async_trait::async_trait]
pub trait TraHttp: Send + Sync {
    /// GET `url` with optional extra headers. Transport-level failures are
    /// returned as `Err` (network error); HTTP status codes are delivered in
    /// [`TraResponse::status`].
    async fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<TraResponse, String>;
}

/// Production [`TraHttp`] backed by the shared reqwest client.
pub struct LiveTraHttp;

#[async_trait::async_trait]
impl TraHttp for LiveTraHttp {
    async fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<TraResponse, String> {
        let mut req = HTTP.get(url).header("user-agent", UA);
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("ThreadReaderApp request failed: {}", e))?;
        let status = resp.status().as_u16();
        let body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read ThreadReaderApp response: {}", e))?;
        Ok(TraResponse { status, body })
    }
}

// ── parsed model ──────────────────────────────────────────────────────────

/// A single authored post extracted from an unrolled thread page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraPost {
    pub id: String,
    pub screen_name: String,
    /// Preserved-break text: tags stripped, entities decoded, `<br>` → `\n`.
    pub text: String,
    /// Allow-listed media URLs (`pbs.twimg.com` / `video.twimg.com`).
    pub media: Vec<String>,
    /// Status-link ids referenced by this post (quotes/embeds), excluding the
    /// thread's own post ids.
    pub ref_ids: Vec<String>,
}

/// Author/thread header parsed from the TRA page (outside the post blocks).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TraHeader {
    pub name: Option<String>,
    pub screen_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Unix seconds from the header's `data-time` attribute, if present.
    pub unix_time: Option<i64>,
}

// ── ping ──────────────────────────────────────────────────────────────────

/// Resolve any in-thread status id to the canonical thread root id.
///
/// Returns `Ok(Some(root_id))` when a thread exists, `Ok(None)` when TRA has
/// no unrolled thread for this id (ping `code: 404`), and a typed error for
/// transport/server/rate-limit failures.
pub async fn ping_thread(http: &dyn TraHttp, tweet_id: &str) -> Result<Option<String>, ThreadError> {
    let url = format!("{}/api/v0/ping/{}.json", TRA_BASE, tweet_id);
    let resp = http
        .get(&url, &[])
        .await
        .map_err(|e| ThreadError::NetworkError(e))?;

    match resp.status {
        404 => Ok(None),
        429 => Err(ThreadError::RateLimited(format!(
            "ThreadReaderApp ping rate-limited (HTTP 429) for id {}",
            tweet_id
        ))),
        200 => {
            let json: serde_json::Value = serde_json::from_str(&resp.body).map_err(|e| {
                ThreadError::ThreadReaderUnavailable(format!("Malformed ping response: {}", e))
            })?;
            match json.get("code").and_then(|c| c.as_i64()) {
                Some(200) => Ok(json
                    .get("pong")
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string())),
                Some(404) => Ok(None),
                _ => Err(ThreadError::ThreadReaderUnavailable(format!(
                    "Unexpected ping response: {}",
                    resp.body.chars().take(200).collect::<String>()
                ))),
            }
        }
        status => Err(ThreadError::ThreadReaderUnavailable(format!(
            "ThreadReaderApp ping failed: HTTP {}",
            status
        ))),
    }
}

// ── unroll (JSON compat probe, then HTML page) ────────────────────────────

/// Fetch the raw server-rendered unrolled thread page.
pub async fn fetch_unrolled_html(
    http: &dyn TraHttp,
    root_id: &str,
) -> Result<String, ThreadError> {
    let url = format!("{}/thread/{}.html", TRA_BASE, root_id);
    let resp = http
        .get(&url, &[])
        .await
        .map_err(|e| ThreadError::NetworkError(e))?;
    match resp.status {
        404 => Err(ThreadError::ThreadUnavailable(format!(
            "No unrolled thread found for id {} (HTTP 404)",
            root_id
        ))),
        429 => Err(ThreadError::RateLimited(format!(
            "ThreadReaderApp rate-limited (HTTP 429) for thread {}",
            root_id
        ))),
        200 => Ok(resp.body),
        status => Err(ThreadError::ThreadReaderUnavailable(format!(
            "ThreadReaderApp thread page failed: HTTP {}",
            status
        ))),
    }
}

/// Compatibility probe for the documented JSON route
/// `GET /api/v0/thread/{id}.json`. Returns `Ok(Some(json))` only when the
/// route responds with the documented `{"code":200,...}` contract; `Ok(None)`
/// when the route is dead/absent (current state) or the payload is not the
/// expected contract. Errors only on transport failures.
pub async fn fetch_thread_json(
    http: &dyn TraHttp,
    root_id: &str,
) -> Result<Option<serde_json::Value>, ThreadError> {
    let url = format!("{}/api/v0/thread/{}.json", TRA_BASE, root_id);
    let resp = http
        .get(&url, &[])
        .await
        .map_err(|e| ThreadError::NetworkError(e))?;
    if resp.status != 200 {
        return Ok(None);
    }
    let json: serde_json::Value = match serde_json::from_str(&resp.body) {
        Ok(v) => v,
        Err(_) => return Ok(None), // HTML error page or non-JSON body
    };
    if json.get("code").and_then(|c| c.as_i64()) == Some(200) {
        Ok(Some(json))
    } else {
        Ok(None)
    }
}

/// Unroll a thread: prefer the JSON route when it is alive, otherwise parse
/// the server-rendered HTML page. Returns the ordered posts (empty when the
/// page contains no posts — the caller decides the single-post fallback).
pub async fn fetch_unrolled_thread(
    http: &dyn TraHttp,
    root_id: &str,
) -> Result<Vec<TraPost>, ThreadError> {
    Ok(fetch_unrolled_thread_with_header(http, root_id).await?.0)
}

/// Unroll a thread plus its page header (author name/avatar/date) in one
/// pass, so the pipeline never fetches the TRA page twice. The JSON route is
/// preferred when alive; the HTML page otherwise.
pub async fn fetch_unrolled_thread_with_header(
    http: &dyn TraHttp,
    root_id: &str,
) -> Result<(Vec<TraPost>, TraHeader), ThreadError> {
    // 1. JSON compatibility path (route currently dead; kept per xcom.py
    //    contract so a future re-enable is used automatically).
    if let Some(json) = fetch_thread_json(http, root_id).await? {
        if let Some(posts) = parse_thread_json_content(&json, root_id) {
            let header = TraHeader {
                screen_name: json
                    .get("screenName")
                    .and_then(|s| s.as_str())
                    .map(String::from),
                ..Default::default()
            };
            return Ok((posts, header));
        }
    }

    // 2. Server-rendered HTML page.
    let html = fetch_unrolled_html(http, root_id).await?;
    let posts = parse_unrolled_thread(&html);
    let header = parse_thread_header(&html);
    Ok((posts, header))
}

// ── HTML parsing ──────────────────────────────────────────────────────────

/// Block-level tags that introduce a line break in the extracted text.
fn is_break_tag(tag: &str) -> bool {
    matches!(
        tag,
        "br" | "p" | "div" | "li" | "tr" | "blockquote" | "h1" | "h2" | "h3" | "h4" | "h5"
            | "h6" | "section" | "article" | "ul" | "ol" | "table" | "pre"
    )
}

/// Decode the HTML entities ThreadReaderApp actually emits (plus numeric
/// decimal/hex references). A tiny, bounded decoder — full HTML5 entity
/// tables are unnecessary for TRA's plain-text output.
pub fn decode_html_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            // Copy a full UTF-8 char.
            let ch_len = utf8_len(bytes[i]);
            let end = (i + ch_len).min(bytes.len());
            out.push_str(&s[i..end]);
            i = end;
            continue;
        }
        // Try to find the terminating ';'
        let semi = s[i..].find(';').map(|p| i + p);
        match semi {
            Some(end) => {
                let entity = &s[i + 1..end];
                let decoded: Option<String> = if let Some(num) = entity.strip_prefix('#') {
                    let code = if let Some(hex) = num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        num.parse::<u32>().ok()
                    };
                    code.and_then(char::from_u32).map(|c| c.to_string())
                } else {
                    named_entity(entity).map(str::to_string)
                };
                match decoded {
                    Some(d) => {
                        out.push_str(&d);
                        i = end + 1;
                    }
                    None => {
                        out.push('&');
                        i += 1;
                    }
                }
            }
            None => {
                out.push('&');
                i += 1;
            }
        }
    }
    out
}

fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

fn named_entity(e: &str) -> Option<&'static str> {
    Some(match e {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "#39" => "'",
        "nbsp" => "\u{00a0}",
        "hellip" => "…",
        "mdash" => "—",
        "ndash" => "–",
        "rsquo" => "’",
        "lsquo" => "‘",
        "ldquo" => "“",
        "rdquo" => "”",
        "middot" => "·",
        "bull" => "•",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        "euro" => "€",
        "pound" => "£",
        "yen" => "¥",
        _ => return None,
    })
}

/// Remove HTML comments and `<script>`/`<style>` blocks (defensive: TRA pages
/// should contain none of these, but a malicious/odd page must not inject
/// text or confuse the block scanner).
fn strip_foreign_blocks(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        let lower = rest.to_ascii_lowercase();
        let comment = lower.find("<!--").map(|p| (p, "-->" as &str));
        let script = find_open_tag(&lower, "script").map(|p| (p, "</script>" as &str));
        let style = find_open_tag(&lower, "style").map(|p| (p, "</style>" as &str));
        let Some((pos, closer)) = [comment, script, style]
            .into_iter()
            .flatten()
            .min_by_key(|c| c.0)
        else {
            out.push_str(rest);
            break;
        };
        // Skip past the opening tag (comments have none).
        let start_after = if closer == "-->" {
            pos + 4
        } else {
            match find_tag_end(rest, pos) {
                Some(end) => end + 1,
                None => {
                    out.push_str(rest);
                    break;
                }
            }
        };
        out.push_str(&rest[..pos]);
        let Some(close_rel) = rest[start_after..].to_ascii_lowercase().find(closer) else {
            break; // unterminated — drop the rest
        };
        let close = start_after + close_rel + closer.len();
        rest = &rest[close..];
    }
    out
}

/// Find a case-insensitive `<name` open tag start.
fn find_open_tag(lower: &str, name: &str) -> Option<usize> {
    let needle = format!("<{}", name);
    let mut idx = 0;
    while let Some(rel) = lower[idx..].find(&needle) {
        let pos = idx + rel;
        let after = lower[pos + needle.len()..].as_bytes().first().copied();
        // Must be followed by whitespace, '>', or '/'
        if after.map_or(true, |b| b.is_ascii_whitespace() || b == b'>' || b == b'/') {
            return Some(pos);
        }
        idx = pos + needle.len();
    }
    None
}

/// Find the end of a tag starting at `html[pos] == '<'`, respecting quotes.
fn find_tag_end(html: &str, pos: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut i = pos;
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == q {
                quote = None;
            }
        } else if b == b'"' || b == b'\'' {
            quote = Some(b);
        } else if b == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Extract a quoted attribute value: `data-tweet="123"` or `data-tweet='123'`.
/// Indices come from the ASCII-lowercased copy, which preserves byte offsets.
fn attr_value(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rel = lower[i..].find(name)?;
        let pos = i + rel;
        // The name must be a whole attribute word (not "xdata-tweet").
        let prev = if pos == 0 { b' ' } else { bytes[pos - 1] };
        if !(prev.is_ascii_alphanumeric() || prev == b'_' || prev == b'-') {
            let mut j = pos + name.len();
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'=' {
                j += 1;
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                    let quote = bytes[j];
                    let value_start = j + 1;
                    let value_end = lower[value_start..].find(quote as char)? + value_start;
                    return Some(tag[value_start..value_end].to_string());
                }
            }
        }
        i = pos + name.len();
    }
    None
}

/// Locate the next `content-tweet` block that carries a `data-tweet` id.
/// Returns the opening tag's end (position right after `>`) and the tag text.
fn next_content_tweet(html: &str, from: usize) -> Option<(usize, String)> {
    let lower = html.to_ascii_lowercase();
    let mut idx = from;
    while let Some(rel) = lower[idx..].find("<div") {
        let tag_start = idx + rel;
        let after_open = tag_start + 4;
        let following = lower.as_bytes().get(after_open).copied();
        if !following.map_or(true, |b| b.is_ascii_whitespace() || b == b'>' || b == b'/') {
            idx = after_open;
            continue; // e.g. "<divid" — not a div tag
        }
        let tag_end = find_tag_end(html, tag_start)?;
        let tag = &html[tag_start..=tag_end];
        let tag_lower = &lower[tag_start..=tag_end];
        let has_content_tweet = tag_lower
            .split(|c: char| c == '"' || c == '\'')
            .any(|seg| {
                seg.trim()
                    .split_whitespace()
                    .any(|tok| tok == "content-tweet")
            });
        if has_content_tweet && attr_value(tag, "data-tweet").is_some() {
            return Some((tag_end + 1, tag.to_string()));
        }
        idx = after_open;
    }
    None
}

/// Extract the balanced inner content of a div block: scans from `inner_start`
/// (right after the opening tag) tracking `<div` / `</div` nesting until the
/// matching close tag. Returns `(inner, end_pos_after_close)`.
fn extract_div_block(html: &str, inner_start: usize) -> Option<(String, usize)> {
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut depth: i32 = 1;
    let mut i = inner_start;
    let mut last_close: Option<usize> = None;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'<' {
            let rest = &lower[i..];
            if rest.starts_with("</div") {
                let after = i + 5;
                let following = bytes.get(after).copied();
                if following.map_or(true, |f| f.is_ascii_whitespace() || f == b'>') {
                    if let Some(end) = find_tag_end(html, i) {
                        depth -= 1;
                        last_close = Some(end + 1);
                        if depth == 0 {
                            return Some((html[inner_start..i].to_string(), end + 1));
                        }
                        i = end + 1;
                        continue;
                    }
                }
            } else if rest.starts_with("<div") {
                let after = i + 4;
                let following = bytes.get(after).copied();
                if following.map_or(true, |f| f.is_ascii_whitespace() || f == b'>') {
                    if let Some(end) = find_tag_end(html, i) {
                        depth += 1;
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    // Unbalanced (malformed page): return everything to the end as inner.
    last_close.map(|lc| (html[inner_start..lc].to_string(), lc))
}

/// Strip tags from TRA post inner HTML, mapping `<br>` and block tags to
/// newlines; keeps text content (entities decoded afterwards).
///
/// TRA uses `<br />` as the line separator and emits `<br />\n<br />\n` for a
/// blank paragraph break, so after a `<br>` we skip following whitespace:
/// `text.<br />\n<br />\nnext` becomes `text.\n\nnext` (paragraphs preserved,
/// no quadruple blank lines).
fn inner_text(inner: &str) -> String {
    let mut out = String::with_capacity(inner.len());
    let bytes = inner.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let Some(end) = find_tag_end(inner, i) else {
                break;
            };
            let tag = &inner[i + 1..end];
            let name_end = tag
                .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
                .unwrap_or(tag.len());
            let name = tag[..name_end].to_ascii_lowercase();
            if name == "br" {
                out.push('\n');
                // Skip whitespace immediately after the <br> so the literal
                // newlines TRA emits around it collapse into the break itself.
                i = end + 1;
                while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                continue;
            }
            if is_break_tag(&name) {
                out.push('\n');
            }
            // script/style inner content was already removed by
            // strip_foreign_blocks; nothing else needs special handling.
            i = end + 1;
        } else {
            let ch_len = utf8_len(bytes[i]);
            let end = (i + ch_len).min(bytes.len());
            out.push_str(&inner[i..end]);
            i = end;
        }
    }
    decode_html_entities(&out)
}

/// Collect allow-listed media URLs (`pbs.twimg.com` / `video.twimg.com`) from
/// a post's inner HTML: `img[data-src]`, `img[src]`, `a[href]`.
fn extract_media(inner: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    let lower = inner.to_ascii_lowercase();
    for needle in ["data-src=\"", "data-src='", "src=\"", "src='", "href=\"", "href='"] {
        let mut idx = 0;
        while let Some(rel) = lower[idx..].find(needle) {
            let start = idx + rel + needle.len();
            let quote = needle.as_bytes().last().copied().unwrap_or(b'"');
            let Some(end_rel) = inner[start..].find(quote as char) else {
                break;
            };
            let url = &inner[start..start + end_rel];
            if is_allowlisted_media_url(url) {
                if seen.insert(url.to_string()) {
                    urls.push(url.to_string());
                }
            }
            idx = start + end_rel;
        }
    }
    urls
}

/// Media URLs are constrained to X's media origins (see design §19).
fn is_allowlisted_media_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://pbs.twimg.com/") || lower.starts_with("https://video.twimg.com/"))
        && url.len() < 512
}

/// Extract referenced status ids (`x.com|twitter.com/<user>/status/<id>`)
/// from a post's inner HTML.
fn extract_ref_ids(inner: &str) -> Vec<String> {
    let lower = inner.to_ascii_lowercase();
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for needle in ["twitter.com/", "x.com/"] {
        let mut idx = 0;
        while let Some(rel) = lower[idx..].find(needle) {
            let start = idx + rel + needle.len();
            let rest = &inner[start..];
            // <user>/status/<digits> — user is [A-Za-z0-9_]{1,64}
            let user_end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(rest.len());
            let user = &rest[..user_end];
            if user.is_empty() || user.len() > 64 {
                idx = start + 1;
                continue;
            }
            let after_user = start + user_end;
            let rest2 = &inner[after_user..];
            if !rest2.starts_with("/status/") {
                idx = start + 1;
                continue;
            }
            let id_rest = &rest2["/status/".len()..];
            let id_end = id_rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(id_rest.len());
            let id = &id_rest[..id_end];
            if id.len() >= 10 && id.len() <= 25 {
                if seen.insert(id.to_string()) {
                    ids.push(id.to_string());
                }
            }
            idx = after_user + "/status/".len() + id_end;
        }
    }
    ids
}

/// Parse an unrolled TRA thread page into ordered posts.
///
/// Only `div.content-tweet` blocks carrying a `data-tweet` attribute are
/// ingested (the homepage's preview cards have the same class but no
/// `data-tweet`). Document order is the authored order; duplicate post ids
/// are dropped.
pub fn parse_unrolled_thread(html: &str) -> Vec<TraPost> {
    let clean = strip_foreign_blocks(html);

    // Pass 1: locate blocks and extract raw data.
    let mut raw: Vec<(String, String, String, Vec<String>, Vec<String>)> = Vec::new();
    let mut pos = 0;
    while let Some((inner_start, tag)) = next_content_tweet(&clean, pos) {
        let id = attr_value(&tag, "data-tweet").unwrap_or_default();
        let screen_name = attr_value(&tag, "data-screenname").unwrap_or_default();
        let Some((inner, end)) = extract_div_block(&clean, inner_start) else {
            break;
        };
        let text = inner_text(&inner);
        let text = text.trim().to_string();
        let media = extract_media(&inner);
        let refs = extract_ref_ids(&inner);
        raw.push((id, screen_name, text, media, refs));
        pos = end;
    }

    // Pass 2: dedupe by id, then drop refs pointing at the thread's own posts.
    let own_ids: HashSet<String> = raw.iter().map(|r| r.0.clone()).collect();
    let mut seen = HashSet::new();
    let mut posts = Vec::new();
    for (id, screen_name, text, media, refs) in raw {
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let ref_ids: Vec<String> = refs
            .into_iter()
            .filter(|r| !own_ids.contains(r))
            .collect();
        posts.push(TraPost {
            id,
            screen_name,
            text,
            media,
            ref_ids,
        });
    }
    posts
}

/// Parse the documented JSON contract (`{"code":200,"content":[<html>,...]}`)
/// exactly like `xcom.py.thread()`: each content item is an HTML fragment of
/// one post (tag-strip text, `pbs.twimg.com/media/` regex, status-link
/// regex). Returns `None` when the payload does not match the contract.
///
/// Per-post ids are taken from embedded `data-tweet` attributes when present
/// (the TRA pages embed them); otherwise the root id is used for the first
/// post and synthetic `{root}_{i}` ids for the rest (the JSON route provides
/// no per-post ids — enrichment for those posts is skipped gracefully).
pub fn parse_thread_json_content(json: &serde_json::Value, root_id: &str) -> Option<Vec<TraPost>> {
    if json.get("code").and_then(|c| c.as_i64()) != Some(200) {
        return None;
    }
    let content = json.get("content")?.as_array()?;
    let mut posts = Vec::new();
    let mut seen = HashSet::new();
    for (i, item) in content.iter().enumerate() {
        let Some(html) = item.as_str() else {
            continue; // tolerate non-string items in the content array
        };
        // Prefer per-post ids embedded in the fragment (TRA-idiomatic).
        let id = find_first_data_tweet_id(html)
            .unwrap_or_else(|| {
                if i == 0 {
                    root_id.to_string()
                } else {
                    format!("{}_{}", root_id, i)
                }
            });
        if !seen.insert(id.clone()) {
            continue;
        }
        let clean = strip_foreign_blocks(html);
        let text = inner_text(&clean);
        let text = text.trim().to_string();
        let media = extract_media(&clean);
        let refs = extract_ref_ids(&clean);
        let screen_name = json
            .get("screenName")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();
        posts.push(TraPost {
            id,
            screen_name: screen_name.clone(),
            text,
            media,
            ref_ids: refs,
        });
    }
    Some(posts)
}

fn find_first_data_tweet_id(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let needle = "data-tweet=\"";
    let pos = lower.find(needle)?;
    let start = pos + needle.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    let id = &rest[..end];
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Some(id.to_string())
    } else {
        None
    }
}

/// Parse the thread header (author name/screen name/avatar + unix time) from
/// the TRA page. All fields optional — the reader falls back to the first
/// post's `data-screenname` and enrichment avatars.
pub fn parse_thread_header(html: &str) -> TraHeader {
    let clean = strip_foreign_blocks(html);
    let mut header = TraHeader::default();

    /// Backtrack from `pos` to the `<` opening the enclosing tag, so
    /// `find_tag_end` starts its quote-aware scan at the tag boundary.
    fn tag_start(html: &str, pos: usize) -> usize {
        html[..pos].rfind('<').unwrap_or(pos)
    }

    // twitter_name: <h4 class="twitter_name"><a href="/user/X">Name</a></h4>
    // The display name is the anchor text inside the h4.
    if let Some(pos) = clean.to_ascii_lowercase().find("twitter_name") {
        let start = tag_start(&clean, pos);
        if let Some(h4_end) = find_tag_end(&clean, start) {
            if let Some(a_rel) = clean[h4_end + 1..].find("<a ") {
                let a_start = h4_end + 1 + a_rel;
                if let Some(a_end) = find_tag_end(&clean, a_start) {
                    let after = a_end + 1;
                    if let Some(lt) = clean[after..].find('<') {
                        let name = clean[after..after + lt].trim();
                        if !name.is_empty() {
                            header.name = Some(decode_html_entities(name));
                        }
                    }
                }
            }
        }
    }

    // screenName tw-follow: <a href="//twitter.com/X">@X</a>
    if let Some(pos) = clean.to_ascii_lowercase().find("tw-follow") {
        if let Some(a_href) = clean[pos..].find("twitter.com/") {
            let start = pos + a_href + "twitter.com/".len();
            let end = clean[start..]
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(clean.len() - start);
            let screen = &clean[start..start + end];
            if !screen.is_empty() {
                header.screen_name = Some(screen.to_string());
            }
        }
    }

    // Avatar: <div class="prof-image"> ... <img src="https://pbs.twimg.com/profile_images/...">
    if let Some(pos) = clean.to_ascii_lowercase().find("prof-image") {
        if let Some(src) = clean[pos..]
            .to_ascii_lowercase()
            .find("src=\"https://pbs.twimg.com/profile_images/")
        {
            let start = pos + src + "src=\"".len();
            let end = clean[start..].find('"').unwrap_or(clean.len() - start);
            header.avatar_url = Some(clean[start..start + end].to_string());
        }
    }

    // data-time="<unix>"
    if let Some(rel) = clean.to_ascii_lowercase().find("data-time=\"") {
        let start = rel + "data-time=\"".len();
        let end = clean[start..].find('"').unwrap_or(clean.len() - start);
        if let Ok(t) = clean[start..start + end].parse::<i64>() {
            header.unix_time = Some(t);
        }
    }

    header
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── fixtures ──────────────────────────────────────────────────────────

    /// Mirrors the observed TRA thread-page markup: ordered `content-tweet`
    /// blocks with `data-tweet`/`data-screenname`, `<br />` paragraphs,
    /// entity-image spans, an entity-embed blockquote, and entities.
    const MULTI_POST_HTML: &str = r#"<!DOCTYPE html>
<html>
<head><title>Thread</title></head>
<body>
<div class="container narrow pb-5">
  <div class="mb-2 d-flex align-items-center">
    <div class="prof-image">
      <a href=/user/alicescholar><img class="mx-auto rounded-circle" src="https://pbs.twimg.com/profile_images/1147907785079701505/BnDVIRVC_bigger.jpg" alt="Alice Scholar Profile picture"></a>
    </div>
    <h4 class="twitter_name"><a href="/user/alicescholar">Alice Scholar</a></h4>
    <div class="screenName tw-follow">
      <a href="//twitter.com/alicescholar">@alicescholar</a>
    </div>
    <div class="thread-info"><a href="https://twitter.com/alicescholar/status/2001" class="time" data-time="1787096017" title="Read on X" target="_blank">Aug 18</a> <span class="dot2">&bull;</span> 3 tweets</div>
  </div>
  <div id="tweet_1" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="alicescholar" data-tweet="2001" dir="auto">
    First post with &amp; entities and <b>bold</b> text.<br />
<br />
Second paragraph of the first post.
    <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
  </div>
  <div id="tweet_2" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="alicescholar" data-tweet="2002" dir="auto">
    Second post with an image:<br />
<br />
<span class="entity-image"><a href="https://pbs.twimg.com/media/HQCuFDgboAA9veU.jpg" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/HQCuFDgboAA9veU.jpg"></a></span>
<span class="entity-image"><a href="https://pbs.twimg.com/media/HKBc8aXbsAAbLjJ.png" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/HKBc8aXbsAAbLjJ.png"></a></span>
    <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
  </div>
  <div id="tweet_3" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="alicescholar" data-tweet="2003" dir="auto">
    Third post quoting someone &amp; mentioning @NASA_Technology:<br />
<br />
<span class="entity-embed"><span class="twitter-player"><blockquote class="twitter-tweet" data-conversation="none" data-align="center" data-dnt="true"><a href="https://twitter.com/AnthropicAI/status/2065597531644743999">https://twitter.com/AnthropicAI/status/2065597531644743999</a></blockquote></span></span>
    <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
  </div>
</div>
</body>
</html>"#;

    const SINGLE_POST_HTML: &str = r#"<div id="tweet_1" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="bob" data-tweet="9001" dir="auto">
  Just a single ordinary post, no thread.<br />
Second line.
  <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
</div>"#;

    const MALFORMED_HTML: &str = "<html><body><p>No thread blocks here.</p><div class=\"other-card\">hi</div></body></html>";

const REAL_PAGE_SAMPLE: &str = r#"<div class="prof-image">
    <a href=/user/MXS_Nightmare><img class="mx-auto rounded-circle" src="https://pbs.twimg.com/profile_images/1147907785079701505/BnDVIRVC_bigger.jpg" alt="🇺🇲Miller🦅 🌡Show More Replies! ⭐Independent🌟 Profile picture" data-controller="twitter-profile" data-twtrid="799308922175655936" data-action="error->twitter-profile#error" ></a>
  </div>
  <div class="flex-grow-1" style="overflow:hidden">
    <div class="pl-2">
     <div class="d-flex align-items-center justify-content-between">
      <h4 class="twitter_name"><a href="/user/MXS_Nightmare">🇺🇲Miller🦅 🌡Show More Replies! ⭐Independent🌟</a>
      </h4>
        <form method="post" action="/account/subscribe/MXS_Nightmare" class="text-center gaClickEvent ml-2" data-category="threadbuttons" data-action="subscribe" data-label="above-thread">
          <button type="submit" class="btn btn-dark btn-xxsm" style="white-space:nowrap;">
            <i class="fas fa-bell"></i>
            Subscribe
          </button>
        </form>
      </div>
      <div class="d-flex align-items-center justify-content-between">
         <div class="screenName tw-follow">
          <a href="//twitter.com/MXS_Nightmare">@MXS_Nightmare</a>
         </div>
      </div>
       
        <div class="thread-info"><a href="https://twitter.com/MXS_Nightmare/status/2089858284660662307" class="time"data-time="1787096017"title="Read on X" target="_blank">Aug 18</a>
<div id="tweet_1" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="MXS_Nightmare" data-tweet="2089858284660662307" dir="auto">
        Some of you all might have seen my upset last week in regards to Mars to Table contest- 😂💨😡⚡️🧙‍♂️💥<br />
<br />
This might be a standard NASA thing, but what upset me most was, the stated mission at beginning of contest (at orig. reg.) was "5 YEARS".<br />
<br />
On current portal it is now 500 sols..
        <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
      </div>
      <div id="tweet_2" class="content-tweet allow-preview" data-controller="thread" data-action="click->thread#showTweet" data-screenname="MXS_Nightmare" data-tweet="2089858616614687166" dir="auto">
        So that means, anyone who delayed final registration until, say, the last month of signup - officially that was July - worked under the presumption that yes, this project involves creating a solution capable of supporting 5 years.<br />
<br />
Ok, doable right?<br />
Well, they changed scenario.🤣
        <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
      </div>
      <div "#;

    /// Regression fixture: a trimmed sample of a REAL ThreadReaderApp page
    /// (fetched live 2026-08-2x, thread 2089858284660662307) — real header
    /// markup (prof-image avatar, twitter_name, tw-follow), entity-image
    /// span, and the exact data-tweet/data-screenname block structure.
    #[test]
    fn parses_real_world_page_sample() {
        let posts = parse_unrolled_thread(REAL_PAGE_SAMPLE);
        assert_eq!(posts.len(), 2);
        assert_eq!(posts[0].id, "2089858284660662307");
        assert_eq!(posts[0].screen_name, "MXS_Nightmare");
        assert_eq!(posts[1].id, "2089858616614687166");
        // <br /> paragraph breaks preserved; emoji/unicode intact.
        assert!(posts[0].text.contains("Mars to Table contest- \u{1F602}\u{1F4A8}"));
        assert!(posts[0].text.contains("was \"5 YEARS\""));
        assert!(posts[0].text.contains("On current portal it is now 500 sols.."));
        // Header parsed from the real markup.
        let h = parse_thread_header(REAL_PAGE_SAMPLE);
        assert!(h.avatar_url.unwrap_or_default().starts_with("https://pbs.twimg.com/profile_images/"));
        assert!(h.name.unwrap_or_default().contains("Miller"));
    }

    /// Homepage-style preview card: same class but NO data-tweet — must be
    /// ignored by the parser (only thread pages are ingested).
    const PREVIEW_CARD_HTML: &str = r#"<div class="content-tweet">It could be naive, but then again, I am a world traveler:<br /><br />Preview text.</div>
<div id="tweet_1" class="content-tweet allow-preview" data-screenname="alice" data-tweet="5555" dir="auto">Real thread post.</div>"#;

    /// Repeated post ids must be deduped (defensive; TRA is already deduped).
    const DUP_IDS_HTML: &str = r#"<div id="tweet_1" class="content-tweet allow-preview" data-screenname="alice" data-tweet="7777" dir="auto">First copy.</div>
<div id="tweet_2" class="content-tweet allow-preview" data-screenname="alice" data-tweet="7777" dir="auto">Second copy of same id.</div>
<div id="tweet_3" class="content-tweet allow-preview" data-screenname="alice" data-tweet="8888" dir="auto">Third post.</div>"#;

    /// Four-image layout + video.twimg.com link in a single post.
    const FOUR_IMAGE_HTML: &str = r#"<div id="tweet_1" class="content-tweet allow-preview" data-screenname="media" data-tweet="3001" dir="auto">
<span class="entity-image"><a href="https://pbs.twimg.com/media/a1.jpg" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/a1.jpg"></a></span>
<span class="entity-image"><a href="https://pbs.twimg.com/media/a2.jpg" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/a2.jpg"></a></span>
<span class="entity-image"><a href="https://pbs.twimg.com/media/a3.jpg" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/a3.jpg"></a></span>
<span class="entity-image"><a href="https://pbs.twimg.com/media/a4.jpg" target="_blank"><img alt="Image" src="/images/1px.png" data-src="https://pbs.twimg.com/media/a4.jpg"></a></span>
<a href="https://video.twimg.com/ext_tw_video/3001/pu/vid/avc1/3001.mp4">video</a>
</div>"#;

    /// Entity decoding fixture.
    const ENTITIES_HTML: &str = r#"<div class="content-tweet allow-preview" data-screenname="ents" data-tweet="4001" dir="auto">
AT&amp;T &lt;3 &#39;quotes&#39; &quot;double&quot; &nbsp; &#x1F600; &#8212; end.
</div>"#;

    // ── parser tests ──────────────────────────────────────────────────────

    #[test]
    fn parses_multi_post_page_in_order() {
        let posts = parse_unrolled_thread(MULTI_POST_HTML);
        assert_eq!(posts.len(), 3);
        assert_eq!(posts[0].id, "2001");
        assert_eq!(posts[1].id, "2002");
        assert_eq!(posts[2].id, "2003");
        assert!(posts.iter().all(|p| p.screen_name == "alicescholar"));
    }

    #[test]
    fn preserves_br_paragraphs() {
        let posts = parse_unrolled_thread(MULTI_POST_HTML);
        assert_eq!(
            posts[0].text,
            "First post with & entities and bold text.\n\nSecond paragraph of the first post."
        );
    }

    #[test]
    fn decodes_entities() {
        let posts = parse_unrolled_thread(ENTITIES_HTML);
        assert_eq!(
            posts[0].text,
            "AT&T <3 'quotes' \"double\" \u{00a0} \u{1F600} \u{2014} end."
        );
    }

    #[test]
    fn extracts_images_and_dedupes() {
        let posts = parse_unrolled_thread(MULTI_POST_HTML);
        assert_eq!(posts[0].media.len(), 0);
        assert_eq!(
            posts[1].media,
            vec![
                "https://pbs.twimg.com/media/HQCuFDgboAA9veU.jpg",
                "https://pbs.twimg.com/media/HKBc8aXbsAAbLjJ.png",
            ]
        );
        // 4-image layout + a video.twimg.com link (allow-listed host).
        let four = parse_unrolled_thread(FOUR_IMAGE_HTML);
        assert_eq!(four[0].media.len(), 5);
        assert_eq!(four[0].media[0], "https://pbs.twimg.com/media/a1.jpg");
        assert!(four[0].media.iter().any(|m| m.contains("ext_tw_video")));
    }

    #[test]
    fn extracts_quoted_ref_ids_excluding_own() {
        let posts = parse_unrolled_thread(MULTI_POST_HTML);
        assert!(posts[2].ref_ids.contains(&"2065597531644743999".to_string()));
        // own ids must be excluded
        assert!(!posts[2].ref_ids.contains(&"2003".to_string()));
        assert!(posts[0].ref_ids.is_empty());
    }

    #[test]
    fn parses_single_post() {
        let posts = parse_unrolled_thread(SINGLE_POST_HTML);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "9001");
        assert_eq!(posts[0].screen_name, "bob");
        assert_eq!(posts[0].text, "Just a single ordinary post, no thread.\nSecond line.");
    }

    #[test]
    fn malformed_page_yields_empty() {
        assert!(parse_unrolled_thread(MALFORMED_HTML).is_empty());
    }

    #[test]
    fn ignores_homepage_preview_cards_without_data_tweet() {
        let posts = parse_unrolled_thread(PREVIEW_CARD_HTML);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "5555");
        assert_eq!(posts[0].text, "Real thread post.");
    }

    #[test]
    fn dedupes_repeated_post_ids() {
        let posts = parse_unrolled_thread(DUP_IDS_HTML);
        assert_eq!(posts.len(), 2);
        assert_eq!(posts[0].id, "7777");
        assert_eq!(posts[0].text, "First copy.");
        assert_eq!(posts[1].id, "8888");
    }

    #[test]
    fn strips_comments_and_scripts() {
        let html = format!(
            "<!-- <div class=\"content-tweet\" data-tweet=\"1\">fake</div> --><script>var x=\"<div data-tweet=\\\"2\\\">\";</script>{}",
            SINGLE_POST_HTML
        );
        let posts = parse_unrolled_thread(&html);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "9001");
    }

    #[test]
    fn parses_thread_header() {
        let h = parse_thread_header(MULTI_POST_HTML);
        assert_eq!(h.name.as_deref(), Some("Alice Scholar"));
        assert_eq!(h.screen_name.as_deref(), Some("alicescholar"));
        assert!(h
            .avatar_url
            .as_deref()
            .unwrap_or_default()
            .starts_with("https://pbs.twimg.com/profile_images/"));
        assert_eq!(h.unix_time, Some(1787096017));
    }

    #[test]
    fn parses_json_contract_content() {
        let json = serde_json::json!({
            "code": 200,
            "id": "2001",
            "screenName": "alicescholar",
            "size": 2,
            "content": [
                "First <b>post</b> text.<br /><br />Second para. <span class=\"entity-image\"><a href=\"https://pbs.twimg.com/media/aa.jpg\">x</a></span>",
                "<div class=\"content-tweet\" data-tweet=\"2002\">Second post with a <a href=\"https://twitter.com/Someone/status/9999999999999999999\">quote link</a>.</div>"
            ]
        });
        let posts = parse_thread_json_content(&json, "2001").unwrap();
        assert_eq!(posts.len(), 2);
        assert_eq!(posts[0].id, "2001");
        assert_eq!(posts[0].screen_name, "alicescholar");
        assert_eq!(
            posts[0].text,
            "First post text.\n\nSecond para. x"
        );
        assert_eq!(posts[0].media, vec!["https://pbs.twimg.com/media/aa.jpg"]);
        assert_eq!(posts[1].id, "2002");
        assert!(posts[1].ref_ids.contains(&"9999999999999999999".to_string()));
    }

    #[test]
    fn json_contract_mismatch_returns_none() {
        assert!(parse_thread_json_content(&serde_json::json!({"code": 404}), "1").is_none());
        assert!(parse_thread_json_content(&serde_json::json!({"code": 200}), "1").is_none());
        assert!(parse_thread_json_content(&serde_json::json!({"code": 200, "content": "nope"}), "1").is_none());
    }

    #[test]
    fn decodes_named_and_numeric_entities() {
        assert_eq!(decode_html_entities("&amp; &lt; &gt; &quot; &apos; &#39; &nbsp;"), "& < > \" ' ' \u{00a0}");
        assert_eq!(decode_html_entities("&#x41;&#66;"), "AB");
        assert_eq!(decode_html_entities("no entities here"), "no entities here");
        assert_eq!(decode_html_entities("a & b & c"), "a & b & c");
    }

    // ── mock HTTP + ping tests ────────────────────────────────────────────

    struct MockTraHttp {
        /// url → (status, body)
        responses: std::collections::HashMap<String, (u16, String)>,
        /// urls whose GET should fail with a network error
        network_failures: Vec<String>,
    }

    impl MockTraHttp {
        fn new(responses: Vec<(&str, u16, &str)>) -> Self {
            let map = responses
                .into_iter()
                .map(|(u, s, b)| (u.to_string(), (s, b.to_string())))
                .collect();
            Self {
                responses: map,
                network_failures: Vec::new(),
            }
        }
        fn fail_on(mut self, urls: Vec<&str>) -> Self {
            self.network_failures = urls.into_iter().map(String::from).collect();
            self
        }
    }

    #[async_trait::async_trait]
    impl TraHttp for MockTraHttp {
        async fn get(&self, url: &str, _headers: &[(&str, &str)]) -> Result<TraResponse, String> {
            if self.network_failures.iter().any(|u| u == url) {
                return Err(format!("network error for {}", url));
            }
            match self.responses.get(url) {
                Some((status, body)) => Ok(TraResponse {
                    status: *status,
                    body: body.clone(),
                }),
                None => Err(format!("unexpected url {}", url)),
            }
        }
    }

    fn ping_url(id: &str) -> String {
        format!("{}/api/v0/ping/{}.json", TRA_BASE, id)
    }

    #[tokio::test]
    async fn ping_returns_pong_on_200() {
        let http = MockTraHttp::new(vec![(
            &ping_url("1234567890"),
            200,
            r#"{"code":200,"pong":"1234567890"}"#,
        )]);
        assert_eq!(
            ping_thread(&http, "1234567890").await.unwrap(),
            Some("1234567890".to_string())
        );
    }

    #[tokio::test]
    async fn ping_resolves_midthread_id_to_root() {
        let http = MockTraHttp::new(vec![(
            &ping_url("9876543210"),
            200,
            r#"{"code":200,"pong":"1111111111"}"#,
        )]);
        assert_eq!(
            ping_thread(&http, "9876543210").await.unwrap(),
            Some("1111111111".to_string())
        );
    }

    #[tokio::test]
    async fn ping_returns_none_on_404_code() {
        let http = MockTraHttp::new(vec![(
            &ping_url("1234567890"),
            200,
            r#"{"code":404,"message":"Thread not found"}"#,
        )]);
        assert_eq!(ping_thread(&http, "1234567890").await.unwrap(), None);
    }

    #[tokio::test]
    async fn ping_returns_none_on_http_404() {
        let http = MockTraHttp::new(vec![(&ping_url("1234567890"), 404, "Not Found")]);
        assert_eq!(ping_thread(&http, "1234567890").await.unwrap(), None);
    }

    #[tokio::test]
    async fn ping_malformed_json_is_typed_error() {
        let http = MockTraHttp::new(vec![(&ping_url("1234567890"), 200, "not json at all")]);
        match ping_thread(&http, "1234567890").await {
            Err(ThreadError::ThreadReaderUnavailable(_)) => {}
            other => panic!("expected ThreadReaderUnavailable, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn ping_unexpected_code_is_typed_error() {
        let http = MockTraHttp::new(vec![(&ping_url("1"), 200, r#"{"code":500}"#)]);
        assert!(matches!(
            ping_thread(&http, "1").await,
            Err(ThreadError::ThreadReaderUnavailable(_))
        ));
    }

    #[tokio::test]
    async fn ping_network_error_is_typed_error() {
        let http = MockTraHttp::new(vec![]).fail_on(vec![&ping_url("1234567890")]);
        match ping_thread(&http, "1234567890").await {
            Err(ThreadError::NetworkError(_)) => {}
            other => panic!("expected NetworkError, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn ping_429_is_rate_limited() {
        let http = MockTraHttp::new(vec![(&ping_url("1"), 429, "rate limited")]);
        assert!(matches!(
            ping_thread(&http, "1").await,
            Err(ThreadError::RateLimited(_))
        ));
    }

    #[tokio::test]
    async fn unroll_prefers_json_when_alive() {
        // JSON route returns the documented contract → used, HTML never fetched.
        let http = MockTraHttp::new(vec![(
            &format!("{}/api/v0/thread/2001.json", TRA_BASE),
            200,
            r#"{"code":200,"screenName":"alice","content":["First post text. <span class=\"entity-image\"><a href=\"https://pbs.twimg.com/media/aa.jpg\">x</a></span>"]}"#,
        )]);
        let posts = fetch_unrolled_thread(&http, "2001").await.unwrap();
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].text, "First post text. x");
        assert_eq!(posts[0].media.len(), 1);
    }

    #[tokio::test]
    async fn unroll_falls_back_to_html_when_json_dead() {
        // JSON route returns an HTML 404 page (current live behavior).
        let http = MockTraHttp::new(vec![
            (
                &format!("{}/api/v0/thread/2001.json", TRA_BASE),
                404,
                "<!DOCTYPE html><html><body>Not Found</body></html>",
            ),
            (
                &format!("{}/thread/2001.html", TRA_BASE),
                200,
                SINGLE_POST_HTML,
            ),
        ]);
        let posts = fetch_unrolled_thread(&http, "2001").await.unwrap();
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "9001");
    }

    #[tokio::test]
    async fn unroll_html_404_is_thread_unavailable() {
        let http = MockTraHttp::new(vec![
            (
                &format!("{}/api/v0/thread/2001.json", TRA_BASE),
                404,
                "Not Found",
            ),
            (
                &format!("{}/thread/2001.html", TRA_BASE),
                404,
                "Not Found",
            ),
        ]);
        match fetch_unrolled_thread(&http, "2001").await {
            Err(ThreadError::ThreadUnavailable(_)) => {}
            other => panic!("expected ThreadUnavailable, got {:?}", other),
        }
    }
}
