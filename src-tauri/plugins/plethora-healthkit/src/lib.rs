//! Native iOS Apple HealthKit plugin (Swift bridge on iOS; typed
//! `platform_unsupported` everywhere else).

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "ios")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};
use thiserror::Error;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_plethora_healthkit);

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
pub struct HealthKitAvailability {
    pub available: bool,
    pub reason: Option<String>,
    pub request_status: String,
    pub ios_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthKitAuthArgs {
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthKitAuthResult {
    pub prompt_completed: bool,
    pub request_status: String,
    pub requested_categories: Vec<String>,
    pub read_denial_opaque_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthKitQueryArgs {
    pub start_ms: i64,
    pub end_ms: i64,
    pub anchor_base64: Option<String>,
    pub categories: Option<Vec<String>>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthKitExcludeDirArgs {
    pub path: String,
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct HealthKitBridge {
    #[cfg(target_os = "ios")]
    handle: PluginHandle<Wry>,
}

fn unsupported(cmd: &str) -> Error {
    Error::Message(format!(
        "platform_unsupported: {cmd} requires iOS HealthKit"
    ))
}

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<HealthKitBridge, Error> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        let handle = api
            .register_ios_plugin(init_plugin_plethora_healthkit)
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(HealthKitBridge { handle });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, api);
        Ok(HealthKitBridge {})
    }
}

#[cfg(target_os = "ios")]
fn call_mobile<T: DeserializeOwned>(
    state: &HealthKitBridge,
    method: &str,
    payload: serde_json::Value,
) -> Result<T, Error> {
    state
        .handle
        .run_mobile_plugin::<T>(method, payload)
        .map_err(|e| Error::Message(e.to_string()))
}

pub fn get_availability_via_app(app: &AppHandle<Wry>) -> Result<HealthKitAvailability, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, HealthKitBridge> = app.state();
        call_mobile(&state, "getAvailability", serde_json::json!({}))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(HealthKitAvailability {
            available: false,
            reason: Some("platform_unsupported: Apple HealthKit is available only on iOS".into()),
            request_status: "unsupported".into(),
            ios_version: None,
        })
    }
}

pub fn request_authorization_via_app(
    app: &AppHandle<Wry>,
    categories: Vec<String>,
) -> Result<HealthKitAuthResult, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, HealthKitBridge> = app.state();
        call_mobile(
            &state,
            "requestAuthorization",
            serde_json::to_value(HealthKitAuthArgs { categories })?,
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, categories);
        Err(unsupported("requestAuthorization"))
    }
}

pub fn query_anchored_changes_via_app(
    app: &AppHandle<Wry>,
    args: HealthKitQueryArgs,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, HealthKitBridge> = app.state();
        call_mobile(&state, "queryAnchoredChanges", serde_json::to_value(args)?)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, args);
        Err(unsupported("queryAnchoredChanges"))
    }
}

pub fn exclude_health_dir_from_backup_via_app(
    app: &AppHandle<Wry>,
    path: String,
) -> Result<bool, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, HealthKitBridge> = app.state();
        call_mobile(
            &state,
            "excludeHealthDirFromBackup",
            serde_json::to_value(HealthKitExcludeDirArgs { path })?,
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, path);
        Ok(false)
    }
}

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn healthkit_get_availability(
        app: AppHandle<Wry>,
    ) -> Result<HealthKitAvailability, Error> {
        get_availability_via_app(&app)
    }

    #[tauri::command]
    pub async fn healthkit_request_authorization(
        app: AppHandle<Wry>,
        categories: Vec<String>,
    ) -> Result<HealthKitAuthResult, Error> {
        request_authorization_via_app(&app, categories)
    }

    #[tauri::command]
    pub async fn healthkit_query_sleep_sessions(
        state: State<'_, HealthKitBridge>,
        args: HealthKitQueryArgs,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "ios")]
        {
            call_mobile(&state, "querySleepSessions", serde_json::to_value(args)?)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, args);
            Err(unsupported("healthkit_query_sleep_sessions"))
        }
    }

    #[tauri::command]
    pub async fn healthkit_query_physiological_samples(
        state: State<'_, HealthKitBridge>,
        args: HealthKitQueryArgs,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "ios")]
        {
            call_mobile(
                &state,
                "queryPhysiologicalSamples",
                serde_json::to_value(args)?,
            )
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, args);
            Err(unsupported("healthkit_query_physiological_samples"))
        }
    }

    #[tauri::command]
    pub async fn healthkit_query_anchored_changes(
        app: AppHandle<Wry>,
        args: HealthKitQueryArgs,
    ) -> Result<serde_json::Value, Error> {
        query_anchored_changes_via_app(&app, args)
    }

    #[tauri::command]
    pub async fn healthkit_enable_background_delivery(
        state: State<'_, HealthKitBridge>,
        categories: Vec<String>,
    ) -> Result<bool, Error> {
        #[cfg(target_os = "ios")]
        {
            call_mobile(
                &state,
                "enableBackgroundDelivery",
                serde_json::to_value(HealthKitAuthArgs { categories })?,
            )
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, categories);
            Err(unsupported("healthkit_enable_background_delivery"))
        }
    }

    #[tauri::command]
    pub async fn healthkit_disable_background_delivery(
        state: State<'_, HealthKitBridge>,
    ) -> Result<bool, Error> {
        #[cfg(target_os = "ios")]
        {
            call_mobile(&state, "disableBackgroundDelivery", serde_json::json!({}))
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Ok(true)
        }
    }

    #[tauri::command]
    pub async fn healthkit_exclude_health_dir_from_backup(
        app: AppHandle<Wry>,
        path: String,
    ) -> Result<bool, Error> {
        exclude_health_dir_from_backup_via_app(&app, path)
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-healthkit")
        .setup(|app, api| {
            let state = init_mobile(app, api)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::healthkit_get_availability,
            commands::healthkit_request_authorization,
            commands::healthkit_query_sleep_sessions,
            commands::healthkit_query_physiological_samples,
            commands::healthkit_query_anchored_changes,
            commands::healthkit_enable_background_delivery,
            commands::healthkit_disable_background_delivery,
            commands::healthkit_exclude_health_dir_from_backup,
        ])
        .build()
}
