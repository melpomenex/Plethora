//! Tauri plugin for Windows on-device intelligence.
//!
//! The Rust side is a thin shim. On Windows, work is delegated to WinRT
//! probes in `windows/` and `winrt/`. On every other target, status-style
//! commands return a typed `platform_unsupported` snapshot or `{ code, message }`
//! error so callers fall back without linking Windows SDKs.
//!
//! Reserved command ownership:
//! - `windows_capabilities` — capability snapshot
//! - `windows_lm_*` — Phi Silica / LanguageModel generate, stream, cancel, warmup
//! - `windows_ocr_status` — OCR readiness probe
//! - `windows_ocr_recognize` — OCR inference on image bytes

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::TauriPlugin,
    AppHandle, Wry,
};

pub const PLATFORM_UNSUPPORTED: &str = "platform_unsupported";
pub const PACKAGE_IDENTITY_MISSING: &str = "package_identity_missing";
pub const UNSUPPORTED_OS: &str = "unsupported_os";
pub const WINRT_BINDINGS_PENDING: &str = "winrt_bindings_pending";
pub const LIMITED_ACCESS_DENIED: &str = "limited_access_denied";
pub const BUSY: &str = "busy";

#[derive(Debug, Clone, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}

impl Error {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

fn not_windows(command: &str) -> Error {
    Error::new(
        PLATFORM_UNSUPPORTED,
        format!("{command} is only available on Windows builds"),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureState {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl FeatureState {
    pub fn unavailable(reason: &str) -> Self {
        Self {
            status: "unavailable".into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsOcrLine {
    pub text: String,
    pub confidence: f64,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsOcrRecognizeResult {
    pub text: String,
    pub confidence: f64,
    pub lines: Vec<WindowsOcrLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsIntelligenceSnapshot {
    pub language_model: FeatureState,
    pub ocr: FeatureState,
    pub image_description: FeatureState,
    pub embeddings: FeatureState,
    pub windows_os: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_identity: Option<String>,
    pub checked_at: u64,
}

impl WindowsIntelligenceSnapshot {
    fn platform_unsupported() -> Self {
        let unsupported = FeatureState::unavailable(PLATFORM_UNSUPPORTED);
        Self {
            language_model: unsupported.clone(),
            ocr: unsupported.clone(),
            image_description: unsupported.clone(),
            embeddings: unsupported,
            windows_os: false,
            package_identity: None,
            checked_at: 0,
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether Windows System OCR is currently available on this machine.
pub fn ocr_is_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        let snap = windows::capabilities_snapshot();
        snap.ocr.status == "available"
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Recognize text from encoded image bytes using Windows System OCR.
pub fn recognize_text_from_image_bytes(
    image_data: &[u8],
) -> Result<WindowsOcrRecognizeResult, Error> {
    #[cfg(target_os = "windows")]
    {
        windows::recognize(image_data)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = image_data;
        Err(not_windows("recognize_text_from_image_bytes"))
    }
}

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
mod winrt;

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn windows_capabilities() -> Result<WindowsIntelligenceSnapshot, Error> {
        #[cfg(target_os = "windows")]
        {
            Ok(windows::capabilities_snapshot())
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut snap = WindowsIntelligenceSnapshot::platform_unsupported();
            snap.checked_at = now_ms();
            Ok(snap)
        }
    }

    #[tauri::command]
    pub async fn windows_lm_generate(
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            windows::lm_generate(body)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = body;
            Err(not_windows("windows_lm_generate"))
        }
    }

    #[tauri::command]
    pub async fn windows_lm_generate_stream(
        app: AppHandle<Wry>,
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            windows::lm_generate_stream(app, body)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (app, body);
            Err(not_windows("windows_lm_generate_stream"))
        }
    }

    #[tauri::command]
    pub async fn windows_lm_cancel(
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            windows::lm_cancel(body)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = body;
            Err(not_windows("windows_lm_cancel"))
        }
    }

    #[tauri::command]
    pub async fn windows_lm_warmup(
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            windows::lm_warmup(body)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = body;
            Err(not_windows("windows_lm_warmup"))
        }
    }

    #[tauri::command]
    pub async fn windows_lm_ensure_ready(
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            windows::lm_ensure_ready(body)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = body;
            Err(not_windows("windows_lm_ensure_ready"))
        }
    }

    #[tauri::command]
    pub async fn windows_ocr_status() -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "windows")]
        {
            windows::ocr_status()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(not_windows("windows_ocr_status"))
        }
    }

    #[tauri::command]
    pub async fn windows_ocr_recognize(
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "windows")]
        {
            let image_data = body
                .get("imageData")
                .and_then(|v| v.as_str())
                .ok_or_else(|| Error::new("invalid_argument", "Missing imageData (base64)"))?;
            let bytes = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                image_data.trim(),
            )
            .map_err(|e| Error::new("invalid_argument", format!("Invalid base64 imageData: {e}")))?;
            let result = windows::ocr_recognize(&bytes)?;
            Ok(serde_json::to_value(result).unwrap_or_else(|_| serde_json::json!({})))
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = body;
            Err(not_windows("windows_ocr_recognize"))
        }
    }

    #[tauri::command]
    pub async fn windows_lm_diagnostics() -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "windows")]
        {
            Ok(windows::lm_diagnostics())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(serde_json::json!({
                "platform": "unsupported",
                "reason": PLATFORM_UNSUPPORTED,
            }))
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-windows-intelligence")
        .invoke_handler(tauri::generate_handler![
            commands::windows_capabilities,
            commands::windows_lm_generate,
            commands::windows_lm_generate_stream,
            commands::windows_lm_cancel,
            commands::windows_lm_warmup,
            commands::windows_lm_ensure_ready,
            commands::windows_ocr_status,
            commands::windows_ocr_recognize,
            commands::windows_lm_diagnostics,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_code_and_message() {
        let json = serde_json::to_string(&not_windows("windows_lm_generate")).expect("serialize");
        assert!(json.contains(PLATFORM_UNSUPPORTED));
        assert!(json.contains("windows_lm_generate"));
    }

    #[test]
    fn desktop_snapshot_is_platform_unsupported() {
        let snap = WindowsIntelligenceSnapshot::platform_unsupported();
        assert!(!snap.windows_os);
        assert_eq!(
            snap.language_model.reason.as_deref(),
            Some(PLATFORM_UNSUPPORTED)
        );
        assert_eq!(snap.ocr.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        let json = serde_json::to_string(&snap).expect("serialize");
        assert!(json.contains(r#""windowsOs":false"#));
        assert!(json.contains(r#""languageModel""#));
        assert!(json.contains(r#""imageDescription""#));
        assert!(json.contains(r#""embeddings""#));
    }
}
