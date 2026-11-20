use std::io::{Read, Write};
use std::path::Path;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
use tokio::sync::Mutex;

use crate::health::db::HealthVault;
use crate::health::fixtures::generate_demo_batch;
use crate::health::import_export::{
    decrypt_export_bundle, encrypt_export_bundle, export_json_bundle, import_apple_health_xml,
    import_json_bundle, import_sleep_csv, ingest_export_bundle, upsert_manual_sleep,
    MAX_ENCRYPTED_IMPORT_BYTES, MAX_IMPORT_BYTES,
};
use crate::health::models::{
    HealthConnection, HealthConsentRecord, HealthFileImportResult, HealthPrivacySettings,
    HealthProviderId, HealthProviderInfo, HealthSourcePreference, HealthSyncReport,
    ManualSleepInput, ProviderCategory, ProviderReadinessState, SleepKind,
};
use crate::health::providers::catalog::build_provider_catalog;

#[derive(Default)]
pub(crate) struct DemoHealthVault(Mutex<Option<HealthVault>>);

pub(crate) async fn open_vault(app: &AppHandle, app_dir: &Path) -> Result<HealthVault, String> {
    #[cfg(target_os = "ios")]
    {
        let health_dir = app_dir.join("health");
        std::fs::create_dir_all(&health_dir).map_err(|error| error.to_string())?;
        let excluded = plethora_healthkit::exclude_health_dir_from_backup_via_app(
            app,
            health_dir.to_string_lossy().into_owned(),
        )
        .map_err(|error| error.to_string())?;
        if !excluded {
            return Err("Could not exclude the health vault from iCloud backups".into());
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = app;

    HealthVault::open(app_dir).await
}

pub(super) async fn vault(app: &AppHandle) -> Result<HealthVault, String> {
    app.state::<crate::BackendReadyState>()
        .wait()
        .await
        .map_err(str::to_owned)?;
    app.try_state::<HealthVault>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Health vault unavailable".to_owned())
}

#[tauri::command]
pub async fn health_list_providers(app: AppHandle) -> Result<Vec<HealthProviderInfo>, String> {
    let vault = vault(&app).await?;
    let (config, broker_offline) = super::health_cloud::provider_config().await;
    let connections = vault.get_connections().await?;
    let mut providers = build_provider_catalog(&config, &connections);
    if broker_offline {
        for provider in &mut providers {
            if provider.category == ProviderCategory::CloudOauth
                && !connections
                    .iter()
                    .any(|link| link.provider_id == provider.id)
            {
                provider.readiness_state = ProviderReadinessState::TemporarilyUnavailable;
                provider.readiness_reason = "The wearable sign-in service is offline.".into();
            }
        }
    }
    #[cfg(target_os = "android")]
    if let Some(provider) = providers
        .iter_mut()
        .find(|entry| entry.id == HealthProviderId::AndroidHealthConnect)
    {
        if let Ok(Ok(status)) = tokio::task::spawn_blocking(move || {
            plethora_healthconnect::get_sdk_status_via_app(&app)
        })
        .await
        {
            if !status.available {
                provider.readiness_state = if status.status == "provider_update_required" {
                    ProviderReadinessState::TemporarilyUnavailable
                } else {
                    ProviderReadinessState::Unsupported
                };
                provider.readiness_reason = status
                    .reason
                    .unwrap_or_else(|| "Health Connect is unavailable.".into());
            }
        }
    }
    Ok(providers)
}

#[tauri::command]
pub async fn health_get_connections(app: AppHandle) -> Result<Vec<HealthConnection>, String> {
    let mut connections = vault(&app).await?.get_connections().await?;
    for connection in &mut connections {
        connection.sync_cursor = None;
        connection.account_subject_hint = None;
    }
    Ok(connections)
}

#[tauri::command]
pub async fn health_get_source_preferences(
    app: AppHandle,
) -> Result<Vec<HealthSourcePreference>, String> {
    vault(&app).await?.get_source_preferences().await
}

#[tauri::command]
pub async fn health_set_source_preferences(
    app: AppHandle,
    preference: HealthSourcePreference,
) -> Result<(), String> {
    vault(&app)
        .await?
        .set_source_preference(&preference.category, preference.ordered_provider_ids)
        .await
}

#[tauri::command]
pub async fn health_get_privacy_settings(app: AppHandle) -> Result<HealthPrivacySettings, String> {
    let mut settings = vault(&app).await?.get_privacy_settings().await?;
    settings.demo_mode_enabled = app.state::<DemoHealthVault>().0.lock().await.is_some();
    Ok(settings)
}

#[tauri::command]
pub async fn health_update_privacy_settings(
    app: AppHandle,
    settings: HealthPrivacySettings,
) -> Result<HealthPrivacySettings, String> {
    if settings.ai_sharing_enabled
        || settings.cloud_sync_enabled
        || settings.retention_days.is_some()
    {
        return Err("Health sharing, sync, and automatic retention are unavailable".into());
    }
    vault(&app)
        .await?
        .update_privacy_settings(HealthPrivacySettings::default())
        .await?;
    health_get_privacy_settings(app).await
}

#[tauri::command]
pub async fn health_get_consent_log(app: AppHandle) -> Result<Vec<HealthConsentRecord>, String> {
    vault(&app).await?.get_consent_log(200).await
}

#[derive(serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ManualSleepDetails {
    notes: Option<String>,
    subjective_quality: Option<i32>,
}

#[tauri::command]
pub async fn health_get_manual_sleep(
    app: AppHandle,
    raw_session_id: String,
) -> Result<ManualSleepDetails, String> {
    let vault = vault(&app).await?;
    sqlx::query_as(
        "SELECT notes, subjective_quality FROM health_raw_sleep_sessions
                    WHERE id = ? AND provider_id = 'manual' AND is_deleted = 0",
    )
    .bind(raw_session_id)
    .fetch_optional(vault.pool())
    .await
    .map_err(|_| "Could not read the sleep entry.".to_owned())?
    .ok_or_else(|| "The sleep entry is unavailable.".into())
}

#[tauri::command]
pub async fn health_upsert_manual_sleep(
    app: AppHandle,
    input: ManualSleepInput,
) -> Result<HealthSyncReport, String> {
    upsert_manual_sleep(&vault(&app).await?, input).await
}

#[tauri::command]
pub async fn health_delete_manual_sleep(
    app: AppHandle,
    raw_session_id: String,
) -> Result<bool, String> {
    vault(&app)
        .await?
        .delete_manual_sleep(&raw_session_id)
        .await
}

#[tauri::command]
pub async fn health_override_sleep_kind(
    app: AppHandle,
    raw_session_id: String,
    sleep_kind: SleepKind,
) -> Result<(), String> {
    vault(&app)
        .await?
        .set_sleep_kind_override(&raw_session_id, sleep_kind)
        .await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthImportFormat {
    Json,
    Csv,
    AppleHealthXml,
}

#[tauri::command]
pub async fn health_import_file(
    app: AppHandle,
    format: HealthImportFormat,
) -> Result<Option<HealthFileImportResult>, String> {
    let vault = vault(&app).await?;
    let (label, extension) = match format {
        HealthImportFormat::Json => ("Plethora health export", "json"),
        HealthImportFormat::Csv => ("Sleep log", "csv"),
        HealthImportFormat::AppleHealthXml => ("Apple Health export", "xml"),
    };
    let Some(bytes) = pick_health_file(&app, label, extension, MAX_IMPORT_BYTES).await? else {
        return Ok(None);
    };
    let result = match format {
        HealthImportFormat::Json => import_json_bundle(&vault, utf8(&bytes)?).await,
        HealthImportFormat::Csv => import_sleep_csv(&vault, utf8(&bytes)?).await,
        HealthImportFormat::AppleHealthXml => import_apple_health_xml(&vault, &bytes).await,
    };
    result.map(Some)
}

#[tauri::command]
pub async fn health_export_json(app: AppHandle) -> Result<bool, String> {
    let bundle = export_json_bundle(&vault(&app).await?).await?;
    if bundle.contains_healthkit_derived {
        return Err("Use encrypted export for Apple HealthKit records".into());
    }
    let bytes = serde_json::to_vec(&bundle).map_err(|_| "Could not serialize health export")?;
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err("Health bundle exceeds the 50 MB payload limit".into());
    }
    save_health_file(&app, "plethora-health.json", "json", bytes).await
}

#[tauri::command]
pub async fn health_export_encrypted_bundle(
    app: AppHandle,
    passphrase: String,
) -> Result<bool, String> {
    let bundle = export_json_bundle(&vault(&app).await?).await?;
    let encoded = tokio::task::spawn_blocking(move || encrypt_export_bundle(&bundle, &passphrase))
        .await
        .map_err(|_| "Health export encryption failed")??;
    save_health_file(
        &app,
        "export.plethora-health.enc",
        "enc",
        encoded.into_bytes(),
    )
    .await
}

#[tauri::command]
pub async fn health_import_encrypted_bundle(
    app: AppHandle,
    passphrase: String,
) -> Result<Option<HealthFileImportResult>, String> {
    let vault = vault(&app).await?;
    let Some(bytes) = pick_health_file(
        &app,
        "Encrypted health bundle",
        "enc",
        MAX_ENCRYPTED_IMPORT_BYTES,
    )
    .await?
    else {
        return Ok(None);
    };
    let bundle =
        tokio::task::spawn_blocking(move || decrypt_export_bundle(utf8(&bytes)?, &passphrase))
            .await
            .map_err(|_| "Health import decryption failed")??;
    ingest_export_bundle(&vault, bundle, "encrypted")
        .await
        .map(Some)
}

#[tauri::command]
pub async fn health_load_demo_dataset(app: AppHandle) -> Result<(), String> {
    let mut demo = app.state::<DemoHealthVault>().inner().0.lock().await;
    if demo.is_none() {
        let vault = HealthVault::new_in_memory().await?;
        let now = chrono::Utc::now().timestamp_millis();
        vault
            .ingest_batch(
                HealthProviderId::Oura,
                "demo",
                generate_demo_batch(180, now, 42),
            )
            .await?;
        *demo = Some(vault);
    }
    Ok(())
}

#[tauri::command]
pub async fn health_clear_demo_dataset(app: AppHandle) -> Result<(), String> {
    *app.state::<DemoHealthVault>().0.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn health_delete_provider_data(
    app: AppHandle,
    provider_id: HealthProviderId,
) -> Result<(), String> {
    let operations = app.state::<super::health_sources::HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let oauth = app.state::<crate::health::oauth::HealthOAuthManager>();
    oauth.cancel_provider(provider_id);
    vault(&app).await?.delete_provider_data(provider_id).await
}

#[tauri::command]
pub async fn health_wipe_all_data(app: AppHandle) -> Result<(), String> {
    let operations = app.state::<super::health_sources::HealthSourceOperations>();
    let _guard = operations.0.lock().await;
    let oauth = app.state::<crate::health::oauth::HealthOAuthManager>();
    oauth.cancel_all();
    health_clear_demo_dataset(app.clone()).await?;
    vault(&app).await?.wipe_all_health_data().await
}

fn utf8(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes).map_err(|_| "Health import must use UTF-8".into())
}

async fn pick_health_file(
    app: &AppHandle,
    label: &str,
    extension: &str,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(label, &[extension])
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive
        .await
        .map_err(|_| "Could not select health import file")?
    else {
        return Ok(None);
    };

    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let reader = app
            .fs()
            .open(file, OpenOptions::new().read(true).to_owned())
            .map_err(|_| "Could not open health import file")?;
        let mut bytes = Vec::new();
        reader
            .take(max_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read health import file")?;
        if bytes.len() > max_bytes {
            return Err("Health import file exceeds the payload limit".into());
        }
        Ok(Some(bytes))
    })
    .await
    .map_err(|_| "Could not read health import file")?
}

async fn save_health_file(
    app: &AppHandle,
    file_name: &str,
    extension: &str,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let (send, receive) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("Health export", &[extension])
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive
        .await
        .map_err(|_| "Could not choose a health export destination")?
    else {
        return Ok(false);
    };
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let options = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .to_owned();
        app.fs()
            .open(file, options)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|_| "Could not save health export file")?;
        Ok(true)
    })
    .await
    .map_err(|_| "Could not save health export file")?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthAnalysisRange {
    start_ms: i64,
    end_ms: i64,
    tz_offset_secs: Option<i32>,
}

impl HealthAnalysisRange {
    fn validate(&self) -> Result<(), String> {
        const MAX_WINDOW_MS: i64 = 1_097 * 86_400_000;
        if self.start_ms < 0
            || self.end_ms <= self.start_ms
            || self.end_ms.saturating_sub(self.start_ms) > MAX_WINDOW_MS
            || chrono::DateTime::from_timestamp_millis(self.end_ms).is_none()
            || self
                .tz_offset_secs
                .is_some_and(|offset| !(-64_800..=64_800).contains(&offset))
        {
            return Err("Invalid health analysis date range or timezone".into());
        }
        Ok(())
    }
}

async fn analysis_vault(app: &AppHandle, demo: bool) -> Result<HealthVault, String> {
    if demo {
        return app
            .state::<DemoHealthVault>()
            .0
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Load the demo dataset first".into());
    }
    vault(app).await
}

async fn learning_telemetry(
    app: &AppHandle,
    range: &HealthAnalysisRange,
    demo: bool,
) -> Result<crate::health::telemetry::LearningTelemetrySnapshot, String> {
    if demo {
        return Ok(Default::default());
    }
    let repo = app.state::<crate::database::Repository>();
    crate::health::telemetry::load_learning_telemetry(
        repo.pool(),
        Some(range.start_ms),
        Some(range.end_ms),
    )
    .await
}

#[tauri::command]
pub async fn health_get_sleep_chart_data(
    app: AppHandle,
    range: HealthAnalysisRange,
    demo: bool,
    include_learning: bool,
) -> Result<crate::health::sleep_analytics::SleepChartData, String> {
    use crate::health::sleep_analytics::{build_sleep_chart_data, StudyOverlayPoint};
    use crate::health::telemetry::{build_comparable_sessions, replay_reviews_fsrs7};

    range.validate()?;
    let vault = analysis_vault(&app, demo).await?;
    let start = Some(range.start_ms);
    let end = Some(range.end_ms);
    let (episodes, physio, recovery) = tokio::try_join!(
        vault.query_canonical_sleep_episodes(start, end, demo),
        vault.query_physiological_observations(start, end, demo),
        vault.query_recovery_observations(start, end, demo),
    )?;
    let telemetry = if include_learning && !demo {
        learning_telemetry(&app, &range, false).await?
    } else {
        Default::default()
    };

    tokio::task::spawn_blocking(move || {
        let mut overlays = Vec::new();
        if !telemetry.reviews.is_empty() {
            let reviews = replay_reviews_fsrs7(&telemetry.reviews)?;
            let sessions = build_comparable_sessions(
                &reviews,
                &[],
                &[],
                &[],
                start,
                end,
                None,
                range.tz_offset_secs,
            );
            overlays.extend(sessions.into_iter().map(|session| StudyOverlayPoint {
                session_id: session.session_id,
                started_at_ms: session.started_at_ms,
                ended_at_ms: session.ended_at_ms,
                review_count: session.total_reviews,
                mean_residual: session.mean_fsrs_residual,
                activity_kind: "review".into(),
                plan_ids: session.plan_ids,
            }));
        }
        overlays.extend(
            telemetry
                .reading_sessions
                .into_iter()
                .map(|session| StudyOverlayPoint {
                    session_id: session.id,
                    started_at_ms: session.started_at_ms,
                    ended_at_ms: session.ended_at_ms,
                    review_count: 0,
                    mean_residual: None,
                    activity_kind: "reading".into(),
                    plan_ids: Vec::new(),
                }),
        );
        overlays.extend(
            telemetry
                .assessments
                .into_iter()
                .map(|attempt| StudyOverlayPoint {
                    session_id: attempt.attempt_id,
                    started_at_ms: attempt.started_at_ms,
                    ended_at_ms: attempt.submitted_at_ms,
                    review_count: 0,
                    mean_residual: None,
                    activity_kind: attempt.mode,
                    plan_ids: attempt.plan_id.into_iter().collect(),
                }),
        );
        overlays.sort_by_key(|overlay| overlay.started_at_ms);

        Ok(build_sleep_chart_data(
            episodes,
            &physio,
            &recovery,
            overlays,
            range.start_ms,
            range.end_ms,
            range.tz_offset_secs,
        ))
    })
    .await
    .map_err(|_| "Sleep chart analysis failed")?
}

async fn learning_insights(
    app: &AppHandle,
    range: HealthAnalysisRange,
    plan_id: Option<String>,
    demo: bool,
) -> Result<crate::health::learning_analytics::LearningInsightsReport, String> {
    use crate::health::learning_analytics::compute_learning_insights;

    range.validate()?;
    let vault = analysis_vault(app, demo).await?;
    let end = Some(range.end_ms);
    let (episodes, physio, recovery, telemetry) = tokio::try_join!(
        vault.query_canonical_sleep_episodes(None, end, demo),
        vault.query_physiological_observations(None, end, demo),
        vault.query_recovery_observations(None, end, demo),
        learning_telemetry(app, &range, demo),
    )?;
    tokio::task::spawn_blocking(move || {
        compute_learning_insights(
            &telemetry,
            &episodes,
            &physio,
            &recovery,
            Some(range.start_ms),
            end,
            plan_id.as_deref(),
            range.tz_offset_secs,
            demo,
        )
    })
    .await
    .map_err(|_| "Learning insights analysis failed")?
}

#[tauri::command]
pub async fn health_get_learning_insights(
    app: AppHandle,
    range: HealthAnalysisRange,
    demo: bool,
) -> Result<crate::health::learning_analytics::LearningInsightsReport, String> {
    learning_insights(&app, range, None, demo).await
}

#[tauri::command]
pub async fn health_get_study_plan_insights(
    app: AppHandle,
    range: HealthAnalysisRange,
    plan_id: String,
) -> Result<crate::health::learning_analytics::LearningInsightsReport, String> {
    learning_insights(&app, range, Some(plan_id), false).await
}
