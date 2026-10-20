//! ML Kit Speech Recognition (alpha) — persist-audio-first
//!
//! Thin Rust shim. Kotlin owns native ML Kit / AppSearch. Desktop commands
//! return `platform_unsupported`.

use serde::{de::DeserializeOwned, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
}

impl From<Error> for String {
    fn from(e: Error) -> Self {
        e.to_string()
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

fn not_android() -> Error {
    Error::Message("platform_unsupported: Android-only plugin".into())
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct Native {
    #[cfg(target_os = "android")]
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.androidspeech";

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<Native, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSpeechPlugin")
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(Native { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, api);
        Ok(Native {})
    }
}

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn dictation_status(state: State<'_, Native>, request: Option<serde_json::Value>) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        { state.handle.run_mobile_plugin::<serde_json::Value>("dictationStatus", request.unwrap_or_else(|| serde_json::json!({}))).map_err(|e| Error::Message(e.to_string())) }
        #[cfg(not(target_os = "android"))]
        { let _ = (state, request); Err(not_android()) }
    }

    #[tauri::command]
    pub async fn start_dictation(state: State<'_, Native>, request: Option<serde_json::Value>) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        { state.handle.run_mobile_plugin::<serde_json::Value>("startDictation", request.unwrap_or_else(|| serde_json::json!({}))).map_err(|e| Error::Message(e.to_string())) }
        #[cfg(not(target_os = "android"))]
        { let _ = (state, request); Err(not_android()) }
    }

    #[tauri::command]
    pub async fn stop_dictation(state: State<'_, Native>, request: Option<serde_json::Value>) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        { state.handle.run_mobile_plugin::<serde_json::Value>("stopDictation", request.unwrap_or_else(|| serde_json::json!({}))).map_err(|e| Error::Message(e.to_string())) }
        #[cfg(not(target_os = "android"))]
        { let _ = (state, request); Err(not_android()) }
    }

    #[tauri::command]
    pub async fn cancel_dictation(state: State<'_, Native>, request: Option<serde_json::Value>) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        { state.handle.run_mobile_plugin::<serde_json::Value>("cancelDictation", request.unwrap_or_else(|| serde_json::json!({}))).map_err(|e| Error::Message(e.to_string())) }
        #[cfg(not(target_os = "android"))]
        { let _ = (state, request); Err(not_android()) }
    }

    #[tauri::command]
    pub async fn speech_status(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("speechStatus", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }
    #[tauri::command]
    pub async fn transcribe_audio(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("transcribeAudio", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn download_speech_model(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("downloadSpeechModel", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn recording_status(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("recordingStatus", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn start_recording(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("startRecording", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn pause_recording(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("pauseRecording", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn resume_recording(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("resumeRecording", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn finish_recording(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("finishRecording", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-android-speech")
        .invoke_handler(tauri::generate_handler![
            commands::speech_status,
            commands::transcribe_audio,
            commands::download_speech_model,
            commands::dictation_status,
            commands::start_dictation,
            commands::stop_dictation,
            commands::cancel_dictation,
            commands::recording_status,
            commands::start_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::finish_recording,
        ])
        .setup(|app, api| {
            let native = init_mobile(app.app_handle(), api)?;
            app.manage(native);
            Ok(())
        })
        .build()
}
