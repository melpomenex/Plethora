pub mod blobs;
pub mod bootstrap;
pub mod clock;
pub mod crypto;
pub mod cursor;
pub mod device;
pub mod engine;
pub mod flags;
pub mod gate;
pub mod issues;
pub mod journal;
pub mod keys;
pub mod merge;
pub mod outbox;
pub mod pairing;
pub mod payload;
pub mod registry;
pub mod retry;
pub mod scheduler;
pub mod settings;
pub mod telemetry;
pub mod transport;
pub mod types;
pub mod wire;

#[cfg(test)]
mod convergence_test;
#[cfg(test)]
mod chaos_test;

use crate::database::Repository;
use crate::entitlements::EntitlementCache;
use crate::error::Result as PlethoraResult;
use crate::plethora_auth::AuthManager;
use gate::cloud_sync_enabled;
use sqlx::{Pool, Sqlite};
use std::sync::Arc;
use tauri::Emitter;

use engine::{map_error, pull_remote, push_outbox, run_sync_cycle};
use flags::sync_v2_enabled;
use issues::SyncIssue;
use keys::{
    load_master_key, mark_recovery_key_acknowledged, recovery_key_acknowledged,
    store_master_key_from_recovery,
};
use outbox::count_pending;
use pairing::{accept_pairing, begin_pairing, export_pairing_bundle, PairingAcceptRequest};
use types::{PullResult, PushResult, SyncStatus};

#[derive(Debug, Clone)]
pub struct SyncEngine {
    status: Arc<std::sync::RwLock<SyncStatus>>,
}

impl Default for SyncEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncEngine {
    pub fn new() -> Self {
        Self {
            status: Arc::new(std::sync::RwLock::new(SyncStatus {
                is_syncing: false,
                last_synced_at: None,
                pending_outbox_count: 0,
                storage_used_bytes: 0,
                error: None,
            })),
        }
    }

    pub fn get_status(&self) -> SyncStatus {
        self.status.read().unwrap().clone()
    }

    pub fn set_syncing(&self, syncing: bool) {
        if let Ok(mut status) = self.status.write() {
            status.is_syncing = syncing;
        }
    }

    pub fn set_last_synced(&self, timestamp: String) {
        if let Ok(mut status) = self.status.write() {
            status.last_synced_at = Some(timestamp);
            status.error = None;
        }
    }

    pub fn set_error(&self, message: String) {
        if let Ok(mut status) = self.status.write() {
            status.error = Some(message);
            status.is_syncing = false;
        }
    }

    pub fn set_storage_used_bytes(&self, bytes: u64) {
        if let Ok(mut status) = self.status.write() {
            status.storage_used_bytes = bytes;
        }
    }

    pub(crate) async fn refresh_pending_count(&self, pool: &Pool<Sqlite>) {
        if let Ok(count) = count_pending(pool).await {
            if let Ok(mut status) = self.status.write() {
                status.pending_outbox_count = count;
            }
        }
    }

    pub async fn refresh_and_emit(&self, app: &tauri::AppHandle, pool: &Pool<Sqlite>) {
        self.refresh_pending_count(pool).await;
        let _ = app.emit("plethora-sync-status-changed", self.get_status());
    }
}

async fn status_from_db(
    repo: &Repository,
    engine: &SyncEngine,
    entitlements: &EntitlementCache,
) -> PlethoraResult<SyncStatus, String> {
    engine.refresh_pending_count(repo.pool()).await;
    let mut status = engine.get_status();
    status.pending_outbox_count = count_pending(repo.pool())
        .await
        .map_err(map_error)?;
    if !sync_v2_enabled(Some(cloud_sync_enabled(entitlements))) {
        status.error = Some("Plethora Pro cloud sync is required".to_string());
    }
    Ok(status)
}

#[tauri::command]
pub async fn sync_get_status(
    repo: tauri::State<'_, Repository>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
    entitlements: tauri::State<'_, Arc<EntitlementCache>>,
) -> PlethoraResult<SyncStatus, String> {
    status_from_db(&repo, &engine, &*entitlements).await
}

#[tauri::command]
pub async fn sync_push(
    repo: tauri::State<'_, Repository>,
    auth: tauri::State<'_, Arc<AuthManager>>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
    entitlements: tauri::State<'_, Arc<EntitlementCache>>,
) -> PlethoraResult<PushResult, String> {
    engine.set_syncing(true);
    let result = push_outbox(&repo, &auth, &*entitlements).await.map_err(map_error);
    engine.set_syncing(false);
    engine.refresh_pending_count(repo.pool()).await;
    match &result {
        Ok(_) => engine.set_last_synced(chrono::Utc::now().to_rfc3339()),
        Err(message) => engine.set_error(message.clone()),
    }
    result
}

#[tauri::command]
pub async fn sync_pull(
    repo: tauri::State<'_, Repository>,
    auth: tauri::State<'_, Arc<AuthManager>>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
    entitlements: tauri::State<'_, Arc<EntitlementCache>>,
    cursor: u64,
    _limit: Option<usize>,
) -> PlethoraResult<PullResult, String> {
    let _ = cursor;
    engine.set_syncing(true);
    let result = pull_remote(&repo, &auth, &*entitlements).await.map_err(map_error);
    engine.set_syncing(false);
    engine.refresh_pending_count(repo.pool()).await;
    match &result {
        Ok(_) => engine.set_last_synced(chrono::Utc::now().to_rfc3339()),
        Err(message) => engine.set_error(message.clone()),
    }
    result
}

#[tauri::command]
pub async fn sync_run(
    repo: tauri::State<'_, Repository>,
    auth: tauri::State<'_, Arc<AuthManager>>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
    entitlements: tauri::State<'_, Arc<EntitlementCache>>,
) -> PlethoraResult<PushResult, String> {
    engine.set_syncing(true);
    let result = run_sync_cycle(&repo, &auth, &engine, &*entitlements)
        .await
        .map(|(push, _pull)| push)
        .map_err(map_error);
    engine.set_syncing(false);
    engine.refresh_pending_count(repo.pool()).await;
    match &result {
        Ok(_) => engine.set_last_synced(chrono::Utc::now().to_rfc3339()),
        Err(message) => engine.set_error(message.clone()),
    }
    result
}

#[tauri::command]
pub async fn sync_list_issues(
    repo: tauri::State<'_, Repository>,
    limit: Option<i64>,
) -> PlethoraResult<Vec<SyncIssue>, String> {
    issues::list_open_issues(repo.pool(), limit.unwrap_or(20))
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_resolve_issue(
    repo: tauri::State<'_, Repository>,
    issue_id: String,
    resolution: String,
) -> PlethoraResult<(), String> {
    issues::apply_resolution_to_outbox(repo.pool(), &issue_id, &resolution)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_bootstrap_upload(
    repo: tauri::State<'_, Repository>,
) -> PlethoraResult<bootstrap::BootstrapProgress, String> {
    bootstrap::bootstrap_upload_scan(repo.pool())
        .await
        .map_err(map_error)
}

#[tauri::command]
pub fn sync_generate_recovery_key() -> PlethoraResult<String, String> {
    Ok(crypto::SyncCrypto::generate_recovery_key())
}

#[tauri::command]
pub async fn sync_store_recovery_key(recovery_key: String) -> PlethoraResult<(), String> {
    store_master_key_from_recovery(&recovery_key)
        .await
        .map(|_| ())
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_ack_recovery_key() -> PlethoraResult<(), String> {
    mark_recovery_key_acknowledged().await.map_err(map_error)
}

#[tauri::command]
pub async fn sync_recovery_key_acknowledged() -> PlethoraResult<bool, String> {
    recovery_key_acknowledged().await.map_err(map_error)
}

#[tauri::command]
pub async fn sync_pairing_begin() -> PlethoraResult<pairing::PairingOffer, String> {
    begin_pairing().await.map_err(map_error)
}

#[tauri::command]
pub async fn sync_pairing_export(
    peer_public_key_b64: String,
    pairing_code: String,
) -> PlethoraResult<PairingAcceptRequest, String> {
    export_pairing_bundle(&peer_public_key_b64, &pairing_code)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_pairing_accept(request: PairingAcceptRequest) -> PlethoraResult<(), String> {
    accept_pairing(request).await.map_err(map_error)
}

#[tauri::command]
pub async fn sync_revoke_device_epoch() -> PlethoraResult<u32, String> {
    keys::increment_key_epoch().await.map_err(map_error)
}

#[tauri::command]
pub fn sync_on_network_restored() {
    scheduler::on_network_restored();
}

#[tauri::command]
pub fn sync_set_online(online: bool) {
    scheduler::set_online(online);
}

#[tauri::command]
pub fn sync_set_wifi_only(enabled: bool) {
    scheduler::set_wifi_only(enabled);
}

#[tauri::command]
pub fn sync_set_on_wifi(on_wifi: bool) {
    scheduler::set_on_wifi(on_wifi);
}

#[tauri::command]
pub async fn sync_fetch_storage_usage(
    auth: tauri::State<'_, Arc<AuthManager>>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
) -> PlethoraResult<blobs::StorageUsageResponse, String> {
    let token = auth
        .get_access_token()
        .ok_or_else(|| "Sign in required".to_string())?;
    let usage = blobs::fetch_storage_usage(&token).await.map_err(map_error)?;
    engine.set_storage_used_bytes(usage.used_bytes);
    Ok(usage)
}

#[tauri::command]
pub async fn sync_upload_blob(
    auth: tauri::State<'_, Arc<AuthManager>>,
    bytes: Vec<u8>,
    content_type: Option<String>,
) -> PlethoraResult<String, String> {
    let token = auth
        .get_access_token()
        .ok_or_else(|| "Sign in required".to_string())?;
    blobs::upload_blob_if_missing(&token, &bytes, content_type.as_deref().unwrap_or("application/octet-stream"))
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_has_master_key() -> PlethoraResult<bool, String> {
    Ok(load_master_key().await.map_err(map_error)?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_engine_tracks_last_synced_timestamp() {
        let engine = SyncEngine::new();
        engine.set_last_synced("2026-01-01T00:00:00Z".to_string());
        assert_eq!(
            engine.get_status().last_synced_at.as_deref(),
            Some("2026-01-01T00:00:00Z")
        );
    }
}
