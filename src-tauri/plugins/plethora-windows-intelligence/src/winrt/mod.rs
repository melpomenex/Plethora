//! WinRT bridge for `Microsoft.Windows.AI.Text.LanguageModel` (Phi Silica).
//!
//! Real WinRT bindings are not wired yet. Platform gates (package identity,
//! OS build, LAF token) run in `windows::mod`; this module returns honest
//! `winrt_bindings_pending` stubs while preserving the integration shape for
//! a future `windows` crate / generated WinRT projection.

use std::sync::{Mutex, MutexGuard};

use crate::{Error, FeatureState, BUSY, WINRT_BINDINGS_PENDING};

/// Maximum prompt payload accepted before any WinRT call (defense in depth).
pub const MAX_PROMPT_BYTES: usize = 128 * 1024;

/// Env var holding the LAF unlock token (never committed to the repo).
pub const LAF_TOKEN_ENV: &str = "PLETHORA_WINDOWS_AI_LAF_TOKEN";

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

/// Feature state after platform gates pass. WinRT projection is still pending.
pub fn language_model_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    if !laf_token_present() {
        return FeatureState::unavailable(crate::LIMITED_ACCESS_DENIED);
    }
    FeatureState::unavailable(WINRT_BINDINGS_PENDING)
}

pub fn ocr_feature_state(platform_ready: bool) -> FeatureState {
    if !platform_ready {
        return FeatureState::unavailable(WINRT_BINDINGS_PENDING);
    }
    FeatureState::unavailable(WINRT_BINDINGS_PENDING)
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

/// Placeholder for `LimitedAccessFeatures.TryUnlockFeature` once WinRT is wired.
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
    // Real implementation will call WinRT TryUnlockFeature with the token.
    let _ = token;
    Ok(false)
}

fn ensure_platform_ready_for_inference() -> Result<(), Error> {
    if !laf_token_present() {
        return Err(Error::new(
            crate::LIMITED_ACCESS_DENIED,
            "Phi Silica requires a Limited Access Feature token (set PLETHORA_WINDOWS_AI_LAF_TOKEN)",
        ));
    }
    Err(Error::new(
        WINRT_BINDINGS_PENDING,
        "WinRT LanguageModel bindings are not integrated yet",
    ))
}

pub fn generate(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let _prompt = extract_prompt(&payload)?;
    let _init = model_slot().try_begin_init()?;
    ensure_platform_ready_for_inference()
}

pub fn generate_stream(
    _app: tauri::AppHandle<tauri::Wry>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    let _prompt = extract_prompt(&payload)?;
    let _init = model_slot().try_begin_init()?;
    ensure_platform_ready_for_inference()
}

pub fn cancel(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
  Ok(serde_json::json!({ "ok": true }))
}

pub fn warmup(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let init = model_slot().try_begin_init()?;
    if init.claimed {
        // Would load LanguageModel here; release Initializing on drop.
        return Err(Error::new(
            WINRT_BINDINGS_PENDING,
            "WinRT LanguageModel bindings are not integrated yet",
        ));
    }
    ensure_platform_ready_for_inference()
}

pub fn ensure_ready(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    warmup(_payload)
}

pub fn ocr_status() -> Result<serde_json::Value, Error> {
    Ok(serde_json::json!({
        "status": "unavailable",
        "reason": WINRT_BINDINGS_PENDING,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_prompt() {
        let huge = "x".repeat(MAX_PROMPT_BYTES + 1);
        let err = extract_prompt(&serde_json::json!({ "prompt": huge })).unwrap_err();
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
