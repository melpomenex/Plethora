//! Google Play Billing — Android-only.
//!
//! Thin Rust shim. Kotlin owns BillingClient, product queries, purchase flows,
//! and purchase-update events. Desktop and iOS commands return
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

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.playbilling";

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<Native, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "PlayBillingPlugin")
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
    pub async fn playbilling_get_products(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("getProducts", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_purchase(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("purchase", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_query_purchases(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("queryPurchases", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_restore(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("restore", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_start_purchase_listener(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("startPurchaseListener", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_manage_subscriptions(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("manageSubscriptions", payload)
                .map_err(|e| Error::Message(e.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[tauri::command]
    pub async fn playbilling_set_obfuscated_account_id(
        state: State<'_, Native>,
        request: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = request.unwrap_or_else(|| serde_json::json!({}));
            state
                .handle
                .run_mobile_plugin::<serde_json::Value>("setObfuscatedAccountId", payload)
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
    tauri::plugin::Builder::<Wry>::new("plethora-playbilling")
        .invoke_handler(tauri::generate_handler![
            commands::playbilling_get_products,
            commands::playbilling_purchase,
            commands::playbilling_query_purchases,
            commands::playbilling_restore,
            commands::playbilling_start_purchase_listener,
            commands::playbilling_manage_subscriptions,
            commands::playbilling_set_obfuscated_account_id,
        ])
        .setup(|app, api| {
            let native = init_mobile(app.app_handle(), api)?;
            app.manage(native);
            Ok(())
        })
        .build()
}
