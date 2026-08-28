pub mod clock;
pub mod crypto;
pub mod cursor;
pub mod device;
pub mod engine;
pub mod flags;
pub mod merge;
pub mod outbox;
pub mod payload;
pub mod registry;
pub mod transport;
pub mod types;
pub mod wire;

#[cfg(test)]
mod convergence_test;

use crate::database::Repository;
use crate::error::Result as PlethoraResult;
use crate::plethora_auth::AuthManager;
use sqlx::{Pool, Sqlite};
use std::sync::Arc;

use engine::{map_error, pull_remote, push_outbox, run_sync_cycle};
use flags::sync_v2_enabled;
use outbox::count_pending;
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

    async fn refresh_pending_count(&self, pool: &Pool<Sqlite>) {
        if let Ok(count) = count_pending(pool).await {
            if let Ok(mut status) = self.status.write() {
                status.pending_outbox_count = count;
            }
        }
    }
}

async fn status_from_db(repo: &Repository, engine: &SyncEngine) -> PlethoraResult<SyncStatus, String> {
    engine.refresh_pending_count(repo.pool()).await;
    let mut status = engine.get_status();
    status.pending_outbox_count = count_pending(repo.pool())
        .await
        .map_err(map_error)?;
    if !sync_v2_enabled() {
        status.error = Some("Sync v2 disabled (set PLETHORA_SYNC_V2=1)".to_string());
    }
    Ok(status)
}

#[tauri::command]
pub async fn sync_get_status(
    repo: tauri::State<'_, Repository>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
) -> PlethoraResult<SyncStatus, String> {
    status_from_db(&repo, &engine).await
}

#[tauri::command]
pub async fn sync_push(
    repo: tauri::State<'_, Repository>,
    auth: tauri::State<'_, Arc<AuthManager>>,
    engine: tauri::State<'_, Arc<SyncEngine>>,
) -> PlethoraResult<PushResult, String> {
    engine.set_syncing(true);
    let result = push_outbox(&repo, &auth).await.map_err(map_error);
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
    cursor: u64,
    _limit: Option<usize>,
) -> PlethoraResult<PullResult, String> {
    let _ = cursor;
    engine.set_syncing(true);
    let result = pull_remote(&repo, &auth).await.map_err(map_error);
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
) -> PlethoraResult<PushResult, String> {
    engine.set_syncing(true);
    let result = run_sync_cycle(&repo, &auth, &engine)
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
pub fn sync_generate_recovery_key() -> PlethoraResult<String, String> {
    Ok(crypto::SyncCrypto::generate_recovery_key())
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
