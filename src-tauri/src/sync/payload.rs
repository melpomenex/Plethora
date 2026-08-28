use crate::models::collection::Collection;
use crate::models::tag::Tag;
use crate::models::{Document, Extract, LearningItem};
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Serialize)]
struct LearningItemSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    collection_id: &'a str,
    question: &'a str,
    answer: Option<&'a str>,
    due_date: String,
    algorithm_type: &'a str,
    updated_at: Option<String>,
}

pub fn learning_item_payload(item: &LearningItem) -> Result<Vec<u8>, serde_json::Error> {
    let payload = LearningItemSyncPayload {
        schema_version: 1,
        entity_type: "learning_item",
        id: &item.id,
        collection_id: &item.collection_id,
        question: &item.question,
        answer: item.answer.as_deref(),
        due_date: item.due_date.to_rfc3339(),
        algorithm_type: &item.algorithm_type,
        updated_at: item.updated_at.map(|ts| ts.to_rfc3339()),
    };
    serde_json::to_vec(&payload)
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
    let payload = ReviewResultSyncPayload {
        schema_version: 1,
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

#[derive(Serialize)]
struct DocumentSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    collection_id: &'a str,
    title: &'a str,
    category: Option<&'a str>,
    tags: &'a [String],
    position_json: Option<&'a str>,
    progress_percent: Option<f64>,
    current_page: Option<i32>,
    current_scroll_percent: Option<f64>,
    current_cfi: Option<&'a str>,
    is_archived: bool,
    is_favorite: bool,
    is_dismissed: bool,
    date_modified: String,
}

pub fn document_payload(document: &Document) -> Result<Vec<u8>, serde_json::Error> {
    let payload = DocumentSyncPayload {
        schema_version: 1,
        entity_type: "document",
        id: &document.id,
        collection_id: &document.collection_id,
        title: &document.title,
        category: document.category.as_deref(),
        tags: &document.tags,
        position_json: document.position_json.as_deref(),
        progress_percent: document.progress_percent,
        current_page: document.current_page,
        current_scroll_percent: document.current_scroll_percent,
        current_cfi: document.current_cfi.as_deref(),
        is_archived: document.is_archived,
        is_favorite: document.is_favorite,
        is_dismissed: document.is_dismissed,
        date_modified: document.date_modified.to_rfc3339(),
    };
    serde_json::to_vec(&payload)
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

#[derive(Serialize)]
struct ExtractSyncPayload<'a> {
    schema_version: u32,
    entity_type: &'static str,
    id: &'a str,
    collection_id: &'a str,
    document_id: &'a str,
    content: &'a str,
    html_content: Option<&'a str>,
    notes: Option<&'a str>,
    highlight_color: Option<&'a str>,
    tags: &'a [String],
    category: Option<&'a str>,
    selection_context: Option<&'a serde_json::Value>,
    date_modified: String,
}

pub fn extract_payload(extract: &Extract) -> Result<Vec<u8>, serde_json::Error> {
    let payload = ExtractSyncPayload {
        schema_version: 1,
        entity_type: "extract",
        id: &extract.id,
        collection_id: &extract.collection_id,
        document_id: &extract.document_id,
        content: &extract.content,
        html_content: extract.html_content.as_deref(),
        notes: extract.notes.as_deref(),
        highlight_color: extract.highlight_color.as_deref(),
        tags: &extract.tags,
        category: extract.category.as_deref(),
        selection_context: extract.selection_context.as_ref(),
        date_modified: extract.date_modified.to_rfc3339(),
    };
    serde_json::to_vec(&payload)
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
