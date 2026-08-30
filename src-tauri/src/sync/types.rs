use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    LearningItem,
    ReviewResult,
    Document,
    Extract,
    Collection,
    Tag,
    Setting,
    ImageAsset,
    Tombstone,
}

impl EntityType {
    pub fn as_str(self) -> &'static str {
        match self {
            EntityType::LearningItem => "learning_item",
            EntityType::ReviewResult => "review_result",
            EntityType::Document => "document",
            EntityType::Extract => "extract",
            EntityType::Collection => "collection",
            EntityType::Tag => "tag",
            EntityType::Setting => "setting",
            EntityType::ImageAsset => "image_asset",
            EntityType::Tombstone => "tombstone",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "learning_item" => Some(EntityType::LearningItem),
            "review_result" => Some(EntityType::ReviewResult),
            "document" | "documents" => Some(EntityType::Document),
            "extract" | "extracts" => Some(EntityType::Extract),
            "collection" | "collections" => Some(EntityType::Collection),
            "tag" | "tags" => Some(EntityType::Tag),
            "setting" | "settings" => Some(EntityType::Setting),
            "image_asset" | "image_assets" => Some(EntityType::ImageAsset),
            "tombstone" | "tombstones" => Some(EntityType::Tombstone),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncOperation {
    Create,
    Update,
    Delete,
    AppendEvent,
}

impl SyncOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            SyncOperation::Create => "create",
            SyncOperation::Update => "update",
            SyncOperation::Delete => "delete",
            SyncOperation::AppendEvent => "append_event",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeStrategy {
    FieldLww,
    AppendOnly,
    SetLike,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncOutboxStatus {
    Pending,
    Uploading,
    Acknowledged,
    Failed,
}

impl SyncOutboxStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SyncOutboxStatus::Pending => "pending",
            SyncOutboxStatus::Uploading => "uploading",
            SyncOutboxStatus::Acknowledged => "acknowledged",
            SyncOutboxStatus::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(SyncOutboxStatus::Pending),
            "uploading" => Some(SyncOutboxStatus::Uploading),
            "acknowledged" => Some(SyncOutboxStatus::Acknowledged),
            "failed" => Some(SyncOutboxStatus::Failed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutboxEntry {
    pub change_id: String,
    pub entity_type: EntityType,
    pub entity_id: String,
    pub operation: SyncOperation,
    pub base_revision: Option<i64>,
    pub payload: Vec<u8>,
    pub hlc: String,
    pub created_at: i64,
    pub sync_status: SyncOutboxStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TableKind {
    Documents,
    Extracts,
    LearningItems,
    ReviewResults,
    Collections,
    Tags,
    Settings,
    ImageAssets,
    Tombstones,
}

impl TableKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TableKind::Documents => "documents",
            TableKind::Extracts => "extracts",
            TableKind::LearningItems => "learning_items",
            TableKind::ReviewResults => "review_results",
            TableKind::Collections => "collections",
            TableKind::Tags => "tags",
            TableKind::Settings => "settings",
            TableKind::ImageAssets => "image_assets",
            TableKind::Tombstones => "tombstones",
        }
    }
}

impl From<EntityType> for TableKind {
    fn from(value: EntityType) -> Self {
        match value {
            EntityType::LearningItem => TableKind::LearningItems,
            EntityType::ReviewResult => TableKind::ReviewResults,
            EntityType::Document => TableKind::Documents,
            EntityType::Extract => TableKind::Extracts,
            EntityType::Collection => TableKind::Collections,
            EntityType::Tag => TableKind::Tags,
            EntityType::Setting => TableKind::Settings,
            EntityType::ImageAsset => TableKind::ImageAssets,
            EntityType::Tombstone => TableKind::Tombstones,
        }
    }
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
