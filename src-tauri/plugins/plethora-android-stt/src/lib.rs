//! On-device Android STT — sherpa-onnx long-form transcription.
//!
//! Thin Rust shim. Kotlin owns the MediaCodec decode → resample → VAD →
//! OfflineRecognizer pipeline inside a foreground service; Rust orchestrates
//! persistence by polling job status (design.md D2). Desktop commands return
//! `platform_unsupported`.

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

impl Native {
    /// Invoke a Kotlin command from anywhere in the app (Android only).
    /// Blocks until Kotlin resolves the Invoke — call from a blocking task.
    #[cfg(target_os = "android")]
    pub fn invoke(
        &self,
        method: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, Error> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>(method, payload)
            .map_err(|e| Error::Message(e.to_string()))
    }
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.androidstt";

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<Native, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSttPlugin")
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(Native { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, api);
        Ok(Native {})
    }
}

/// Forward a command to the Kotlin plugin with the given request payload.
///
/// `run_mobile_plugin` blocks until Kotlin resolves the Invoke, so every
/// command must stay off the main thread (they are async commands).
macro_rules! forward {
    ($state:ident, $request:ident, $method:literal) => {{
        #[cfg(target_os = "android")]
        {
            let payload = $request.unwrap_or_else(|| serde_json::json!({}));
            $state
                .handle
                .run_mobile_plugin::<serde_json::Value>($method, payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (&$state, &$request);
            Err(not_android())
        }
    }};
}

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn stt_status(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttStatus")
    }

    #[tauri::command]
    pub async fn stt_start_job(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttStartJob")
    }

    #[tauri::command]
    pub async fn stt_job_status(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttJobStatus")
    }

    #[tauri::command]
    pub async fn stt_cancel_job(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttCancelJob")
    }

    #[tauri::command]
    pub async fn stt_prepare_model(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttPrepareModel")
    }

    #[tauri::command]
    pub async fn stt_list_models(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttListModels")
    }

    #[tauri::command]
    pub async fn stt_delete_model(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        forward!(state, request, "sttDeleteModel")
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-android-stt")
        .invoke_handler(tauri::generate_handler![
            commands::stt_status,
            commands::stt_start_job,
            commands::stt_job_status,
            commands::stt_cancel_job,
            commands::stt_prepare_model,
            commands::stt_list_models,
            commands::stt_delete_model
        ])
        .setup(|app, api| {
            let native = init_mobile(app.app_handle(), api)?;
            app.manage(native);
            Ok(())
        })
        .build()
}
