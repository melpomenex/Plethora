use crate::models::collection::Collection;
use crate::models::tag::Tag;
use crate::models::{Document, Extract, LearningItem};
use chrono::{DateTime, Utc};
use serde::Serialize;

fn versioned_entity_payload<T: Serialize>(
    entity_type: &str,
    value: &T,
    sync_fields: &[&str],
) -> Result<Vec<u8>, serde_json::Error> {
    let mut object = match serde_json::to_value(value)? {
        serde_json::Value::Object(object) => object,
        _ => serde_json::Map::new(),
    };
    object.insert("schema_version".into(), serde_json::Value::from(2_u64));
    object.insert(
        "entity_type".into(),
        serde_json::Value::String(entity_type.to_string()),
    );
    object.insert(
        "sync_fields".into(),
        serde_json::Value::Array(
            sync_fields
                .iter()
                .map(|field| serde_json::Value::String((*field).to_string()))
                .collect(),
        ),
    );
    serde_json::to_vec(&serde_json::Value::Object(object))
}

pub fn learning_item_payload(item: &LearningItem) -> Result<Vec<u8>, serde_json::Error> {
    learning_item_payload_with_fields(item, &["*"])
}

pub fn learning_item_payload_with_fields(
    item: &LearningItem,
    fields: &[&str],
) -> Result<Vec<u8>, serde_json::Error> {
    versioned_entity_payload("learning_item", item, fields)
}

#[derive(Serialize)]
struct ReviewResultSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    item_id: &'a str,
    collection_id: &'a str,
    rating: i32,
    time_taken: i32,
    new_due_date: String,
    new_interval: f64,
    new_ease_factor: f64,
    reviewed_at_ms: i64,
    device_id: &'a str,
    session_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    post_item: Option<&'a LearningItem>,
}

pub fn review_result_payload(
    id: &str,
    item_id: &str,
    collection_id: &str,
    rating: i32,
    time_taken: i32,
    new_due_date: &chrono::DateTime<chrono::Utc>,
    new_interval: f64,
    new_ease_factor: f64,
    reviewed_at_ms: i64,
    device_id: &str,
    session_id: Option<&str>,
) -> Result<Vec<u8>, serde_json::Error> {
    review_result_payload_with_item(
        id,
        item_id,
        collection_id,
        rating,
        time_taken,
        new_due_date,
        new_interval,
        new_ease_factor,
        reviewed_at_ms,
        device_id,
        session_id,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn review_result_payload_with_item(
    id: &str,
    item_id: &str,
    collection_id: &str,
    rating: i32,
    time_taken: i32,
    new_due_date: &chrono::DateTime<chrono::Utc>,
    new_interval: f64,
    new_ease_factor: f64,
    reviewed_at_ms: i64,
    device_id: &str,
    session_id: Option<&str>,
    post_item: Option<&LearningItem>,
) -> Result<Vec<u8>, serde_json::Error> {
    let payload = ReviewResultSyncPayload {
        schema_version: if post_item.is_some() { 2 } else { 1 },
        entity_type: "review_result",
        id,
        item_id,
        collection_id,
        rating,
        time_taken,
        new_due_date: new_due_date.to_rfc3339(),
        new_interval,
        new_ease_factor,
        reviewed_at_ms,
        device_id,
        session_id,
        post_item,
    };
    serde_json::to_vec(&payload)
}

pub fn timestamp_revision(timestamp: DateTime<Utc>) -> i64 {
    timestamp.timestamp_millis()
}

pub fn delete_payload(entity_type: &str, entity_id: &str) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&serde_json::json!({
        "schema_version": 1,
        "entity_type": entity_type,
        "id": entity_id,
        "deleted_at": Utc::now().to_rfc3339(),
    }))
}

pub fn document_payload(document: &Document) -> Result<Vec<u8>, serde_json::Error> {
    // file_path is installation-local and can expose OS usernames/paths. The
    // synchronized document is reconstructed from encrypted metadata/content
    // plus the blob layer, never from another device's filesystem path.
    let mut portable = document.clone();
    let portable_source = url::Url::parse(&portable.file_path)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.to_string());
    portable.file_path = portable_source.unwrap_or_default();
    versioned_entity_payload("document", &portable, &["*"])
}

pub fn document_payload_with_fields(
    document: &Document,
    fields: &[&str],
) -> Result<Vec<u8>, serde_json::Error> {
    let mut portable = document.clone();
    let portable_source = url::Url::parse(&portable.file_path)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.to_string());
    portable.file_path = portable_source.unwrap_or_default();
    versioned_entity_payload("document", &portable, fields)
}

#[derive(Serialize)]
struct DocumentPositionSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    position_json: Option<&'a str>,
    progress_percent: Option<f64>,
    current_page: Option<i32>,
    current_scroll_percent: Option<f64>,
    current_cfi: Option<&'a str>,
    date_modified: String,
}

pub fn document_position_payload(
    document_id: &str,
    position_json: Option<&str>,
    progress_percent: Option<f64>,
    current_page: Option<i32>,
    current_scroll_percent: Option<f64>,
    current_cfi: Option<&str>,
) -> Result<Vec<u8>, serde_json::Error> {
    let payload = DocumentPositionSyncPayload {
        schema_version: 1,
        entity_type: "document",
        id: document_id,
        position_json,
        progress_percent,
        current_page,
        current_scroll_percent,
        current_cfi,
        date_modified: Utc::now().to_rfc3339(),
    };
    serde_json::to_vec(&payload)
}

pub fn extract_payload(extract: &Extract) -> Result<Vec<u8>, serde_json::Error> {
    extract_payload_with_fields(extract, &["*"])
}

pub fn extract_payload_with_fields(
    extract: &Extract,
    fields: &[&str],
) -> Result<Vec<u8>, serde_json::Error> {
    versioned_entity_payload("extract", extract, fields)
}

#[derive(Serialize)]
struct CollectionSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    name: &'a str,
    icon: Option<&'a str>,
    color: Option<&'a str>,
    date_modified: String,
}

pub fn collection_payload(collection: &Collection) -> Result<Vec<u8>, serde_json::Error> {
    let payload = CollectionSyncPayload {
        schema_version: 1,
        entity_type: "collection",
        id: &collection.id,
        name: &collection.name,
        icon: collection.icon.as_deref(),
        color: collection.color.as_deref(),
        date_modified: collection.updated_at.to_rfc3339(),
    };
    serde_json::to_vec(&payload)
}

#[derive(Serialize)]
struct TagSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    name: &'a str,
    prerequisites: &'a [String],
    maturity_threshold: f64,
    date_modified: &'a str,
}

pub fn tag_payload(tag: &Tag) -> Result<Vec<u8>, serde_json::Error> {
    let payload = TagSyncPayload {
        schema_version: 1,
        entity_type: "tag",
        id: &tag.id,
        name: &tag.name,
        prerequisites: &tag.prerequisites,
        maturity_threshold: tag.maturity_threshold,
        date_modified: &tag.date_modified,
    };
    serde_json::to_vec(&payload)
}

#[derive(Serialize)]
struct SettingSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    key: &'a str,
    value: &'a str,
    date_modified: String,
}

pub fn setting_payload(key: &str, value: &str) -> Result<Vec<u8>, serde_json::Error> {
    let payload = SettingSyncPayload {
        schema_version: 1,
        entity_type: "setting",
        key,
        value,
        date_modified: Utc::now().to_rfc3339(),
    };
    serde_json::to_vec(&payload)
}

#[derive(Serialize)]
struct TombstoneSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    target_entity_type: &'a str,
    target_entity_id: &'a str,
    deleted_at: String,
}

pub fn tombstone_payload(
    target_entity_type: &str,
    target_entity_id: &str,
) -> Result<Vec<u8>, serde_json::Error> {
    let payload = TombstoneSyncPayload {
        schema_version: 1,
        entity_type: "tombstone",
        target_entity_type,
        target_entity_id,
        deleted_at: Utc::now().to_rfc3339(),
    };
    serde_json::to_vec(&payload)
}
