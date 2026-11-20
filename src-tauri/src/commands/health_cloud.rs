use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

use crate::health::models::{
    HealthProviderError, HealthProviderId, HealthSyncReport, ProviderReadinessState,
};
use crate::health::oauth::{broker_request, decode_token, mobile_callback, HealthOAuthManager};
use crate::health::provider::{CloudHealthConnector, ProviderConfigContext};
use crate::health::providers::{
    catalog::build_provider_catalog, garmin::GarminConnector, google_health::GoogleHealthConnector,
    oura::OuraConnector, whoop::WhoopConnector,
};
use crate::health::token_store::HealthOAuthToken;

use super::health::vault;
use super::health_sources::{
    consent_record, new_connection, operation_error, synced, HealthSourceOperations,
};

const DAY_MS: i64 = 86_400_000;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrokerProvider {
    provider_id: HealthProviderId,
    client_id: Option<String>,
    configured: bool,
    approved: bool,
}

#[derive(serde::Deserialize)]
struct BrokerDirectory {
    providers: Vec<BrokerProvider>,
}

fn broker_url() -> Result<String, HealthProviderError> {
    std::env::var("PLETHORA_HEALTH_OAUTH_BROKER_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| {
            HealthProviderError::new(
                "provider_not_configured",
                "The wearable broker is not configured.",
                false,
            )
        })
}

async fn directory(url: &str) -> Result<BrokerDirectory, HealthProviderError> {
    serde_json::from_value(broker_request(url, None, "providers", None).await?)
        .map_err(|_| operation_error("The wearable broker directory is invalid."))
}

fn connector(provider: HealthProviderId) -> Option<Box<dyn CloudHealthConnector>> {
    match provider {
        HealthProviderId::Oura => Some(Box::new(OuraConnector::default())),
        HealthProviderId::Whoop => Some(Box::new(WhoopConnector::default())),
        HealthProviderId::GoogleHealth => Some(Box::new(GoogleHealthConnector::default())),
        HealthProviderId::Garmin => Some(Box::new(GarminConnector::default())),
        _ => None,
    }
}

pub(super) async fn provider_config() -> (ProviderConfigContext, bool) {
    let mut config = ProviderConfigContext::from_env();
    config.broker_configured_providers.clear();
    config.broker_approved_providers.clear();
    if let Some(base_url) = &config.oauth_broker_url {
        match directory(base_url).await {
            Ok(directory) => {
                for provider in directory.providers {
                    if provider.configured {
                        config
                            .broker_configured_providers
                            .push(provider.provider_id.as_str().into());
                    }
                    if provider.configured && provider.approved && provider.client_id.is_some() {
                        config
                            .broker_approved_providers
                            .push(provider.provider_id.as_str().into());
                    }
                }
            }
            Err(_) => return (config, true),
        }
    }
    (config, false)
}

pub(crate) fn listen_for_mobile_callback(app: &AppHandle) {
    #[cfg(mobile)]
    {
        let handle = app.clone();
        app.deep_link().on_open_url(move |event| {
            for url in event.urls() {
                let Ok((code, state)) = mobile_callback(&url) else {
                    continue;
                };
                let Some(provider) = handle
                    .state::<HealthOAuthManager>()
                    .pending_provider(&state)
                else {
                    continue;
                };
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    finish_and_notify(&app, provider, &state, &code).await;
                });
            }
        });
    }
    #[cfg(not(mobile))]
    let _ = app;
}

#[tauri::command]
pub async fn health_connect_cloud(
    app: AppHandle,
    provider_id: HealthProviderId,
) -> Result<(), HealthProviderError> {
    let operations = app.state::<HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let _ = vault(&app).await.map_err(operation_error)?;
    let connector =
        connector(provider_id).ok_or_else(|| operation_error("Not a direct cloud provider."))?;
    let broker = broker_url()?;
    let provider = directory(&broker)
        .await?
        .providers
        .into_iter()
        .find(|entry| entry.provider_id == provider_id && entry.configured && entry.approved)
        .and_then(|entry| entry.client_id)
        .ok_or_else(|| {
            HealthProviderError::new(
                "provider_not_approved",
                "The provider is not configured and approved by this broker.",
                false,
            )
        })?;
    let config = ProviderConfigContext::from_env();
    let categories = build_provider_catalog(&config, &[])
        .into_iter()
        .find(|entry| entry.id == provider_id)
        .ok_or_else(|| operation_error("Provider is unavailable."))?
        .supported_categories;
    let manager = app.state::<HealthOAuthManager>();
    #[cfg(desktop)]
    let (listener, port, redirect_uri) = HealthOAuthManager::bind_loopback_listener()?;
    #[cfg(mobile)]
    let (port, redirect_uri) = (0, "plethora://health/oauth/callback".to_owned());
    let pending = manager.create_pending_session(
        provider_id,
        connector.authorize_endpoint(),
        &provider,
        connector.default_scopes(),
        categories,
        redirect_uri,
        (port != 0).then_some(port),
    )?;
    if app
        .opener()
        .open_url(pending.authorize_url, None::<&str>)
        .is_err()
    {
        manager.cancel_provider(provider_id);
        return Err(operation_error("Could not open the provider sign-in page."));
    }
    #[cfg(desktop)]
    {
        let state = pending.state;
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let expected = state.clone();
            match tokio::task::spawn_blocking(move || {
                HealthOAuthManager::accept_loopback_callback(listener, &expected)
            })
            .await
            {
                Ok(Ok(code)) => finish_and_notify(&handle, provider_id, &state, &code).await,
                _ => notify(&handle, provider_id, Some("Authorization timed out.")),
            }
        });
    }
    Ok(())
}

async fn finish_and_notify(app: &AppHandle, provider: HealthProviderId, state: &str, code: &str) {
    let result = complete_authorization(app, provider, state, code).await;
    notify(
        app,
        provider,
        result.as_ref().err().map(|error| error.message.as_str()),
    );
}

fn notify(app: &AppHandle, provider: HealthProviderId, error: Option<&str>) {
    let _ = app.emit(
        "health-provider-changed",
        serde_json::json!({
            "providerId": provider, "error": error
        }),
    );
}

async fn complete_authorization(
    app: &AppHandle,
    provider: HealthProviderId,
    state: &str,
    code: &str,
) -> Result<(), HealthProviderError> {
    let operations = app.state::<HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let vault = vault(app).await.map_err(operation_error)?;
    let pending = app.state::<HealthOAuthManager>().consume_pending_session(
        provider,
        state,
        chrono::Utc::now().timestamp_millis(),
    )?;
    let token = HealthOAuthManager::exchange_via_broker(
        &broker_url()?,
        provider,
        code,
        &pending.redirect_uri,
        &pending.code_verifier,
    )
    .await?;
    vault
        .token_store()
        .store_token(provider, &token)
        .await
        .map_err(operation_error)?;
    let mut connection = new_connection(provider);
    connection.status = ProviderReadinessState::Connected;
    connection.auth_state = "authorized".into();
    connection.requested_categories = pending.requested_categories;
    let receipt = consent_record(provider, "connect", connection.requested_categories.clone());
    if let Err(error) = vault
        .save_connection_with_consent(&connection, &receipt)
        .await
    {
        let _ = vault.token_store().remove_token(provider).await;
        return Err(operation_error(error));
    }
    Ok(())
}

async fn refresh(
    broker: &str,
    provider: HealthProviderId,
    token: &HealthOAuthToken,
) -> Result<HealthOAuthToken, HealthProviderError> {
    let refresh_token = token.refresh_token.as_ref().ok_or_else(|| {
        HealthProviderError::new(
            "permission_revoked",
            "Reconnect the provider to renew access.",
            false,
        )
    })?;
    let body = broker_request(
        broker,
        Some(provider),
        "refresh",
        Some(serde_json::json!({"refreshToken": refresh_token})),
    )
    .await?;
    let mut updated = decode_token(body)?;
    if updated.refresh_token.is_none() {
        updated.refresh_token = Some(refresh_token.clone());
    }
    Ok(updated)
}

pub(super) async fn revoke(
    token: &str,
    provider: HealthProviderId,
) -> Result<(), HealthProviderError> {
    broker_request(
        &broker_url()?,
        Some(provider),
        "revoke",
        Some(serde_json::json!({"token": token})),
    )
    .await
    .map(|_| ())
}

#[tauri::command]
pub async fn health_sync_cloud(
    app: AppHandle,
    provider_id: HealthProviderId,
) -> Result<HealthSyncReport, HealthProviderError> {
    let operations = app.state::<HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let vault = vault(&app).await.map_err(operation_error)?;
    let connector =
        connector(provider_id).ok_or_else(|| operation_error("Not a direct cloud provider."))?;
    let broker = broker_url()?;
    let mut connection = vault
        .get_connection(provider_id)
        .await
        .map_err(operation_error)?
        .ok_or_else(|| operation_error("Connect the provider before syncing."))?;
    let mut token = vault
        .token_store()
        .get_token(provider_id)
        .await
        .map_err(operation_error)?
        .ok_or_else(|| {
            HealthProviderError::new(
                "permission_revoked",
                "Reconnect the provider before syncing.",
                false,
            )
        })?;

    let now = chrono::Utc::now().timestamp_millis();
    let since = connection
        .last_success_at_ms
        .map(|previous| (previous - 7 * DAY_MS).max(now - 90 * DAY_MS))
        .unwrap_or(now - 30 * DAY_MS);
    let result = async {
        if token.is_expired_or_expiring(now, 60_000) {
            token = refresh(&broker, provider_id, &token).await?;
            vault
                .token_store()
                .store_token(provider_id, &token)
                .await
                .map_err(operation_error)?;
        }
        let batch = connector
            .sync_incremental(&token.access_token, None, since, now, None)
            .await;
        if batch
            .as_ref()
            .is_err_and(|error| error.code == "permission_revoked")
        {
            token = refresh(&broker, provider_id, &token).await?;
            vault
                .token_store()
                .store_token(provider_id, &token)
                .await
                .map_err(operation_error)?;
            return connector
                .sync_incremental(&token.access_token, None, since, now, None)
                .await;
        }
        batch
    }
    .await;
    match result {
        Ok(batch) => {
            synced(&mut connection, batch.next_cursor.clone());
            let mut report = vault
                .ingest_provider_sync(batch, &connection, None)
                .await
                .map_err(operation_error)?;
            report.next_cursor = None;
            Ok(report)
        }
        Err(error) => {
            connection.updated_at_ms = now;
            connection.last_sync_at_ms = Some(now);
            connection.last_error_code = Some(error.code.clone());
            connection.last_error_message = Some(error.message.clone());
            connection.status = match error.code.as_str() {
                "permission_revoked" => ProviderReadinessState::PermissionRevoked,
                "rate_limited" => ProviderReadinessState::RateLimited,
                _ => ProviderReadinessState::TemporarilyUnavailable,
            };
            vault
                .upsert_connection(&connection)
                .await
                .map_err(operation_error)?;
            Err(error)
        }
    }
}
