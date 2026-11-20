//! Native Android Health Connect plugin (Kotlin bridge on Android; typed
//! `platform_unsupported` everywhere else).

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, State};
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, Wry,
};
use thiserror::Error;

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

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnectSdkStatus {
    pub status: String,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnectPermissionStatus {
    pub granted_categories: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub has_history_permission: bool,
    pub has_background_permission: bool,
    pub default_history_days: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnectAuthArgs {
    pub categories: Vec<String>,
    pub include_history: bool,
    pub include_background: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnectQueryArgs {
    pub start_ms: i64,
    pub end_ms: i64,
    pub categories: Option<Vec<String>>,
    pub changes_token: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct HealthConnectBridge {
    #[cfg(target_os = "android")]
    handle: PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.healthconnect";

fn unsupported(cmd: &str) -> Error {
    Error::Message(format!(
        "platform_unsupported: {cmd} requires Android Health Connect"
    ))
}

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<HealthConnectBridge, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "HealthConnectPlugin")
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(HealthConnectBridge { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, api);
        Ok(HealthConnectBridge {})
    }
}

#[cfg(target_os = "android")]
fn call_mobile<T: DeserializeOwned>(
    state: &HealthConnectBridge,
    method: &str,
    payload: serde_json::Value,
) -> Result<T, Error> {
    state
        .handle
        .run_mobile_plugin::<T>(method, payload)
        .map_err(|e| Error::Message(e.to_string()))
}

pub fn get_sdk_status_via_app(app: &AppHandle<Wry>) -> Result<HealthConnectSdkStatus, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(&state, "getSdkStatus", serde_json::json!({}))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(HealthConnectSdkStatus {
            status: "unsupported".into(),
            available: false,
            reason: Some("platform_unsupported: Android Health Connect requires Android".into()),
        })
    }
}

pub fn get_granted_permissions_via_app(
    app: &AppHandle<Wry>,
) -> Result<HealthConnectPermissionStatus, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(&state, "getGrantedPermissions", serde_json::json!({}))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(unsupported("getGrantedPermissions"))
    }
}

pub fn request_permissions_via_app(
    app: &AppHandle<Wry>,
    args: HealthConnectAuthArgs,
) -> Result<HealthConnectPermissionStatus, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(
            &state,
            "requestHealthPermissions",
            serde_json::to_value(args)?,
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(unsupported("requestPermissions"))
    }
}

pub fn read_sleep_sessions_via_app(
    app: &AppHandle<Wry>,
    args: HealthConnectQueryArgs,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(&state, "readSleepSessions", serde_json::to_value(args)?)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(unsupported("readSleepSessions"))
    }
}

pub fn read_physiological_records_via_app(
    app: &AppHandle<Wry>,
    args: HealthConnectQueryArgs,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(
            &state,
            "readPhysiologicalRecords",
            serde_json::to_value(args)?,
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(unsupported("readPhysiologicalRecords"))
    }
}

pub fn get_changes_token_via_app(
    app: &AppHandle<Wry>,
    categories: Vec<String>,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(
            &state,
            "getChangesToken",
            serde_json::json!({ "categories": categories }),
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, categories);
        Err(unsupported("getChangesToken"))
    }
}

pub fn read_changes_via_app(
    app: &AppHandle<Wry>,
    token: String,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, HealthConnectBridge> = app.state();
        call_mobile(
            &state,
            "readChanges",
            serde_json::json!({ "changesToken": token }),
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, token);
        Err(unsupported("readChanges"))
    }
}

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn healthconnect_get_sdk_status(
        app: AppHandle<Wry>,
    ) -> Result<HealthConnectSdkStatus, Error> {
        get_sdk_status_via_app(&app)
    }

    #[tauri::command]
    pub async fn healthconnect_get_granted_permissions(
        app: AppHandle<Wry>,
    ) -> Result<HealthConnectPermissionStatus, Error> {
        get_granted_permissions_via_app(&app)
    }

    #[tauri::command]
    pub async fn healthconnect_request_permissions(
        app: AppHandle<Wry>,
        args: HealthConnectAuthArgs,
    ) -> Result<HealthConnectPermissionStatus, Error> {
        request_permissions_via_app(&app, args)
    }

    #[tauri::command]
    pub async fn healthconnect_read_sleep_sessions(
        app: AppHandle<Wry>,
        args: HealthConnectQueryArgs,
    ) -> Result<serde_json::Value, Error> {
        read_sleep_sessions_via_app(&app, args)
    }

    #[tauri::command]
    pub async fn healthconnect_read_physiological_records(
        app: AppHandle<Wry>,
        args: HealthConnectQueryArgs,
    ) -> Result<serde_json::Value, Error> {
        read_physiological_records_via_app(&app, args)
    }

    #[tauri::command]
    pub async fn healthconnect_get_changes_token(
        app: AppHandle<Wry>,
        categories: Vec<String>,
    ) -> Result<serde_json::Value, Error> {
        get_changes_token_via_app(&app, categories)
    }

    #[tauri::command]
    pub async fn healthconnect_read_changes(
        app: AppHandle<Wry>,
        token: String,
    ) -> Result<serde_json::Value, Error> {
        read_changes_via_app(&app, token)
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-healthconnect")
        .setup(|app, api| {
            let state = init_mobile(app, api)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::healthconnect_get_sdk_status,
            commands::healthconnect_get_granted_permissions,
            commands::healthconnect_request_permissions,
            commands::healthconnect_read_sleep_sessions,
            commands::healthconnect_read_physiological_records,
            commands::healthconnect_get_changes_token,
            commands::healthconnect_read_changes,
        ])
        .build()
}
