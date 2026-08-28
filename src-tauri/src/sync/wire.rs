use base64::Engine;
use serde::{Deserialize, Serialize};

use super::outbox::OutboxEntry;
use super::types::{EntityType, SyncOperation, TableKind};

pub const MAX_PUSH_RECORDS: usize = 500;
pub const MAX_PUSH_BYTES: usize = 5 * 1024 * 1024;
pub const SYNC_PROTOCOL_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireSyncRecord {
    pub table_kind: String,
    pub record_id: String,
    pub hlc: String,
    pub device_id: String,
    pub payload_ciphertext: String,
    pub aad: String,
    #[serde(default = "default_key_version")]
    pub key_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<i64>,
}

fn default_key_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequestBody {
    pub records: Vec<WireSyncRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResponseBody {
    pub accepted: usize,
    pub latest_seq: u64,
    #[serde(default)]
    pub conflicts: Vec<WireConflict>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireConflict {
    pub change_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub server_revision: i64,
    pub base_revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResponseBody {
    pub records: Vec<WireSyncRecord>,
    pub cursor: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct RemoteSyncRecord {
    pub table_kind: TableKind,
    pub entity_type: EntityType,
    pub record_id: String,
    pub hlc: String,
    pub device_id: String,
    pub payload: Vec<u8>,
    pub operation: Option<SyncOperation>,
    pub base_revision: Option<i64>,
    pub seq_number: u64,
}

pub fn table_kind_for_entity(entity_type: EntityType) -> TableKind {
    entity_type.into()
}

pub fn entity_type_for_table_kind(table_kind: &str) -> Option<EntityType> {
    match table_kind {
        "learning_items" | "learning_item" => Some(EntityType::LearningItem),
        "review_results" | "review_result" => Some(EntityType::ReviewResult),
        _ => EntityType::parse(table_kind),
    }
}

/// MVP transport envelope: JSON metadata + base64 payload bytes (TLS protects on wire; E2EE in Phase 4).
pub fn outbox_entry_to_wire(entry: &OutboxEntry, device_id: &str) -> WireSyncRecord {
    let table_kind = table_kind_for_entity(entry.entity_type);
    let envelope = serde_json::json!({
        "schema_version": 1,
        "change_id": entry.change_id,
        "entity_type": entry.entity_type.as_str(),
        "entity_id": entry.entity_id,
        "operation": entry.operation.as_str(),
        "base_revision": entry.base_revision,
        "payload_b64": base64::engine::general_purpose::STANDARD.encode(&entry.payload),
    });
    let payload_ciphertext =
        base64::engine::general_purpose::STANDARD.encode(envelope.to_string().as_bytes());
    let aad = format!(
        "{}:{}:{}",
        entry.entity_type.as_str(),
        entry.entity_id,
        entry.hlc
    );

    WireSyncRecord {
        table_kind: table_kind.as_str().to_string(),
        record_id: entry.entity_id.clone(),
        hlc: entry.hlc.clone(),
        device_id: device_id.to_string(),
        payload_ciphertext,
        aad,
        key_version: 1,
        change_id: Some(entry.change_id.clone()),
        operation: Some(entry.operation.as_str().to_string()),
        base_revision: entry.base_revision,
    }
}

pub fn decode_remote_record(wire: &WireSyncRecord, seq_number: u64) -> Result<RemoteSyncRecord, String> {
    let entity_type = entity_type_for_table_kind(&wire.table_kind)
        .ok_or_else(|| format!("Unsupported table kind {}", wire.table_kind))?;
    let envelope_bytes = base64::engine::general_purpose::STANDARD
        .decode(wire.payload_ciphertext.as_bytes())
        .map_err(|e| format!("Invalid payload ciphertext: {e}"))?;
    let envelope: serde_json::Value = serde_json::from_slice(&envelope_bytes)
        .map_err(|e| format!("Invalid payload envelope JSON: {e}"))?;
    let payload_b64 = envelope
        .get("payload_b64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing payload_b64 in envelope".to_string())?;
    let payload = base64::engine::general_purpose::STANDARD
        .decode(payload_b64.as_bytes())
        .map_err(|e| format!("Invalid payload_b64: {e}"))?;

    let operation = envelope
        .get("operation")
        .and_then(|v| v.as_str())
        .and_then(parse_operation)
        .or_else(|| wire.operation.as_deref().and_then(parse_operation_str));

    Ok(RemoteSyncRecord {
        table_kind: entity_type.into(),
        entity_type,
        record_id: wire.record_id.clone(),
        hlc: wire.hlc.clone(),
        device_id: wire.device_id.clone(),
        payload,
        operation,
        base_revision: envelope
            .get("base_revision")
            .and_then(|v| v.as_i64())
            .or(wire.base_revision),
        seq_number,
    })
}

fn parse_operation_str(value: &str) -> Option<SyncOperation> {
    parse_operation(value)
}

fn parse_operation(value: &str) -> Option<SyncOperation> {
    match value {
        "create" => Some(SyncOperation::Create),
        "update" => Some(SyncOperation::Update),
        "delete" => Some(SyncOperation::Delete),
        "append_event" => Some(SyncOperation::AppendEvent),
        _ => None,
    }
}

pub fn batch_byte_size(records: &[WireSyncRecord]) -> usize {
    records
        .iter()
        .map(|record| {
            record.payload_ciphertext.len()
                + record.aad.len()
                + record.hlc.len()
                + record.record_id.len()
                + 128
        })
        .sum()
}
