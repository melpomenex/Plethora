pub mod crypto;
pub mod types;

use crypto::SyncCrypto;
use std::sync::{Arc, RwLock};
use types::{PullResult, PushResult, SyncRecord, SyncStatus, TableKind};

#[derive(Debug, Clone)]
pub struct SyncEngine {
    outbox: Arc<RwLock<Vec<SyncRecord>>>,
    status: Arc<RwLock<SyncStatus>>,
}

impl Default for SyncEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncEngine {
    pub fn new() -> Self {
        Self {
            outbox: Arc::new(RwLock::new(Vec::new())),
            status: Arc::new(RwLock::new(SyncStatus {
                is_syncing: false,
                last_synced_at: None,
                pending_outbox_count: 0,
                storage_used_bytes: 0,
                error: None,
            })),
        }
    }

    pub fn get_status(&self) -> SyncStatus {
        let mut status = self.status.read().unwrap().clone();
        if let Ok(outbox) = self.outbox.read() {
            status.pending_outbox_count = outbox.len();
        }
        status
    }

    pub fn enqueue_change(&self, record: SyncRecord) {
        if let Ok(mut outbox) = self.outbox.write() {
            if outbox.len() < 1000 {
                outbox.push(record);
            }
        }
    }

    pub fn drain_outbox(&self, max_batch: usize) -> Vec<SyncRecord> {
        if let Ok(mut outbox) = self.outbox.write() {
            let count = outbox.len().min(max_batch);
            outbox.drain(0..count).collect()
        } else {
            Vec::new()
        }
    }

    pub fn set_last_synced(&self, timestamp: String) {
        if let Ok(mut status) = self.status.write() {
            status.last_synced_at = Some(timestamp);
            status.error = None;
        }
    }
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn sync_get_status(engine: tauri::State<Arc<SyncEngine>>) -> Result<SyncStatus, String> {
    Ok(engine.get_status())
}

#[tauri::command]
pub fn sync_push(
    engine: tauri::State<Arc<SyncEngine>>,
    _records: Option<Vec<SyncRecord>>,
) -> Result<PushResult, String> {
    let drained = engine.drain_outbox(500);
    let now = chrono::Utc::now().to_rfc3339();
    engine.set_last_synced(now);

    Ok(PushResult {
        accepted: drained.len(),
        latest_seq: 1,
    })
}

#[tauri::command]
pub fn sync_pull(
    _engine: tauri::State<Arc<SyncEngine>>,
    cursor: u64,
    _limit: Option<usize>,
) -> Result<PullResult, String> {
    Ok(PullResult {
        records: Vec::new(),
        cursor,
        has_more: false,
    })
}

#[tauri::command]
pub fn sync_generate_recovery_key() -> Result<String, String> {
    Ok(SyncCrypto::generate_recovery_key())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_engine_outbox_bounded_lifecycle() {
        let engine = SyncEngine::new();
        assert_eq!(engine.get_status().pending_outbox_count, 0);

        let rec = SyncRecord {
            id: "rec-1".to_string(),
            table_kind: TableKind::Documents,
            record_id: "doc-1".to_string(),
            hlc: "hlc-1".to_string(),
            device_id: "dev-1".to_string(),
            payload_ciphertext: "ciphertext-b64".to_string(),
            aad: "aad".to_string(),
            key_version: 1,
        };

        engine.enqueue_change(rec.clone());
        assert_eq!(engine.get_status().pending_outbox_count, 1);

        let drained = engine.drain_outbox(10);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].id, "rec-1");
        assert_eq!(engine.get_status().pending_outbox_count, 0);
    }
}
