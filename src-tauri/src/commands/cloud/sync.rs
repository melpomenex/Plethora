//! Cloud sync commands
//!
//! Legacy command names redirect to the v2 delta sync engine.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tauri::State;

use crate::cloud::auth_store::CloudAuthProvider;
use crate::cloud::{CloudProviderType, ConflictResolution, FileInfo, SyncResult};
use crate::cloud_sync::SyncStatus;
use crate::database::Repository;
use crate::entitlements::EntitlementCache;
use crate::plethora_auth::AuthManager;
use crate::sync::{self, issues, SyncEngine};

fn map_resolution(resolution: ConflictResolution) -> &'static str {
    match resolution {
        ConflictResolution::KeepLocal | ConflictResolution::KeepNewest => "keep_mine",
        ConflictResolution::KeepRemote => "keep_theirs",
        ConflictResolution::KeepBoth => "both",
    }
}

/// Initialize cloud sync manager (v2 engine is always available).
#[tauri::command]
pub async fn cloud_sync_init(_repo: State<'_, Repository>) -> Result<(), String> {
    Ok(())
}

/// Perform two-way sync via the v2 delta sync engine.
#[tauri::command]
pub async fn cloud_sync_now(
    repo: State<'_, Repository>,
    auth: State<'_, Arc<AuthManager>>,
    engine: State<'_, Arc<SyncEngine>>,
    entitlements: State<'_, Arc<EntitlementCache>>,
) -> Result<SyncResult, String> {
    let started = std::time::Instant::now();
    engine.set_syncing(true);
    let result = sync::engine::run_sync_cycle(&repo, &auth, &engine, &*entitlements).await;
    engine.set_syncing(false);
    engine.refresh_pending_count(repo.pool()).await;

    match result {
        Ok((push, pull)) => {
            engine.set_last_synced(chrono::Utc::now().to_rfc3339());
            Ok(SyncResult {
                success: true,
                uploaded: push.accepted,
                downloaded: pull.records.len(),
                conflicts: vec![],
                error: None,
                duration_secs: started.elapsed().as_secs(),
            })
        }
        Err(error) => {
            engine.set_error(error.to_string());
            Ok(SyncResult {
                success: false,
                uploaded: 0,
                downloaded: 0,
                conflicts: vec![],
                error: Some(error.to_string()),
                duration_secs: started.elapsed().as_secs(),
            })
        }
    }
}

/// Get sync status from the v2 engine.
#[tauri::command]
pub async fn cloud_sync_get_status(
    repo: State<'_, Repository>,
    engine: State<'_, Arc<SyncEngine>>,
    _entitlements: State<'_, Arc<EntitlementCache>>,
) -> Result<SyncStatus, String> {
    engine.refresh_pending_count(repo.pool()).await;
    let status = engine.get_status();
    let issues = issues::list_open_issues(repo.pool(), 50)
        .await
        .map_err(|e| e.to_string())?;
    let last_sync = status
        .last_synced_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Ok(SyncStatus {
        last_sync,
        sync_version: 2,
        pending_conflicts: issues.len(),
        provider_authenticated: status.error.is_none(),
    })
}

/// Resolve sync conflicts via v2 issue resolution.
#[tauri::command]
pub async fn cloud_sync_resolve_conflicts(
    repo: State<'_, Repository>,
    resolutions: Vec<ConflictResolution>,
) -> Result<(), String> {
    let issues = issues::list_open_issues(repo.pool(), resolutions.len() as i64)
        .await
        .map_err(|e| e.to_string())?;
    for (issue, resolution) in issues.iter().zip(resolutions.iter()) {
        issues::apply_resolution_to_outbox(
            repo.pool(),
            &issue.id,
            map_resolution(*resolution),
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List cloud files for import
#[tauri::command]
pub async fn cloud_list_files(
    provider_type: String,
    path: String,
    auth_provider: State<'_, CloudAuthProvider>,
) -> Result<Vec<FileInfo>, String> {
    let provider_type = CloudProviderType::from_str(&provider_type)
        .ok_or_else(|| format!("Unknown provider type: {}", provider_type))?;

    let provider = auth_provider.get_provider(provider_type).ok_or_else(|| {
        format!(
            "No authenticated {} provider found. Please authenticate first.",
            provider_type
        )
    })?;

    let guard = provider.read().await;
    guard.list_files(&path).await.map_err(|e| e.to_string())
}

/// Import files from cloud
#[tauri::command]
pub async fn cloud_import_files(
    provider_type: String,
    files: Vec<String>,
    _repo: State<'_, Repository>,
    auth_provider: State<'_, CloudAuthProvider>,
) -> Result<ImportResult, String> {
    let provider_type = CloudProviderType::from_str(&provider_type)
        .ok_or_else(|| format!("Unknown provider type: {}", provider_type))?;

    let provider = auth_provider.get_provider(provider_type).ok_or_else(|| {
        format!(
            "No authenticated {} provider found. Please authenticate first.",
            provider_type
        )
    })?;

    let guard = provider.read().await;

    let mut imported = 0;
    let mut failed = 0;
    let mut errors = Vec::new();

    for file_path in &files {
        match guard.download_file(file_path, None).await {
            Ok(_) => imported += 1,
            Err(e) => {
                failed += 1;
                errors.push(format!("{}: {}", file_path, e));
            }
        }
    }

    Ok(ImportResult {
        imported,
        failed,
        errors,
    })
}

/// Import result
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ImportResult {
    pub imported: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}
