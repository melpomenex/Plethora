//! WinRT bridge for `Microsoft.Windows.AI.Text.LanguageModel` (Phi Silica).

// crate-visible: windows/ocr.rs calls native_bridge::recognize_image directly.
pub(crate) mod native_bridge;

pub use native_bridge::{bridge_available, get_ocr_ready_state, get_ready_state, try_unlock_laf};

use std::sync::{Mutex, MutexGuard};

use crate::{Error, FeatureState, BUSY, WINRT_BINDINGS_PENDING};

/// WinRT `AIFeatureReadyState` values (stable channel).
const READY: i32 = 0;
const NOT_READY: i32 = 1;
const NOT_SUPPORTED: i32 = 2;

/// Maximum prompt payload accepted before any WinRT call (defense in depth).
pub const MAX_PROMPT_BYTES: usize = 128 * 1024;

/// Env var holding the LAF unlock token (never committed to the repo).
pub const LAF_TOKEN_ENV: &str = "PLETHORA_WINDOWS_AI_LAF_TOKEN";
/// Optional override for the LAF feature id (default: Phi Silica language model).
pub const LAF_FEATURE_ID_ENV: &str = "PLETHORA_WINDOWS_AI_LAF_FEATURE_ID";
/// Attestation string from Microsoft LAF email (required with token).
pub const LAF_ATTESTATION_ENV: &str = "PLETHORA_WINDOWS_AI_LAF_ATTESTATION";
const DEFAULT_LAF_FEATURE_ID: &str = "com.microsoft.windows.ai.languagemodel";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelInitPhase {
    Idle,
    Initializing,
    Ready,
}

struct ModelSlot {
    phase: Mutex<ModelInitPhase>,
}

impl ModelSlot {
    fn new() -> Self {
        Self {
            phase: Mutex::new(ModelInitPhase::Idle),
        }
    }

    fn try_begin_init(&self) -> Result<InitGuard<'_>, Error> {
        let guard = self.phase.lock().map_err(|_| {
            Error::new(BUSY, "Language model mutex poisoned")
        })?;
        match *guard {
            ModelInitPhase::Initializing => {
                return Err(Error::new(BUSY, "Language model initialization already in progress"));
            }
            ModelInitPhase::Ready => return Ok(InitGuard { guard, claimed: false }),
            ModelInitPhase::Idle => {}
        }
        drop(guard);

        let mut guard = self.phase.lock().map_err(|_| {
            Error::new(BUSY, "Language model mutex poisoned")
        })?;
        if *guard == ModelInitPhase::Initializing {
            return Err(Error::new(
                BUSY,
                "Language model initialization already in progress",
            ));
        }
        if *guard == ModelInitPhase::Ready {
            return Ok(InitGuard { guard, claimed: false });
        }
        *guard = ModelInitPhase::Initializing;
        Ok(InitGuard { guard, claimed: true })
    }
}

struct InitGuard<'a> {
    guard: MutexGuard<'a, ModelInitPhase>,
    claimed: bool,
}

impl Drop for InitGuard<'_> {
    fn drop(&mut self) {
        if self.claimed && *self.guard == ModelInitPhase::Initializing {
            *self.guard = ModelInitPhase::Idle;
        }
    }
}

fn model_slot() -> &'static ModelSlot {
    static SLOT: std::sync::OnceLock<ModelSlot> = std::sync::OnceLock::new();
    SLOT.get_or_init(ModelSlot::new)
}

fn laf_token_present() -> bool {
    std::env::var(LAF_TOKEN_ENV)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Feature state after platform gates pass.
pub fn language_model_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    if !laf_token_present() {
        return FeatureState::unavailable(crate::LIMITED_ACCESS_DENIED);
    }
    if !native_bridge::bridge_available() {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    match native_bridge::get_ready_state() {
        Some(READY) => FeatureState {
            status: "available".into(),
            reason: None,
        },
        Some(NOT_READY) => FeatureState {
            status: "downloadable".into(),
            reason: Some("model_not_ready".into()),
        },
        Some(NOT_SUPPORTED) => FeatureState::unavailable("unsupported_hardware"),
        Some(other) => FeatureState::unavailable(&format!("ready_state_{other}")),
        None => FeatureState::unavailable(WINRT_BINDINGS_PENDING),
    }
}

pub fn ocr_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    if !native_bridge::bridge_available() {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    match native_bridge::get_ocr_ready_state() {
        Some(READY) => FeatureState {
            status: "available".into(),
            reason: None,
        },
        Some(NOT_READY) => FeatureState {
            status: "downloadable".into(),
            reason: Some("model_not_ready".into()),
        },
        Some(NOT_SUPPORTED) => FeatureState::unavailable("unsupported_hardware"),
        Some(other) => FeatureState::unavailable(&format!("ocr_ready_state_{other}")),
        None => FeatureState::unavailable(WINRT_BINDINGS_PENDING),
    }
}

pub fn image_description_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    FeatureState::unavailable(WINRT_BINDINGS_PENDING)
}

pub fn embeddings_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    FeatureState::unavailable(WINRT_BINDINGS_PENDING)
}

fn extract_generation_input(payload: &serde_json::Value) -> Result<(String, Option<String>), Error> {
    let text = payload
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::new("invalid_argument", "Missing text field"))?;
    let system = payload
        .get("systemInstruction")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let combined = match system {
        Some(s) => format!("{s}\n\n{text}"),
        None => text.to_string(),
    };
    validate_prompt_bytes(&combined)?;
    let request_id = payload
        .get("requestId")
        .and_then(|v| v.as_str())
        .map(String::from);
    Ok((combined, request_id))
}

fn validate_prompt_bytes(prompt: &str) -> Result<(), Error> {
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(Error::new(
            "invalid_argument",
            format!("Prompt exceeds {MAX_PROMPT_BYTES} byte limit"),
        ));
    }
    Ok(())
}

fn extract_prompt(payload: &serde_json::Value) -> Result<String, Error> {
    extract_generation_input(payload).map(|(combined, _)| combined)
}

/// Attempt `LimitedAccessFeatures.TryUnlockFeature` when token + attestation are configured.
pub fn try_unlock_laf_feature() -> Result<bool, Error> {
    let token = std::env::var(LAF_TOKEN_ENV).map_err(|_| {
        Error::new(crate::LIMITED_ACCESS_DENIED, "LAF token not configured")
    })?;
    if token.trim().is_empty() {
        return Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            "LAF token not configured",
        ));
    }
    let attestation = std::env::var(LAF_ATTESTATION_ENV).unwrap_or_default();
    if attestation.trim().is_empty() {
        return Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            "LAF attestation not configured (set PLETHORA_WINDOWS_AI_LAF_ATTESTATION)",
        ));
    }
    let feature_id = std::env::var(LAF_FEATURE_ID_ENV)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_LAF_FEATURE_ID.to_string());
    if !native_bridge::bridge_available() {
        return Err(Error::new(
            WINRT_BINDINGS_PENDING,
            "LAF unlock requires the Phi Silica C++/WinRT bridge",
        ));
    }
  match native_bridge::try_unlock_laf(&feature_id, token.trim(), attestation.trim()) {
        Some(0) => Ok(true),
        Some(status) => Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            format!("LAF unlock returned status {status}"),
        )),
        None => Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            "LAF unlock call failed",
        )),
    }
}

fn ensure_platform_ready_for_inference() -> Result<(), Error> {
    if !laf_token_present() {
        return Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            "Phi Silica requires a Limited Access Feature token (set PLETHORA_WINDOWS_AI_LAF_TOKEN)",
        ));
    }
    if !native_bridge::bridge_available() {
        return Err(Error::new(
            WINRT_BINDINGS_PENDING,
            "Phi Silica C++/WinRT bridge was not compiled (Windows App SDK required at build time)",
        ));
    }
    if std::env::var(LAF_ATTESTATION_ENV)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        let _ = try_unlock_laf_feature();
    }
    Ok(())
}

pub fn generate(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let (combined, request_id) = extract_generation_input(&payload)?;
    let _init = model_slot().try_begin_init()?;
    ensure_platform_ready_for_inference()?;
    let max_tokens = payload
        .get("maxOutputTokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(512) as u32;
    match native_bridge::generate(&combined, max_tokens) {
        Ok(text) => Ok(serde_json::json!({
            "requestId": request_id.unwrap_or_else(|| "windows-lm".into()),
            "text": text,
            "finishReason": "stop",
            "baseModelName": "phi-silica",
        })),
        Err(msg) => Err(map_bridge_error(&msg)),
    }
}

pub fn generate_stream(
    app: tauri::AppHandle<tauri::Wry>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    use tauri::Emitter;
    let request_id = payload
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or("windows-lm")
        .to_string();
    let result = generate(payload)?;
    if let Some(text) = result.get("text").and_then(|v| v.as_str()) {
        let _ = app.emit(
            "windows-lm://text",
            serde_json::json!({ "requestId": request_id, "text": text }),
        );
        let complete = serde_json::json!({
            "requestId": request_id,
            "text": text,
            "finishReason": result.get("finishReason").and_then(|v| v.as_str()).unwrap_or("stop"),
            "baseModelName": result.get("baseModelName").and_then(|v| v.as_str()).unwrap_or("phi-silica"),
        });
        let _ = app.emit("windows-lm://complete", complete);
    }
    Ok(result)
}

pub fn cancel(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
  Ok(serde_json::json!({ "ok": true }))
}

pub fn warmup(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let _init = model_slot().try_begin_init()?;
    ensure_platform_ready_for_inference()?;
    Ok(serde_json::json!({ "ok": true }))
}

pub fn ensure_ready(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    warmup(_payload)
}

fn map_bridge_error(msg: &str) -> Error {
    if msg.contains("limited") || msg.contains("Limited") {
        Error::new(crate::LIMITED_ACCESS_DENIED, msg)
    } else if msg.contains("package") {
        Error::new(crate::PACKAGE_IDENTITY_MISSING, msg)
    } else {
        Error::new("inference_failed", msg)
    }
}

pub fn ocr_status() -> Result<serde_json::Value, Error> {
    let state = ocr_feature_state(true);
    Ok(serde_json::json!({
        "status": state.status,
        "reason": state.reason,
        "readyState": native_bridge::get_ocr_ready_state(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_prompt() {
        let huge = "x".repeat(MAX_PROMPT_BYTES + 1);
        let err = extract_generation_input(&serde_json::json!({ "text": huge })).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }

    #[test]
    fn concurrent_init_returns_busy() {
        let slot = ModelSlot::new();
        let first = slot.try_begin_init().expect("first init");
        assert!(first.claimed);
        let second = slot.try_begin_init().expect_err("second should be busy");
        assert_eq!(second.code, BUSY);
    }
}
