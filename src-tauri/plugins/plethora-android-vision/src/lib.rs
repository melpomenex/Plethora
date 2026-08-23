//! ML Kit Document Scanner + page JPEG copy
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
const PLUGIN_IDENTIFIER: &str = "com.plethora.androidvision";

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<Native, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidVisionPlugin")
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
    pub async fn scan_status(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("scanStatus", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }
    #[tauri::command]
    pub async fn scan_document(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("scanDocument", payload)
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
    tauri::plugin::Builder::<Wry>::new("plethora-android-vision")
        .invoke_handler(tauri::generate_handler![
            commands::scan_status,
            commands::scan_document
        ])
        .setup(|app, api| {
            let native = init_mobile(app.app_handle(), api)?;
            app.manage(native);
            Ok(())
        })
        .build()
}
