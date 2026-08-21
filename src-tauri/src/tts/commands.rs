//! Tauri commands for the desktop sherpa TTS engine.
//!
//! Mirrors the `pocket_tts` command shape so the frontend adapter is familiar:
//! `sherpa_tts_status`, `sherpa_tts_synthesize` (base64 WAV + sample rate +
//! duration), `sherpa_tts_cancel`, `sherpa_tts_unload`. Synthesis input is
//! routed from the installed contract: model id → install dir +
//! `RunContract::SherpaTts{family: Supertonic}` → absolute config paths.

use super::engine::SherpaTtsEngine;
use crate::models::hf::adapters::SherpaTtsFamily;
use crate::models::hf::manager::resolve_installed_tts;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Status of the desktop sherpa TTS runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaTtsStatus {
    /// The bundled C API library was found and passed the version guard.
    pub available: bool,
    /// A model is currently loaded.
    pub loaded: bool,
    /// The loaded model's shared HF id (when loaded).
    pub model_id: Option<String>,
    /// Engine-reported output sample rate (44100 for Supertonic).
    pub sample_rate: Option<u32>,
    /// Engine-reported speaker count (drives the voice roster).
    pub num_speakers: Option<u32>,
    /// Why the runtime is unavailable, when it is not.
    pub error: Option<String>,
}

/// Result of a synthesis request. Same shape as Pocket TTS returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaTtsResult {
    /// Audio as a base64 WAV data URL.
    pub audio_data: String,
    pub sample_rate: u32,
    pub duration_sec: f64,
}

/// Managed state wrapping the engine handle.
pub struct SherpaTtsState {
    pub engine: SherpaTtsEngine,
}

impl Default for SherpaTtsState {
    fn default() -> Self {
        SherpaTtsState {
            engine: SherpaTtsEngine::new(),
        }
    }
}

/// Runtime availability probe: locate + load + version-check the bundled C API
/// library. Cheap (no model load); safe to call repeatedly.
fn runtime_available() -> Result<String, String> {
    super::sherpa_ffi::SherpaCApi::probe()
}

#[tauri::command]
pub async fn sherpa_tts_status(state: State<'_, SherpaTtsState>) -> Result<SherpaTtsStatus, String> {
    let availability = runtime_available();
    let mut status = match availability {
        Ok(_) => SherpaTtsStatus {
            available: true,
            loaded: false,
            model_id: None,
            sample_rate: None,
            num_speakers: None,
            error: None,
        },
        Err(e) => SherpaTtsStatus {
            available: false,
            loaded: false,
            model_id: None,
            sample_rate: None,
            num_speakers: None,
            error: Some(e),
        },
    };
    // Loaded-model info is best-effort: probing requires a load round-trip we
    // do not need here; the frontend re-checks after load/synthesize calls.
    let _ = &state.engine;
    Ok(status)
}

/// Resolve an installed HF TTS model id to (dir, contract) for the engine.
async fn resolve_model(
    app: &AppHandle,
    model_id: &str,
) -> Result<(std::path::PathBuf, crate::models::hf::adapters::RunContract), String> {
    let repo = app.state::<crate::database::Repository>();
    resolve_installed_tts(repo.pool(), model_id)
        .await
        .ok_or_else(|| {
            format!(
                "Model '{model_id}' is not installed (or its files are missing). Install it from \
                 the Hugging Face manager first."
            )
        })
}

#[tauri::command]
pub async fn sherpa_tts_load(
    app: AppHandle,
    state: State<'_, SherpaTtsState>,
    model_id: String,
) -> Result<super::engine::LoadedModelInfo, String> {
    let (model_dir, contract) = resolve_model(&app, &model_id).await?;
    if contract.effective_tts_family() != Some(SherpaTtsFamily::Supertonic) {
        return Err(format!(
            "Model '{model_id}' is not a Supertonic model; only Supertonic contracts are \
             runnable by the desktop engine in this version."
        ));
    }
    state.engine.load(model_id, model_dir, contract).await
}

#[tauri::command]
pub async fn sherpa_tts_synthesize(
    app: AppHandle,
    state: State<'_, SherpaTtsState>,
    model_id: String,
    text: String,
    sid: Option<i32>,
    speed: Option<f64>,
) -> Result<SherpaTtsResult, String> {
    if !runtime_available().is_ok() {
        // Distinguish "runtime missing" from "model missing" for the UI.
        return Err(runtime_available().unwrap_err());
    }
    let (model_dir, contract) = resolve_model(&app, &model_id).await?;
    if contract.effective_tts_family() != Some(SherpaTtsFamily::Supertonic) {
        return Err(format!(
            "Model '{model_id}' is not a Supertonic model; only Supertonic contracts are \
             runnable by the desktop engine in this version."
        ));
    }
    // Load on demand (no-op when this model is already loaded).
    state
        .engine
        .load(model_id.clone(), model_dir, contract)
        .await?;

    let out = state
        .engine
        .synthesize(text, sid.unwrap_or(0), speed.unwrap_or(1.0) as f32)
        .await?;

    let wav = super::wav::encode_wav_mono_i16(&out.samples, out.sample_rate);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wav);
    let duration_sec = out.samples.len() as f64 / out.sample_rate.max(1) as f64;
    Ok(SherpaTtsResult {
        audio_data: format!("data:audio/wav;base64,{b64}"),
        sample_rate: out.sample_rate,
        duration_sec,
    })
}

#[tauri::command]
pub async fn sherpa_tts_cancel(state: State<'_, SherpaTtsState>) -> Result<(), String> {
    state.engine.cancel();
    Ok(())
}

#[tauri::command]
pub async fn sherpa_tts_unload(state: State<'_, SherpaTtsState>) -> Result<(), String> {
    state.engine.unload().await
}
