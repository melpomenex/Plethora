//! Desktop external-open normalization: startup argv, single-instance relaunch,
//! and macOS `RunEvent::Opened` file URLs.
//!
//! Emits `external-open` events to the frontend with a stable JSON schema so
//! `src/lib/externalOpen.ts` can route into the existing import pipeline.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use url::Url as StdUrl;

/// Queued opens from cold-start argv before the webview listener is ready.
#[derive(Default)]
pub struct PendingExternalOpens(pub Mutex<Vec<ExternalOpenPayload>>);

/// Stable frontend contract — keep in sync with `src/types/externalOpen.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExternalOpenPayload {
    Files { paths: Vec<String> },
    DeepLink { url: String },
}

const DEEP_LINK_SCHEME: &str = "plethora";

/// Extensions Plethora can import (subset of documentStore / folder-import).
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "pdf", "epub", "md", "markdown", "html", "htm", "txt", "json", "apkg",
    "mp3", "wav", "m4a", "m4b", "aac", "ogg", "flac", "opus", "wma",
    "mp4", "webm", "mov", "mkv", "avi", "m4v",
    // Plethora backup / archive exports
    "db", "sqlite",
];

/// Parse command-line tokens into external-open payloads. Skips flags and the
/// executable path is already excluded by the caller.
pub fn parse_args<I>(args: I) -> Vec<ExternalOpenPayload>
where
    I: IntoIterator<Item = String>,
{
    let mut files: Vec<PathBuf> = Vec::new();
    let mut deep_links: Vec<String> = Vec::new();

    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        if let Some(url) = parse_deep_link(&arg) {
            deep_links.push(url);
            continue;
        }
        if let Some(path) = parse_file_arg(&arg) {
            if path_is_supported_import(&path) {
                files.push(path);
            } else {
                tracing::warn!(
                    "[ExternalOpen] ignoring unsupported file association: {}",
                    path.display()
                );
            }
        }
    }

    let mut out = Vec::new();
    for url in deep_links {
        out.push(ExternalOpenPayload::DeepLink { url });
    }
    if !files.is_empty() {
        out.push(ExternalOpenPayload::Files {
            paths: files
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        });
    }
    out
}

fn parse_deep_link(arg: &str) -> Option<String> {
    if arg.starts_with(&format!("{DEEP_LINK_SCHEME}://")) {
        return Some(arg.to_string());
    }
    if let Ok(url) = StdUrl::parse(arg) {
        if url.scheme() == DEEP_LINK_SCHEME {
            return Some(arg.to_string());
        }
    }
    None
}

fn parse_file_arg(arg: &str) -> Option<PathBuf> {
    if let Ok(url) = StdUrl::parse(arg) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
        return None;
    }
    let path = PathBuf::from(arg);
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

fn path_is_supported_import(path: &Path) -> bool {
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    if !canonical.is_file() {
        return false;
    }
    canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| ext.eq_ignore_ascii_case(supported))
        })
        .unwrap_or(false)
}

fn redact_for_log(payload: &ExternalOpenPayload) -> String {
    match payload {
        ExternalOpenPayload::Files { paths } => {
            format!("files({})", paths.len())
        }
        ExternalOpenPayload::DeepLink { url } => {
            if url.contains("auth") || url.contains("code=") || url.contains("token") {
                "deepLink(redacted)".to_string()
            } else {
                format!("deepLink({url})")
            }
        }
    }
}

/// Emit normalized payloads to the frontend and focus the main window.
pub fn dispatch(app: &AppHandle, payloads: Vec<ExternalOpenPayload>) {
    if payloads.is_empty() {
        focus_main_window(app);
        return;
    }
    for payload in payloads {
        tracing::info!("[ExternalOpen] dispatching {}", redact_for_log(&payload));
        if let Err(err) = app.emit("external-open", &payload) {
            tracing::warn!("[ExternalOpen] emit failed: {err}");
        }
    }
    focus_main_window(app);
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Queue startup argv for the frontend to drain once listeners are registered.
#[cfg(desktop)]
pub fn queue_startup_args(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let payloads = parse_args(args);
    if payloads.is_empty() {
        return;
    }
    if let Some(pending) = app.try_state::<PendingExternalOpens>() {
        pending.0.lock().expect("pending external opens poisoned").extend(payloads);
    }
}

#[tauri::command]
pub fn take_pending_external_opens(
    pending: tauri::State<'_, PendingExternalOpens>,
) -> Vec<ExternalOpenPayload> {
    std::mem::take(&mut *pending.0.lock().expect("pending external opens poisoned"))
}

/// Handle desktop startup argv after the app is ready (immediate emit path).
#[cfg(desktop)]
pub fn handle_startup_args(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let payloads = parse_args(args);
    if !payloads.is_empty() {
        dispatch(app, payloads);
    }
}

/// `RunEvent` hook for macOS file-open and lifecycle forwarding.
pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let mut files = Vec::new();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if path_is_supported_import(&path) {
                        files.push(path);
                    }
                } else if url.scheme() == DEEP_LINK_SCHEME {
                    dispatch(
                        app,
                        vec![ExternalOpenPayload::DeepLink {
                            url: url.to_string(),
                        }],
                    );
                    return;
                }
            }
            if !files.is_empty() {
                dispatch(
                    app,
                    vec![ExternalOpenPayload::Files {
                        paths: files
                            .into_iter()
                            .map(|p| p.to_string_lossy().into_owned())
                            .collect(),
                    }],
                );
            }
        }
        RunEvent::Resumed => {
            let _ = app.emit("app-lifecycle", serde_json::json!({ "phase": "resumed" }));
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        RunEvent::Suspended => {
            let _ = app.emit("app-lifecycle", serde_json::json!({ "phase": "suspended" }));
        }
        _ => {}
    }
}

/// Single-instance plugin callback — must stay fast; only normalize and emit.
#[cfg(desktop)]
pub fn on_second_instance(app: &AppHandle, argv: Vec<String>, _cwd: String) {
    tracing::info!(
        "[SingleInstance] activation ({} args)",
        argv.len().saturating_sub(1)
    );
    let payloads = parse_args(argv);
    dispatch(app, payloads);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_paths_and_skips_flags() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("book.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let payloads = parse_args(vec![
            "-f".into(),
            "--help".into(),
            pdf.to_string_lossy().into_owned(),
            "plethora://auth/callback?code=x".into(),
        ]);
        assert_eq!(payloads.len(), 2);
        match &payloads[0] {
            ExternalOpenPayload::DeepLink { url } => {
                assert!(url.contains("plethora://auth"));
            }
            _ => panic!("expected deep link first"),
        }
        match &payloads[1] {
            ExternalOpenPayload::Files { paths } => {
                assert_eq!(paths.len(), 1);
                assert!(paths[0].ends_with("book.pdf"));
            }
            _ => panic!("expected files"),
        }
    }

    #[test]
    fn parses_file_url_scheme() {
        let dir = tempfile::tempdir().unwrap();
        let md = dir.path().join("note.md");
        std::fs::write(&md, b"# hi").unwrap();
        let url = format!("file://{}", md.display());
        let payloads = parse_args(vec![url]);
        match &payloads[0] {
            ExternalOpenPayload::Files { paths } => {
                assert!(paths[0].ends_with("note.md"));
            }
            _ => panic!("expected files"),
        }
    }

    #[test]
    fn rejects_unknown_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("virus.exe");
        std::fs::write(&path, b"x").unwrap();
        let payloads = parse_args(vec![path.to_string_lossy().into_owned()]);
        assert!(payloads.is_empty());
    }
}
