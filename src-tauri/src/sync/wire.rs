use base64::Engine;
use serde::{Deserialize, Serialize};

use super::crypto::SyncCrypto;
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
    pub key_epoch: u32,
}

pub fn table_kind_for_entity(entity_type: EntityType) -> TableKind {
    entity_type.into()
}

pub fn entity_type_for_table_kind(table_kind: &str) -> Option<EntityType> {
    match table_kind {
        "learning_items" | "learning_item" => Some(EntityType::LearningItem),
        "review_results" | "review_result" => Some(EntityType::ReviewResult),
        "documents" | "document" => Some(EntityType::Document),
        "extracts" | "extract" => Some(EntityType::Extract),
        "collections" | "collection" => Some(EntityType::Collection),
        "tags" | "tag" => Some(EntityType::Tag),
        "settings" | "setting" => Some(EntityType::Setting),
        "tombstones" | "tombstone" => Some(EntityType::Tombstone),
        _ => EntityType::parse(table_kind),
    }
}

pub fn outbox_entry_to_wire(
    entry: &OutboxEntry,
    device_id: &str,
    account_id: &str,
    master_key: Option<&[u8; 32]>,
    key_epoch: u32,
) -> Result<WireSyncRecord, String> {
    let table_kind = table_kind_for_entity(entry.entity_type);
    let aad = SyncCrypto::build_aad(
        account_id,
        entry.entity_type.as_str(),
        &entry.entity_id,
        &entry.change_id,
        key_epoch,
    );

    let payload_ciphertext = if let Some(master) = master_key {
        let record_key = SyncCrypto::derive_record_key(
            master,
            key_epoch,
            entry.entity_type.as_str(),
            &entry.entity_id,
            &entry.change_id,
        );
        SyncCrypto::encrypt_payload(&record_key, &entry.payload, &aad)?
    } else {
        let envelope = serde_json::json!({
            "schema_version": 1,
            "change_id": entry.change_id,
            "entity_type": entry.entity_type.as_str(),
            "entity_id": entry.entity_id,
            "operation": entry.operation.as_str(),
            "base_revision": entry.base_revision,
            "payload_b64": base64::engine::general_purpose::STANDARD.encode(&entry.payload),
            "key_epoch": key_epoch,
        });
        base64::engine::general_purpose::STANDARD.encode(envelope.to_string().as_bytes())
    };

    Ok(WireSyncRecord {
        table_kind: table_kind.as_str().to_string(),
        record_id: entry.entity_id.clone(),
        hlc: entry.hlc.clone(),
        device_id: device_id.to_string(),
        payload_ciphertext,
        aad,
        key_version: key_epoch,
        change_id: Some(entry.change_id.clone()),
        operation: Some(entry.operation.as_str().to_string()),
        base_revision: entry.base_revision,
    })
}

pub fn decode_remote_record(
    wire: &WireSyncRecord,
    seq_number: u64,
    account_id: &str,
    master_key: Option<&[u8; 32]>,
    local_epoch: u32,
) -> Result<RemoteSyncRecord, String> {
    if wire.key_version < local_epoch {
        return Err(format!(
            "Rejected stale key epoch {} (local {local_epoch})",
            wire.key_version
        ));
    }

    let entity_type = entity_type_for_table_kind(&wire.table_kind)
        .ok_or_else(|| format!("Unsupported table kind {}", wire.table_kind))?;

    let change_id = wire.change_id.clone().unwrap_or_else(|| wire.record_id.clone());
    let aad = if wire.aad.contains(':') {
        wire.aad.clone()
    } else {
        SyncCrypto::build_aad(
            account_id,
            entity_type.as_str(),
            &wire.record_id,
            &change_id,
            wire.key_version,
        )
    };

    let (payload, operation) = if let Some(master) = master_key {
        let record_key = SyncCrypto::derive_record_key(
            master,
            wire.key_version,
            entity_type.as_str(),
            &wire.record_id,
            &change_id,
        );
        let bytes = SyncCrypto::decrypt_payload(&record_key, &wire.payload_ciphertext, &aad)?;
        let op = wire.operation.as_deref().and_then(parse_operation);
        (bytes, op)
    } else {
        let envelope_bytes = base64::engine::general_purpose::STANDARD
            .decode(wire.payload_ciphertext.as_bytes())
            .map_err(|e| format!("Invalid payload ciphertext: {e}"))?;
        let envelope: serde_json::Value = serde_json::from_slice(&envelope_bytes)
            .map_err(|e| format!("Invalid payload envelope JSON: {e}"))?;
        let payload_b64 = envelope
            .get("payload_b64")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing payload_b64 in envelope".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload_b64.as_bytes())
            .map_err(|e| format!("Invalid payload_b64: {e}"))?;
        let op = envelope
            .get("operation")
            .and_then(|v| v.as_str())
            .and_then(parse_operation)
            .or_else(|| wire.operation.as_deref().and_then(parse_operation));
        (bytes, op)
    };

    Ok(RemoteSyncRecord {
        table_kind: entity_type.into(),
        entity_type,
        record_id: wire.record_id.clone(),
        hlc: wire.hlc.clone(),
        device_id: wire.device_id.clone(),
        payload,
        operation,
        base_revision: wire.base_revision,
        seq_number,
        key_epoch: wire.key_version,
    })
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
