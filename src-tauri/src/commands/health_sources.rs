use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::health::db::HealthVault;
use crate::health::models::{
    HealthConnection, HealthConsentRecord, HealthDataCategory, HealthProviderError,
    HealthProviderId, HealthSyncReport, ProviderReadinessState,
};
use crate::health::native_healthconnect::{normalize_healthconnect_payload, HealthConnectPayload};
use crate::health::native_healthkit::HealthKitPayload;
use crate::health::oauth::HealthOAuthManager;
use crate::health::provider::NormalizedIngestionBatch;

use super::health::vault;

#[derive(Default)]
pub(crate) struct HealthSourceOperations(pub(crate) Mutex<()>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthProviderConsent {
    pub categories: Vec<HealthDataCategory>,
    #[serde(default)]
    pub include_history: bool,
}

const DAY_MS: i64 = 86_400_000;
const NATIVE_CATEGORIES: &[HealthDataCategory] = &[
    HealthDataCategory::Sleep,
    HealthDataCategory::SleepStages,
    HealthDataCategory::HeartRate,
    HealthDataCategory::RestingHeartRate,
    HealthDataCategory::Hrv,
    HealthDataCategory::Activity,
];

pub(crate) fn operation_error(error: impl ToString) -> HealthProviderError {
    HealthProviderError::new("health_operation_failed", error.to_string(), true)
}

pub(crate) fn new_connection(provider_id: HealthProviderId) -> HealthConnection {
    HealthConnection {
        provider_id,
        status: ProviderReadinessState::RequiresUserAuthorization,
        auth_state: "disconnected".into(),
        requested_categories: Vec::new(),
        granted_categories: Vec::new(),
        last_sync_at_ms: None,
        last_success_at_ms: None,
        sync_cursor: None,
        account_subject_hint: None,
        last_error_code: None,
        last_error_message: None,
        history_limit_days: None,
        background_sync_enabled: false,
        updated_at_ms: chrono::Utc::now().timestamp_millis(),
    }
}

pub(crate) fn consent_record(
    provider_id: HealthProviderId,
    action: &str,
    categories: Vec<HealthDataCategory>,
) -> HealthConsentRecord {
    HealthConsentRecord {
        id: uuid::Uuid::new_v4().to_string(),
        provider_id,
        action: action.to_owned(),
        categories,
        purpose: "Local sleep history and learning insights".into(),
        policy_version: "1".into(),
        recorded_at_ms: chrono::Utc::now().timestamp_millis(),
    }
}

pub(crate) fn synced(connection: &mut HealthConnection, cursor: Option<String>) {
    let now = chrono::Utc::now().timestamp_millis();
    connection.status = ProviderReadinessState::Connected;
    connection.last_sync_at_ms = Some(now);
    connection.last_success_at_ms = Some(now);
    connection.updated_at_ms = now;
    connection.sync_cursor = cursor;
    connection.last_error_code = None;
    connection.last_error_message = None;
}

#[tauri::command]
pub async fn health_connect_native(
    app: AppHandle,
    provider_id: HealthProviderId,
    consent: HealthProviderConsent,
) -> Result<HealthSyncReport, HealthProviderError> {
    sync_native(&app, provider_id, Some(consent)).await
}

#[tauri::command]
pub async fn health_sync_native(
    app: AppHandle,
    provider_id: HealthProviderId,
) -> Result<HealthSyncReport, HealthProviderError> {
    sync_native(&app, provider_id, None).await
}

async fn sync_native(
    app: &AppHandle,
    provider: HealthProviderId,
    consent: Option<HealthProviderConsent>,
) -> Result<HealthSyncReport, HealthProviderError> {
    let supported = matches!(
        (provider, std::env::consts::OS),
        (HealthProviderId::AppleHealthkit, "ios")
            | (HealthProviderId::AndroidHealthConnect, "android")
    );
    if !supported {
        return Err(HealthProviderError::platform_unsupported(
            provider.as_str(),
            std::env::consts::OS,
        ));
    }
    let operations = app.state::<HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let vault = vault(app).await.map_err(operation_error)?;
    let stored = vault
        .get_connection(provider)
        .await
        .map_err(operation_error)?;
    let mut connection = stored.clone().unwrap_or_else(|| new_connection(provider));
    let audit = if let Some(consent) = &consent {
        connection.requested_categories = NATIVE_CATEGORIES
            .iter()
            .copied()
            .filter(|category| consent.categories.contains(category))
            .collect();
        if connection.requested_categories.is_empty() {
            return Err(HealthProviderError::new(
                "consent_required",
                "Choose at least one category.",
                false,
            ));
        }
        if stored
            .as_ref()
            .is_some_and(|old| old.requested_categories != connection.requested_categories)
        {
            connection.sync_cursor = None;
        }
        Some(consent_record(
            provider,
            "connect",
            connection.requested_categories.clone(),
        ))
    } else {
        if stored.is_none() {
            return Err(HealthProviderError::new(
                "consent_required",
                "Connect the provider before syncing.",
                false,
            ));
        }
        None
    };
    let include_history = consent.is_some_and(|consent| consent.include_history);

    match provider {
        HealthProviderId::AppleHealthkit => {
            sync_healthkit(app, &vault, connection, audit.as_ref()).await
        }
        _ => sync_healthconnect(app, &vault, connection, audit.as_ref(), include_history).await,
    }
}

async fn sync_healthkit(
    app: &AppHandle,
    vault: &HealthVault,
    mut connection: HealthConnection,
    audit: Option<&HealthConsentRecord>,
) -> Result<HealthSyncReport, HealthProviderError> {
    use plethora_healthkit::{
        get_availability_via_app, query_anchored_changes_via_app, request_authorization_via_app,
        HealthKitQueryArgs,
    };
    if !crate::health::provider::healthkit_enabled() {
        return Err(HealthProviderError::new(
            "feature_disabled_compliance",
            "Apple Health is unavailable in this build.",
            false,
        ));
    }
    let app = app.clone();
    let requested: Vec<String> = connection
        .requested_categories
        .iter()
        .map(|c| c.as_str().into())
        .collect();
    let end_ms = chrono::Utc::now().timestamp_millis();
    let first_connection = audit.is_some();
    let anchor = connection.sync_cursor.clone();
    let mut payload: HealthKitPayload = tokio::task::spawn_blocking(move || {
        let availability = get_availability_via_app(&app).map_err(operation_error)?;
        if !availability.available {
            return Err(operation_error(
                "Apple Health is unavailable on this device.",
            ));
        }
        if first_connection {
            let result =
                request_authorization_via_app(&app, requested.clone()).map_err(operation_error)?;
            if !result.prompt_completed {
                return Err(HealthProviderError::new(
                    "permission_denied",
                    "Apple Health authorization was interrupted.",
                    true,
                ));
            }
        }
        let raw = query_anchored_changes_via_app(
            &app,
            HealthKitQueryArgs {
                start_ms: end_ms - 90 * DAY_MS,
                end_ms,
                anchor_base64: anchor,
                categories: Some(requested),
                limit: None,
            },
        )
        .map_err(operation_error)?;
        serde_json::from_value(raw)
            .map_err(|_| operation_error("Apple Health returned an invalid result."))
    })
    .await
    .map_err(operation_error)??;

    let accepts_stages = connection
        .requested_categories
        .contains(&HealthDataCategory::SleepStages);
    if !accepts_stages {
        for sample in &mut payload.sleep_samples {
            if matches!(sample.stage_type.as_str(), "light" | "deep" | "rem") {
                sample.stage_type = "asleep_unknown".into();
                sample.provider_stage_code = None;
            }
        }
    }
    let empty = payload.sleep_samples.is_empty() && payload.physio_samples.is_empty();
    // Apple deliberately does not disclose which read categories were granted.
    connection.auth_state = "read_permission_private".into();
    synced(&mut connection, payload.next_anchor_json.clone());
    let mut report = vault
        .ingest_healthkit_delta(payload, &connection, audit)
        .await
        .map_err(operation_error)?;
    if empty {
        report.warnings.push("Apple Health returned no new records. Check the app's read access in Apple Health if you expected data.".into());
    }
    report.next_cursor = None;
    Ok(report)
}

async fn sync_healthconnect(
    app: &AppHandle,
    vault: &HealthVault,
    mut connection: HealthConnection,
    audit: Option<&HealthConsentRecord>,
    include_history: bool,
) -> Result<HealthSyncReport, HealthProviderError> {
    use plethora_healthconnect::{
        get_changes_token_via_app, get_granted_permissions_via_app, get_sdk_status_via_app,
        read_changes_via_app, read_physiological_records_via_app, read_sleep_sessions_via_app,
        request_permissions_via_app, HealthConnectAuthArgs, HealthConnectQueryArgs,
    };
    let app = app.clone();
    let requested = connection.requested_categories.clone();
    let previous = connection.granted_categories.clone();
    let cursor = connection.sync_cursor.clone();
    let prompt = audit.is_some();
    let now = chrono::Utc::now().timestamp_millis();
    let (permissions, granted, payload) = tokio::task::spawn_blocking(move || {
        let status = get_sdk_status_via_app(&app).map_err(operation_error)?;
        if !status.available {
            return Err(HealthProviderError::new(
                status.status,
                status
                    .reason
                    .unwrap_or_else(|| "Health Connect is unavailable.".into()),
                true,
            ));
        }
        let permissions = if prompt {
            request_permissions_via_app(
                &app,
                HealthConnectAuthArgs {
                    categories: requested.iter().map(|c| c.as_str().into()).collect(),
                    include_history,
                    include_background: false,
                },
            )
        } else {
            get_granted_permissions_via_app(&app)
        }
        .map_err(operation_error)?;
        let granted: Vec<_> = requested
            .iter()
            .copied()
            .filter(|category| {
                permissions
                    .granted_categories
                    .iter()
                    .any(|value| value == category.as_str())
            })
            .collect();
        if granted.is_empty() {
            return Ok((permissions, granted, None));
        }
        if let Some(cursor) = cursor.filter(|_| previous == granted) {
            let raw = read_changes_via_app(&app, cursor).map_err(operation_error)?;
            let payload: HealthConnectPayload =
                serde_json::from_value(raw).map_err(operation_error)?;
            if !payload.changes_token_expired {
                return Ok((permissions, granted, Some(payload)));
            }
        }

        let categories: Vec<String> = granted.iter().map(|c| c.as_str().into()).collect();
        let limit_days = if permissions.has_history_permission {
            90
        } else {
            30
        };
        let args = HealthConnectQueryArgs {
            start_ms: now - limit_days * DAY_MS,
            end_ms: now,
            categories: Some(categories.clone()),
            changes_token: None,
        };
        // Start observing before the snapshot so writes during the read are replayed next time.
        let token = get_changes_token_via_app(&app, categories).map_err(operation_error)?;
        let mut payload: HealthConnectPayload = if granted.iter().any(|c| {
            matches!(
                c,
                HealthDataCategory::Sleep | HealthDataCategory::SleepStages
            )
        }) {
            serde_json::from_value(
                read_sleep_sessions_via_app(&app, args.clone()).map_err(operation_error)?,
            )
            .map_err(operation_error)?
        } else {
            serde_json::from_value(serde_json::json!({})).map_err(operation_error)?
        };
        if granted.iter().any(|c| {
            !matches!(
                c,
                HealthDataCategory::Sleep | HealthDataCategory::SleepStages
            )
        }) {
            let physio: HealthConnectPayload = serde_json::from_value(
                read_physiological_records_via_app(&app, args).map_err(operation_error)?,
            )
            .map_err(operation_error)?;
            payload.physio_records = physio.physio_records;
        }
        payload.next_changes_token = Some(
            token
                .get("changesToken")
                .and_then(|v| v.as_str())
                .ok_or_else(|| operation_error("Health Connect did not supply a changes token."))?
                .to_owned(),
        );
        Ok((permissions, granted, Some(payload)))
    })
    .await
    .map_err(operation_error)??;
    connection.granted_categories = granted;
    connection.history_limit_days = (!permissions.has_history_permission).then_some(30);
    let Some(mut payload) = payload else {
        connection.status = ProviderReadinessState::PermissionRevoked;
        connection.auth_state = "denied".into();
        connection.sync_cursor = None;
        vault
            .ingest_provider_sync(NormalizedIngestionBatch::default(), &connection, audit)
            .await
            .map_err(operation_error)?;
        return Err(HealthProviderError::new(
            "permission_denied",
            "Health Connect did not grant the requested read access.",
            true,
        ));
    };
    payload.has_history_permission = permissions.has_history_permission;
    if !connection
        .granted_categories
        .contains(&HealthDataCategory::SleepStages)
    {
        for sleep in &mut payload.sleep_sessions {
            for stage in &mut sleep.stages {
                if matches!(stage.stage_type.as_str(), "light" | "deep" | "rem") {
                    stage.stage_type = "asleep_unknown".into();
                    stage.provider_stage_code = None;
                }
            }
        }
    }
    let batch = normalize_healthconnect_payload(payload, now, None);
    synced(&mut connection, batch.next_cursor.clone());
    connection.auth_state = if connection.granted_categories == connection.requested_categories {
        "authorized"
    } else {
        "partially_authorized"
    }
    .into();
    let mut report = vault
        .ingest_provider_sync(batch, &connection, audit)
        .await
        .map_err(operation_error)?;
    report.next_cursor = None;
    Ok(report)
}

#[tauri::command]
pub async fn health_disconnect_provider(
    app: AppHandle,
    provider_id: HealthProviderId,
) -> Result<(), HealthProviderError> {
    let operations = app.state::<HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    app.state::<HealthOAuthManager>()
        .cancel_provider(provider_id);
    let vault = vault(&app).await.map_err(operation_error)?;
    if let Some(token) = vault
        .token_store()
        .get_token(provider_id)
        .await
        .map_err(operation_error)?
    {
        // Local disconnect remains available while the broker is offline.
        let _ = super::health_cloud::revoke(&token.access_token, provider_id).await;
    }
    vault
        .disconnect_provider(provider_id)
        .await
        .map_err(operation_error)
}
