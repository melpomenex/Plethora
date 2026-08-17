use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TableKind {
    Documents,
    Extracts,
    LearningItems,
    ReviewResults,
    Collections,
    Settings,
    Tombstones,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncRecord {
    pub id: String,
    pub table_kind: TableKind,
    pub record_id: String,
    pub hlc: String,
    pub device_id: String,
    pub payload_ciphertext: String,
    pub aad: String,
    #[serde(default = "default_key_version")]
    pub key_version: u32,
}

fn default_key_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatus {
    pub is_syncing: bool,
    pub last_synced_at: Option<String>,
    pub pending_outbox_count: usize,
    pub storage_used_bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub accepted: usize,
    pub latest_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    pub records: Vec<SyncRecord>,
    pub cursor: u64,
    pub has_more: bool,
}
