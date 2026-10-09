use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.navigation";

#[derive(Clone)]
pub struct NavigationPlugin {
    #[cfg(target_os = "android")]
    handle: PluginHandle<Wry>,
}

fn unsupported<T>() -> Result<T, String> {
    Err("Native application Back is only available on Android".into())
}

#[allow(unused_variables)]
fn init_mobile<C: serde::de::DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<NavigationPlugin, String> {
    #[cfg(target_os = "android")]
    {
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "NavigationPlugin")
            .map_err(|error| error.to_string())?;
        return Ok(NavigationPlugin { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, api);
        Ok(NavigationPlugin {})
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResponse {
    pub protocol_version: u32,
    pub epoch: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
    pub accepted: bool,
    pub remaining_ms: u64,
    pub expires_at_epoch_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckArgs {
    pub epoch: String,
    pub id: String,
    pub kind: String,
    pub outcome: Option<String>,
    pub transition_id: Option<String>,
}

mod commands {
    use super::*;

    #[tauri::command]
    pub fn attach(
        state: State<'_, NavigationPlugin>,
        client_session_id: String,
    ) -> Result<AttachResponse, String> {
        #[cfg(target_os = "android")]
        {
            return state
                .handle
                .run_mobile_plugin(
                    "attach",
                    serde_json::json!({ "clientSessionId": client_session_id }),
                )
                .map_err(|error| error.to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, client_session_id);
            unsupported()
        }
    }

    #[tauri::command]
    pub fn claim(
        state: State<'_, NavigationPlugin>,
        epoch: String,
        id: String,
    ) -> Result<ClaimResponse, String> {
        #[cfg(target_os = "android")]
        {
            return state
                .handle
                .run_mobile_plugin("claim", serde_json::json!({ "epoch": epoch, "id": id }))
                .map_err(|error| error.to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, epoch, id);
            unsupported()
        }
    }

    #[tauri::command]
    pub fn acknowledge(
        state: State<'_, NavigationPlugin>,
        args: AckArgs,
    ) -> Result<serde_json::Value, String> {
        #[cfg(target_os = "android")]
        {
            return state
                .handle
                .run_mobile_plugin(
                    "acknowledge",
                    serde_json::to_value(args).map_err(|error| error.to_string())?,
                )
                .map_err(|error| error.to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, args);
            unsupported()
        }
    }

    #[tauri::command]
    pub fn detach(
        state: State<'_, NavigationPlugin>,
        epoch: String,
    ) -> Result<serde_json::Value, String> {
        #[cfg(target_os = "android")]
        {
            return state
                .handle
                .run_mobile_plugin("detach", serde_json::json!({ "epoch": epoch }))
                .map_err(|error| error.to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, epoch);
            unsupported()
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-navigation")
        .invoke_handler(tauri::generate_handler![
            commands::attach,
            commands::claim,
            commands::acknowledge,
            commands::detach,
        ])
        .setup(|app, api| {
            let state = init_mobile(app.app_handle(), api)?;
            app.manage(state);
            Ok(())
        })
        .build()
}
