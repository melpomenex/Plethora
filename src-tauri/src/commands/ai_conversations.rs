//! Canonical Assistant conversation commands (tasks 1.3/1.5).
//!
//! Thin wrappers over `AiConversationRepository`. Every command takes an
//! explicit `ownerProfileId` partition; the TS repository adapter resolves
//! the current profile (account id or local device profile) and never mixes
//! partitions.

use crate::database::ai_conversation_repository::{
    AiConversationRepository, AssistantMessageInput, DraftCheckpointInput, ListOptions,
    StoredConversationRecord, TurnInput, UserMessageInput,
};
use crate::database::{ConversationSummary, Repository};
use crate::error::Result;
use serde_json::Value;
use tauri::State;

fn repository(repo: &Repository) -> AiConversationRepository {
    AiConversationRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn ai_conversation_list(
    owner_profile_id: String,
    include_deleted: Option<bool>,
    limit: Option<i64>,
    search: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<ConversationSummary>> {
    repository(&repo)
        .list_conversations(
            &owner_profile_id,
            &ListOptions {
                include_deleted,
                limit,
                cursor: None,
                search,
            },
        )
        .await
}

#[tauri::command]
pub async fn ai_conversation_get(
    owner_profile_id: String,
    conversation_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<StoredConversationRecord>> {
    repository(&repo)
        .get_conversation(&owner_profile_id, &conversation_id)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_conversation_create(
    owner_profile_id: String,
    conversation_id: Option<String>,
    title: String,
    collection_id: Option<String>,
    context_policy: Option<Value>,
    sync_policy: Option<String>,
    legacy_aliases: Option<Vec<String>>,
    repo: State<'_, Repository>,
) -> Result<ConversationSummary> {
    repository(&repo)
        .create_conversation(
            &owner_profile_id,
            conversation_id.as_deref(),
            &title,
            collection_id.as_deref(),
            context_policy.unwrap_or_else(|| Value::Object(Default::default())),
            sync_policy.as_deref().unwrap_or("device-local"),
            legacy_aliases.unwrap_or_default(),
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_conversation_update_metadata(
    owner_profile_id: String,
    conversation_id: String,
    expected_revision: i64,
    title: Option<String>,
    collection_id: Option<String>,
    clear_collection: Option<bool>,
    context_policy: Option<Value>,
    sync_policy: Option<String>,
    active_attachments: Option<Value>,
    source_history: Option<Value>,
    repo: State<'_, Repository>,
) -> Result<ConversationSummary> {
    let collection_update = if clear_collection.unwrap_or(false) {
        Some(None)
    } else {
        collection_id.as_deref().map(Some)
    };
    repository(&repo)
        .update_metadata(
            &owner_profile_id,
            &conversation_id,
            expected_revision,
            title.as_deref(),
            collection_update,
            context_policy,
            sync_policy.as_deref(),
            active_attachments,
            source_history,
        )
        .await
}

#[tauri::command]
pub async fn ai_conversation_delete(
    owner_profile_id: String,
    conversation_id: String,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<i64> {
    repository(&repo)
        .delete_conversation(&owner_profile_id, &conversation_id, expected_revision)
        .await
}

#[tauri::command]
pub async fn ai_conversation_commit_draft(
    owner_profile_id: String,
    conversation_id: String,
    device_id: String,
    text: String,
    payload: Option<Value>,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<i64> {
    repository(&repo)
        .commit_draft(
            &owner_profile_id,
            &conversation_id,
            &device_id,
            &text,
            payload.unwrap_or_else(|| Value::Object(Default::default())),
            expected_revision,
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_conversation_append_turn(
    owner_profile_id: String,
    conversation_id: String,
    expected_revision: i64,
    message_id: String,
    message_content: String,
    message_order_key: String,
    message_created_at_ms: i64,
    message_payload: Option<Value>,
    turn_id: String,
    attempt_id: Option<String>,
    parent_turn_id: Option<String>,
    request_plan: Value,
    turn_created_at_ms: i64,
    draft_device_id: Option<String>,
    draft_text: Option<String>,
    draft_payload: Option<Value>,
    repo: State<'_, Repository>,
) -> Result<i64> {
    let draft = draft_device_id.map(|device_id| DraftCheckpointInput {
        device_id,
        text: draft_text.unwrap_or_default(),
        payload: draft_payload.unwrap_or_else(|| Value::Object(Default::default())),
    });
    repository(&repo)
        .append_turn(
            &owner_profile_id,
            &conversation_id,
            expected_revision,
            UserMessageInput {
                id: message_id,
                role: "user".to_string(),
                content: message_content,
                order_key: message_order_key,
                created_at_ms: message_created_at_ms,
                payload: message_payload,
            },
            TurnInput {
                id: turn_id,
                attempt_id,
                parent_turn_id,
                request_plan,
                created_at_ms: turn_created_at_ms,
            },
            draft,
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_conversation_finalize_attempt(
    owner_profile_id: String,
    conversation_id: String,
    turn_id: String,
    attempt_id: String,
    status: String,
    assistant_message_id: Option<String>,
    assistant_content: Option<String>,
    assistant_order_key: Option<String>,
    assistant_created_at_ms: Option<i64>,
    assistant_thinking: Option<String>,
    assistant_evidence: Option<Value>,
    assistant_payload: Option<Value>,
    assistant_sources: Option<Vec<Value>>,
    failure_reason: Option<String>,
    detached: Option<bool>,
    provider: Option<Value>,
    repo: State<'_, Repository>,
) -> Result<()> {
    let assistant_message = assistant_message_id.map(|id| AssistantMessageInput {
        id,
        content: assistant_content.unwrap_or_default(),
        order_key: assistant_order_key.unwrap_or_default(),
        created_at_ms: assistant_created_at_ms.unwrap_or_default(),
        thinking: assistant_thinking,
        evidence: assistant_evidence,
        payload: assistant_payload,
        source_snapshot: assistant_sources,
    });
    repository(&repo)
        .finalize_attempt(
            &owner_profile_id,
            &conversation_id,
            &turn_id,
            &attempt_id,
            &status,
            assistant_message,
            failure_reason.as_deref(),
            detached.unwrap_or(false),
            provider,
        )
        .await
}

#[tauri::command]
pub async fn ai_conversation_append_attempt(
    owner_profile_id: String,
    conversation_id: String,
    turn_id: String,
    attempt_id: String,
    request_plan: Value,
    started_at_ms: i64,
    repo: State<'_, Repository>,
) -> Result<()> {
    repository(&repo)
        .append_attempt(
            &owner_profile_id,
            &conversation_id,
            &turn_id,
            &attempt_id,
            request_plan,
            started_at_ms,
        )
        .await
}

#[tauri::command]
pub async fn ai_conversation_replace_sources(
    owner_profile_id: String,
    conversation_id: String,
    sources: Vec<Value>,
    repo: State<'_, Repository>,
) -> Result<()> {
    repository(&repo)
        .replace_sources(&owner_profile_id, &conversation_id, sources)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_conversation_journal_import(
    owner_profile_id: String,
    origin: String,
    record_key: String,
    record_digest: String,
    assigned_conversation_id: Option<String>,
    status: String,
    reason: Option<String>,
    raw: Option<Value>,
    repo: State<'_, Repository>,
) -> Result<bool> {
    repository(&repo)
        .journal_import(
            &owner_profile_id,
            &origin,
            &record_key,
            &record_digest,
            assigned_conversation_id.as_deref(),
            &status,
            reason.as_deref(),
            raw.as_ref(),
        )
        .await
}

#[tauri::command]
pub async fn ai_conversation_list_import_journal(
    owner_profile_id: String,
    status: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<Value>> {
    let entries = repository(&repo)
        .list_import_journal(&owner_profile_id, status.as_deref())
        .await?;
    Ok(entries
        .into_iter()
        .map(|(entry, raw)| {
            let mut value = serde_json::to_value(&entry).unwrap_or(Value::Null);
            if let Value::Object(map) = &mut value {
                if let Some(raw) = raw {
                    map.insert("raw".into(), raw);
                }
            }
            value
        })
        .collect())
}
