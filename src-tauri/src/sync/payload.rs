use crate::models::LearningItem;
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
        session_id,
    };
    serde_json::to_vec(&payload)
}
