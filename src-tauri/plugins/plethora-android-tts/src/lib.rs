//! Tauri plugin for on-device TTS on Android.
//!
//! This plugin runs native sherpa-onnx TTS inference (KittenTTS Micro /
//! Kokoro-82M) inside the Android app and streams callback PCM directly into
//! Android `AudioTrack`. **No PCM crosses the Tauri IPC** — the webview only
//! receives small JSON events (download progress, playback state, errors,
//! utterance completion, sentence position).
//!
//! Architecture:
//!   - The Rust side is a thin shim that registers the Android plugin and
//!     exposes `#[tauri::command]`s which forward to the Kotlin plugin via
//!     `PluginHandle::run_mobile_plugin`. It contains no inference logic; the
//!     native Kotlin side owns sherpa-onnx, `AudioTrack`, audio focus,
//!     lifecycle, and the System-TTS fallback.
//!   - On desktop these commands return a clear "Android-only" error; Pocket
//!     TTS remains the desktop local option and is entirely unaffected.
//!
//! The plugin targets the concrete `tauri::Wry` runtime (the only runtime the
//! Incrementum app uses), keeping `generate_handler!` monomorphization simple
//! and avoiding `Runtime` trait thread-safety issues with a generic `R` — the
//! same approach `incrementum-folder-import` uses.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};
use thiserror::Error;

/// Errors surfaced to the frontend over IPC.
#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl From<Error> for String {
    fn from(e: Error) -> Self {
        e.to_string()
    }
}

impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

fn not_android() -> Error {
    Error::Message(
        "On-device TTS is only available in the Android build. \
         Pocket TTS remains the local option on desktop."
            .to_string(),
    )
}

/// Managed plugin state.
///
/// On mobile this holds the native plugin handle used to invoke the Kotlin
/// TTS engine. On desktop there is no mobile handle, so the struct is a
/// zero-sized placeholder — every command returns an "Android-only" error
/// there, and the provider is hidden in the UI via `isNativeMobile()`.
///
/// Concrete over `Wry` (see the module docs): `PluginHandle<Wry>` is
/// `Send + Sync`, so this type satisfies the `State`/`manage` bounds.
#[allow(dead_code)]
#[derive(Clone)]
pub struct AndroidTts {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    handle: PluginHandle<Wry>,
}

/// A model in the native TTS catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsModel {
    pub id: String,
    pub name: String,
    pub kind: String, // "kitten" | "kokoro"
    pub installed: bool,
    pub installing: bool,
    pub bytes_on_disk: u64,
    pub download_bytes: u64,
    pub description: String,
    pub default: bool,
}

/// A voice in a model's roster.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsVoice {
    pub id: String,
    pub name: String,
    pub model_id: String,
    pub language: Option<String>,
    pub gender: Option<String>,
}

/// Wrapper for the `listModels` Kotlin response `{ models: [...] }`.
///
/// The Kotlin plugin resolves `JSObject().put("models", JSArray)`, so the
/// mobile-plugin response is a JSON *map* — not a bare sequence. Deserializing
/// directly into `Vec<NativeTtsModel>` fails with "Invalid type: map, expected a
/// sequence"; this wrapper matches the payload. (Mirrors how folder-import uses
/// `MobilePickResponse { files }`.)
#[derive(Debug, Clone, Deserialize)]
struct ListModelsResponse {
    pub models: Vec<NativeTtsModel>,
}

/// Wrapper for the `listVoices` Kotlin response `{ voices: [...] }`.
#[derive(Debug, Clone, Deserialize)]
struct ListVoicesResponse {
    pub voices: Vec<NativeTtsVoice>,
}

/// Result of an `initialize` call — the engine's readiness summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub available: bool,
    pub active_model_id: Option<String>,
    pub installed_model_ids: Vec<String>,
}

// ──────────────────────────────────────────────────────────────────────────
// Mobile registration
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.androidtts";

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<AndroidTts, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidTtsPlugin")
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(AndroidTts { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        // iOS or other mobile: registered above only for Android. For anything
        // else, return a placeholder; commands will reject with not_android().
        let _ = (app, api);
        Ok(AndroidTts {})
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IPC commands. Each forwards to the Kotlin plugin via run_mobile_plugin on
// Android and returns a clear error elsewhere. They live in their own module
// so `generate_handler!` can reference them via a qualified path.
// ──────────────────────────────────────────────────────────────────────────

mod commands {
    use super::*;

    /// Initialize the native TTS engine and report readiness. Called once on
    /// first use; safe to call repeatedly.
    #[tauri::command]
    pub async fn initialize(state: State<'_, AndroidTts>) -> Result<InitializeResult, Error> {
        #[cfg(target_os = "android")]
        {
            let res = state
                .handle
                .run_mobile_plugin::<InitializeResult>("initialize", serde_json::json!({}))
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(res)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    /// Download (and verify) a model by id. Progress is delivered via the
    /// `tts://download-progress` event; this command resolves once complete.
    #[tauri::command]
    pub async fn download_model(
        state: State<'_, AndroidTts>,
        model_id: String,
    ) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "modelId": model_id });
            state
                .handle
                .run_mobile_plugin::<()>("downloadModel", payload)
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, model_id);
            Err(not_android())
        }
    }

    /// Cancel an in-progress download for a model. Verified models are retained.
    #[tauri::command]
    pub async fn cancel_download(
        state: State<'_, AndroidTts>,
        model_id: String,
    ) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "modelId": model_id });
            state
                .handle
                .run_mobile_plugin::<()>("cancelDownload", payload)
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, model_id);
            Err(not_android())
        }
    }

    /// List available models with install state and disk usage.
    #[tauri::command]
    pub async fn list_models(state: State<'_, AndroidTts>) -> Result<Vec<NativeTtsModel>, Error> {
        #[cfg(target_os = "android")]
        {
            // The Kotlin side resolves `{ models: [...] }` (a map); deserialize
            // via the wrapper, then unwrap the array. run_mobile_plugin blocks
            // until the native side resolves the Invoke and must run off the
            // main thread (the command body runs on an async worker).
            let res = state
                .handle
                .run_mobile_plugin::<ListModelsResponse>("listModels", serde_json::json!({}))
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(res.models)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    /// List the voices for a model (requires the model to be installed).
    #[tauri::command]
    pub async fn list_voices(
        state: State<'_, AndroidTts>,
        model_id: String,
    ) -> Result<Vec<NativeTtsVoice>, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "modelId": model_id });
            let res = state
                .handle
                .run_mobile_plugin::<ListVoicesResponse>("listVoices", payload)
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(res.voices)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, model_id);
            Err(not_android())
        }
    }

    /// Queue one or more sentences for native playback. Returns immediately;
    /// playback/state/sentence-position events drive the UI. When no model is
    /// installed or inference fails, the plugin falls back to System TTS.
    #[tauri::command]
    pub async fn speak(
        state: State<'_, AndroidTts>,
        sentences: Vec<String>,
        model_id: Option<String>,
        voice_id: Option<String>,
        speed: Option<f32>,
    ) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({
                "sentences": sentences,
                "modelId": model_id,
                "voiceId": voice_id,
                "speed": speed,
            });
            state
                .handle
                .run_mobile_plugin::<()>("speak", payload)
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, sentences, model_id, voice_id, speed);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn pause(state: State<'_, AndroidTts>) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            state
                .handle
                .run_mobile_plugin::<()>("pause", serde_json::json!({}))
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn resume(state: State<'_, AndroidTts>) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            state
                .handle
                .run_mobile_plugin::<()>("resume", serde_json::json!({}))
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn stop(state: State<'_, AndroidTts>) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            state
                .handle
                .run_mobile_plugin::<()>("stop", serde_json::json!({}))
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    /// Delete a model's files and return its disk usage to zero.
    #[tauri::command]
    pub async fn delete_model(
        state: State<'_, AndroidTts>,
        model_id: String,
    ) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "modelId": model_id });
            state
                .handle
                .run_mobile_plugin::<()>("deleteModel", payload)
                .map_err(|e| Error::Message(e.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, model_id);
            Err(not_android())
        }
    }
}

pub use commands::cancel_download;
pub use commands::delete_model;
pub use commands::download_model;
pub use commands::initialize;
pub use commands::list_models;
pub use commands::list_voices;
pub use commands::pause;
pub use commands::resume;
pub use commands::speak;
pub use commands::stop;

/// Initializes the plugin.
pub fn init() -> TauriPlugin<Wry> {
    // NOTE: the builder name MUST match the crate name (`incrementum-android-tts`),
    // because tauri-plugin's ACL manifest codegen keys the plugin's permissions
    // under the crate name. The runtime ACL lookup on `plugin:<name>|<cmd>` uses
    // this builder name, so a mismatch makes every command fail with
    // "not allowed by ACL" even when the capability grants it.
    tauri::plugin::Builder::<Wry>::new("plethora-android-tts")
        .invoke_handler(tauri::generate_handler![
            commands::initialize,
            commands::download_model,
            commands::cancel_download,
            commands::list_models,
            commands::list_voices,
            commands::speak,
            commands::pause,
            commands::resume,
            commands::stop,
            commands::delete_model
        ])
        .setup(|app, api| {
            let android_tts = init_mobile(app.app_handle(), api)?;
            app.manage(android_tts);
            Ok(())
        })
        .build()
}

/// Webview event payload for `tts://word-position` — exact spoken-word
/// positions from the System-TTS fallback engine (`onRangeStart`). The Rust
/// shim passes Kotlin events through untouched; this type exists so the
/// Kotlin→webview contract is serde-verified on the Rust side too.
#[cfg_attr(test, derive(Debug, PartialEq))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordPositionEvent {
    pub utterance_id: i64,
    pub sentence_index: i64,
    pub char_index: i64,
    pub char_length: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_position_event_round_trips_camel_case() {
        let event = WordPositionEvent {
            utterance_id: 7,
            sentence_index: 2,
            char_index: 41,
            char_length: Some(5),
        };
        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"sentenceIndex\""), "camelCase missing: {json}");
        assert!(json.contains("\"charLength\""), "camelCase missing: {json}");
        let back: WordPositionEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, event);
    }

    #[test]
    fn error_serializes_as_string() {
        let err = not_android();
        let json = serde_json::to_string(&err).expect("serialize");
        assert!(json.contains("Android"), "unexpected json: {json}");
    }

    #[test]
    fn native_tts_model_is_camel_case() {
        let m = NativeTtsModel {
            id: "kitten-nano".into(),
            name: "KittenTTS Micro".into(),
            kind: "kitten".into(),
            installed: true,
            installing: false,
            bytes_on_disk: 100,
            download_bytes: 200,
            description: "compact default".into(),
            default: true,
        };
        let json = serde_json::to_string(&m).expect("serialize");
        assert!(json.contains("bytesOnDisk"), "camelCase missing: {json}");
        assert!(json.contains("downloadBytes"), "camelCase missing: {json}");
    }
}
