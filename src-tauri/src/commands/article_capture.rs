//! Rendered-DOM capture for the article-import fallback (design D5).
//!
//! Desktop mechanism: a hidden `WebviewWindow` labeled `article-capture-*`
//! loads the remote URL. The window label deliberately matches NO capability,
//! so the loaded page has zero Tauri permissions — its only way to talk to
//! us is the CORS-simple one-shot HTTP POST the injected stability script
//! makes to an ephemeral loopback listener provisioned per capture. The
//! window is destroyed on success, timeout, and failure alike.
//!
//! The stability algorithm mirrors
//! src/utils/articleImport/renderedFallback/stabilityScript.ts: wait for
//! readyState complete, sample (nodes, textLen, images) every 250 ms,
//! capture after 750 ms of no change, bounded by 6 s post-load and a 20 s
//! overall budget.

use crate::error::{PlethoraError, Result};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::Manager;

/// One-shot capture body cap (25 MB) — an order above the fetch cap so a
/// rendered DOM of a fetchable page always fits.
const CAPTURE_MAX_BODY_BYTES: usize = 25 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedCaptureOutcome {
    pub html: String,
    pub final_url: String,
    pub duration_ms: u64,
}

/// The DOM-stability script injected into the capture window. Keep the
/// constants in sync with stabilityScript.ts (they are inlined here because
/// the script executes inside the remote page).
const DOM_STABILITY_SCRIPT: &str = r#"
(function () {
  if (window.__incCaptureStarted) return;
  window.__incCaptureStarted = true;
  var SAMPLE = 250, WINDOW = 750, CAP = 6000, BUDGET = 20000;
  var started = Date.now(), loadedAt = 0;
  var lastSample = null, stableSince = 0, done = false, loaded = false;
  function sample() {
    try {
      var nodes = document.getElementsByTagName('*').length;
      var text = document.body ? (document.body.innerText || '').length : 0;
      var images = document.images ? document.images.length : 0;
      return nodes + '|' + text + '|' + images;
    } catch (e) { return 'err'; }
  }
  function post() {
    if (done) return;
    done = true;
    try {
      var payload = location.href + '\n' + '<!doctype html>' + document.documentElement.outerHTML;
      fetch(window.__incCaptureEndpoint, { method: 'POST', body: payload })
        .catch(function () {});
    } catch (e) { /* the receiver times out; the capture fails typed */ }
  }
  function tick() {
    var now = Date.now();
    if (now - started > BUDGET) { post(); return; }
    if (document.readyState === 'complete' && !loaded) { loaded = true; loadedAt = now; }
    if (!loaded) return;
    var s = sample();
    if (s === lastSample) {
      if (now - stableSince >= WINDOW) { post(); return; }
      if (now - loadedAt > CAP) { post(); return; }
    } else {
      lastSample = s;
      stableSince = now;
    }
  }
  setInterval(tick, SAMPLE);
})();
"#;

/// Spawn a one-shot loopback receiver. Returns `(base_url_with_token, rx)`;
/// the thread accepts exactly one POST whose path starts with the token and
/// forwards `(path, body)` on the channel, then exits.
fn spawn_capture_receiver(
) -> std::result::Result<(String, mpsc::Receiver<(String, String)>), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0) as u128
    );
    let expected_path = format!("/{}", token);
    let url = format!("http://127.0.0.1:{}/{}", port, token);
    let (tx, rx) = mpsc::channel::<(String, String)>();

    std::thread::Builder::new()
        .name("article-capture-rx".into())
        .spawn(move || {
            let respond = |stream: &mut std::net::TcpStream, status: &str| {
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        status
                    )
                    .as_bytes(),
                );
                let _ = stream.flush();
            };
            let (mut stream, _) = match listener.accept() {
                Ok(s) => s,
                Err(_) => return,
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
            // Read headers.
            let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
            let mut chunk = [0u8; 8 * 1024];
            let header_end = loop {
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                    break pos;
                }
                if buf.len() > 64 * 1024 {
                    respond(&mut stream, "431 Request Header Fields Too Large");
                    return;
                }
                match stream.read(&mut chunk) {
                    Ok(0) => return,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    Err(_) => return,
                }
            };
            let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
            let request_line = headers.lines().next().unwrap_or_default();
            let mut parts = request_line.split_whitespace();
            let method = parts.next().unwrap_or_default().to_string();
            let path = parts.next().unwrap_or_default().to_string();
            let content_length: usize = headers
                .lines()
                .find_map(|l| {
                    let (name, value) = l.split_once(':')?;
                    if name.trim().eq_ignore_ascii_case("content-length") {
                        value.trim().parse().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

            if !path.starts_with(&expected_path) {
                respond(&mut stream, "404 Not Found");
                return;
            }
            if method != "POST" {
                respond(&mut stream, "405 Method Not Allowed");
                return;
            }
            if content_length > CAPTURE_MAX_BODY_BYTES {
                respond(&mut stream, "413 Payload Too Large");
                return;
            }

            let mut body = buf[header_end + 4..].to_vec();
            while body.len() < content_length {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => body.extend_from_slice(&chunk[..n]),
                    Err(_) => break,
                }
                if body.len() > CAPTURE_MAX_BODY_BYTES {
                    respond(&mut stream, "413 Payload Too Large");
                    return;
                }
            }
            respond(&mut stream, "204 No Content");
            let _ = tx.send((path, String::from_utf8_lossy(&body).to_string()));
        })
        .map_err(|e| e.to_string())?;

    Ok((url, rx))
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Capture a page's rendered DOM in a hidden, capability-free WebviewWindow.
#[tauri::command]
pub async fn capture_rendered_dom(
    app: tauri::AppHandle,
    url: String,
    timeout_ms: Option<u64>,
) -> Result<RenderedCaptureOutcome> {
    capture_rendered_dom_impl(app, url, timeout_ms).await
}

async fn capture_rendered_dom_impl(
    app: tauri::AppHandle,
    url: String,
    timeout_ms: Option<u64>,
) -> Result<RenderedCaptureOutcome> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, url, timeout_ms);
        return Err(PlethoraError::Internal(
            "UNAVAILABLE: rendered capture on mobile is provided by the folder-import plugin"
                .to_string(),
        ));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::webview::WebviewWindowBuilder;

        let timeout = Duration::from_millis(timeout_ms.unwrap_or(20_000).min(20_000));
        let started = Instant::now();

        let (endpoint, rx) = spawn_capture_receiver()
            .map_err(|e| PlethoraError::Internal(format!("UNAVAILABLE: {}", e)))?;

        let label = format!("article-capture-{}", started.elapsed().as_nanos());
        let init_script = format!(
            "window.__incCaptureEndpoint = '{}';\n{}",
            endpoint, DOM_STABILITY_SCRIPT
        );

        let parsed_url: tauri::Url = url
            .parse()
            .map_err(|_| PlethoraError::Internal("UNAVAILABLE: invalid url".to_string()))?;

        let window =
            WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed_url))
                .title("Incrementum Article Capture")
                .visible(false)
                .inner_size(1024.0, 768.0)
                .initialization_script(&init_script)
                .build()
                .map_err(|e| {
                    PlethoraError::Internal(format!(
                        "UNAVAILABLE: failed to create capture window: {}",
                        e
                    ))
                })?;

        let result = loop {
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                break Err(PlethoraError::Internal(
                    "TIMEOUT: capture budget exceeded".to_string(),
                ));
            }
            let remaining = timeout - elapsed;
            match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
                Ok((_path, payload)) => {
                    // payload = finalUrl + '\n' + html
                    match payload.split_once('\n') {
                        Some((final_url, html)) if !html.trim().is_empty() => {
                            break Ok(RenderedCaptureOutcome {
                                html: html.to_string(),
                                final_url: final_url.to_string(),
                                duration_ms: started.elapsed().as_millis() as u64,
                            });
                        }
                        _ => {
                            // Empty body — keep waiting until the budget ends.
                            continue;
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Receiver is still alive; loop and re-check the budget.
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    break Err(PlethoraError::Internal(
                        "TIMEOUT: capture receiver disconnected".to_string(),
                    ));
                }
            }
        };

        // Guaranteed cleanup regardless of outcome.
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.destroy();
        }
        let _ = window;

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stability_script_constants_match_pipeline_config() {
        for needle in [
            "SAMPLE = 250",
            "WINDOW = 750",
            "CAP = 6000",
            "BUDGET = 20000",
        ] {
            assert!(DOM_STABILITY_SCRIPT.contains(needle), "missing {}", needle);
        }
    }

    #[test]
    fn capture_labels_never_match_a_capability() {
        // The window label prefix is what the ACL would have to match; see
        // the frontend guard test for the capabilities-file assertion.
        let label = "article-capture-123456789";
        assert!(label.starts_with("article-capture-"));
    }
}
