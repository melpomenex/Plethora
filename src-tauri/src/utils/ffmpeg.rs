//! FFmpeg command helper
//!
//! Provides a cross-platform way to run ffmpeg commands.
//! Uses system ffmpeg from PATH on all platforms.
//!
//! Note: Previously bundled ffmpeg as a sidecar, but this caused conflicts
//! with system ffmpeg on Linux (.deb packages). Now requires ffmpeg to be
//! installed on the system or bundled separately by platform-specific packages.

use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_shell::process::Command;
use tauri_plugin_shell::ShellExt;

/// Homebrew binary directories to search for ffmpeg on macOS.
const HOMEBREW_BIN_DIRS: &[&str] = &[
    "/opt/homebrew/bin", // Apple Silicon
    "/usr/local/bin",    // Intel Mac
];

/// The ffmpeg binary name (platform-specific).
fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// PATH separator character.
const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

fn env_override(base: &str) -> Option<PathBuf> {
    let key = format!("PLETHORA_{}_PATH", base.to_ascii_uppercase());
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

fn path_candidates(base: &str) -> Vec<PathBuf> {
    let binary = binary_name(base);
    let mut candidates = Vec::new();

    if let Some(override_path) = env_override(base) {
        candidates.push(override_path);
    }

    for dir in HOMEBREW_BIN_DIRS {
        candidates.push(PathBuf::from(dir).join(&binary));
    }

    #[cfg(windows)]
    {
        for key in ["LOCALAPPDATA", "USERPROFILE", "ProgramData"] {
            if let Some(root) = std::env::var_os(key).map(PathBuf::from) {
                candidates.push(
                    root.join("Microsoft")
                        .join("WinGet")
                        .join("Links")
                        .join(&binary),
                );
                candidates.push(root.join("scoop").join("shims").join(&binary));
                candidates.push(root.join("chocolatey").join("bin").join(&binary));
            }
        }
        candidates.push(PathBuf::from(r"C:\ffmpeg\bin").join(&binary));
    }

    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in path_var.split(PATH_SEP) {
        if !dir.is_empty() {
            candidates.push(PathBuf::from(dir).join(&binary));
        }
    }

    #[cfg(target_os = "linux")]
    for dir in ["/usr/bin", "/usr/local/bin", "/snap/bin"] {
        candidates.push(PathBuf::from(dir).join(&binary));
    }

    candidates
}

/// Resolve a system tool (`ffmpeg`, `ffprobe`, `gst-inspect-1.0`) to an
/// absolute path. Returns `None` when the tool is not installed.
pub(crate) fn resolve_tool_path(base: &str) -> Option<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    for candidate in path_candidates(base) {
        if !seen.insert(candidate.clone()) {
            continue;
        }
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_ffmpeg_path() -> Option<PathBuf> {
    resolve_tool_path("ffmpeg")
}

pub(crate) fn resolve_ffprobe_path() -> Option<PathBuf> {
    resolve_tool_path("ffprobe")
}

/// Build an enhanced PATH string that includes Homebrew directories.
pub(crate) fn enhanced_path() -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    let homebrew_dirs: Vec<&str> = HOMEBREW_BIN_DIRS
        .iter()
        .filter(|dir| !existing.contains(**dir))
        .copied()
        .collect();

    if homebrew_dirs.is_empty() {
        existing
    } else {
        format!(
            "{}{}{}",
            homebrew_dirs.join(&PATH_SEP.to_string()),
            PATH_SEP,
            existing
        )
    }
}

/// Get the ffmpeg command with PATH enhanced for macOS Homebrew.
pub fn ffmpeg_command<R: tauri::Runtime>(app_handle: &AppHandle<R>) -> Result<Command> {
    let ffmpeg_path = resolve_ffmpeg_path().ok_or_else(|| {
        anyhow!(
            "ffmpeg is not installed. Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
        )
    })?;

    let shell = app_handle.shell();
    let cmd = shell.command(ffmpeg_path).env("PATH", enhanced_path());
    Ok(cmd)
}

/// Check if ffmpeg is available on the system.
///
/// Uses the same resolved absolute path as `ffmpeg_command`, so a GUI app on
/// macOS does not report a false negative just because launchd did not inherit
/// the shell PATH.
pub async fn check_ffmpeg_available(_app_handle: &AppHandle) -> Result<bool, String> {
    let Some(path) = resolve_ffmpeg_path() else {
        return Ok(false);
    };
    let output = tokio::process::Command::new(path)
        .arg("-version")
        .env("PATH", enhanced_path())
        .output()
        .await
        .map_err(|error| format!("Failed to spawn ffmpeg: {error}"))?;
    Ok(output.status.success())
}

/// Run a tool's `-version` and return the first line, if available.
pub(crate) async fn tool_version(path: &Path) -> Option<String> {
    let output = tokio::process::Command::new(path)
        .arg("-version")
        .env("PATH", enhanced_path())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}
