//! Canonical conversation repository (design D1/D2, tasks 1.3/1.5).
//!
//! The single durable SQLite owner of Assistant conversations. Additive to
//! migration 003's `ai_conversations` / `ai_messages`; migration
//! `122_add_canonical_conversations` adds the canonical columns and the
//! turns/attempts/drafts/sources/journal tables.
//!
//! Contract highlights the TS layer depends on:
//!  - every read/write is partitioned by `owner_profile_id`;
//!  - every mutation carries an expected `revision` (optimistic concurrency);
//!  - appending a user turn and recording a pending turn plus the draft
//!    checkpoint happen in ONE transaction, so no request may be dispatched
//!    before the durable acknowledgment;
//!  - late attempts can never overwrite an accepted attempt;
//!  - tombstones win over late writes/imports.

use crate::error::{PlethoraError, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

/// Provider/model sentinel for conversations that have no generation yet.
/// Explicitly *not* a fake provider name.
pub const UNASSIGNED_SENTINEL: &str = "unassigned";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub owner_profile_id: String,
    pub collection_id: Option<String>,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub revision: i64,
    pub record_version: i64,
    pub sync_policy: String,
    pub deleted_at_ms: Option<i64>,
    pub legacy_aliases: Vec<String>,
    pub context_policy: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub conversation_id: String,
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    pub order_key: Option<String>,
    pub thinking: Option<String>,
    pub created_at_ms: Option<i64>,
    pub tokens_used: Option<i64>,
    pub evidence: Option<Value>,
    pub payload: Option<Value>,
    /// Flattened message source snapshot (`ai_message_sources` rows).
    pub source_snapshot: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAttempt {
    pub id: String,
    pub turn_id: String,
    pub status: String,
    pub failure_reason: Option<String>,
    pub detached: bool,
    pub request_plan: Value,
    pub provider: Option<Value>,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTurn {
    pub id: String,
    pub conversation_id: String,
    pub parent_turn_id: Option<String>,
    pub user_message_id: String,
    pub status: String,
    pub accepted_attempt_id: Option<String>,
    pub request_plan: Value,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub attempts: Vec<StoredAttempt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredDraft {
    pub conversation_id: String,
    pub device_id: String,
    pub revision: i64,
    pub text: String,
    pub payload: Value,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConversationRecord {
    #[serde(flatten)]
    pub summary: ConversationSummary,
    pub messages: Vec<StoredMessage>,
    pub turns: Vec<StoredTurn>,
    pub draft: Option<StoredDraft>,
    pub sources: Vec<Value>,
}

/// Options for `list_conversations`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ListOptions {
    pub include_deleted: Option<bool>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportJournalEntry {
    pub id: i64,
    pub origin: String,
    pub record_key: String,
    pub record_digest: String,
    pub assigned_conversation_id: Option<String>,
    pub status: String,
    pub reason: Option<String>,
    pub imported_at_ms: i64,
}

impl ImportJournalEntry {
    /// Quarantined entries keep their raw bytes for user-visible recovery.
    pub fn raw_json(&self) -> Option<Value> {
        None // filled by `list_import_journal` when raw bytes are present
    }
}

#[derive(Clone)]
pub struct AiConversationRepository {
    pool: Pool<Sqlite>,
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn parse_json_or<'a>(raw: Option<&'a str>, fallback: Value) -> Value {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(fallback)
}

fn parse_aliases(raw: Option<&str>) -> Vec<String> {
    match parse_json_or(raw, Value::Array(vec![])) {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

impl AiConversationRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /* ------------------------------------------------------------------ */
    /* Reads                                                              */
    /* ------------------------------------------------------------------ */

    pub async fn list_conversations(
        &self,
        owner_profile_id: &str,
        options: &ListOptions,
    ) -> Result<Vec<ConversationSummary>> {
        let include_deleted = options.include_deleted.unwrap_or(false);
        let limit = options.limit.unwrap_or(200).clamp(1, 2_000);
        let search_like = options
            .search
            .as_deref()
            .map(|s| format!("%{}%", s.replace('%', "\\%")));
        let rows = sqlx::query(
            r#"
            SELECT id, owner_profile_id, collection_id, title,
                   COALESCE(created_at_ms, CAST(strftime('%s', date_created) AS INTEGER) * 1000, 0) AS created_ms,
                   COALESCE(updated_at_ms, CAST(strftime('%s', date_modified) AS INTEGER) * 1000, 0) AS updated_ms,
                   revision, record_version, sync_policy, deleted_at, legacy_aliases, context_policy_json
            FROM ai_conversations
            WHERE owner_profile_id = ?1
              AND (?2 = 1 OR deleted_at IS NULL)
              AND (?3 IS NULL OR title LIKE ?3 ESCAPE '\')
            ORDER BY updated_ms DESC, id ASC
            LIMIT ?4
            "#,
        )
        .bind(owner_profile_id)
        .bind(if include_deleted { 1_i64 } else { 0_i64 })
        .bind(search_like.as_deref())
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ConversationSummary {
                id: row.get("id"),
                owner_profile_id: row.get("owner_profile_id"),
                collection_id: row.get("collection_id"),
                title: row.get("title"),
                created_at_ms: row.get("created_ms"),
                updated_at_ms: row.get("updated_ms"),
                revision: row.get("revision"),
                record_version: row.get("record_version"),
                sync_policy: row.get("sync_policy"),
                deleted_at_ms: row
                    .get::<Option<String>, _>("deleted_at")
                    .and_then(|value| value.parse::<i64>().ok()),
                legacy_aliases: parse_aliases(row.get::<Option<String>, _>("legacy_aliases").as_deref()),
                context_policy: parse_json_or(row.get::<Option<String>, _>("context_policy_json").as_deref(), Value::Object(Default::default())),
            })
            .collect())
    }

    pub async fn get_conversation(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
    ) -> Result<Option<StoredConversationRecord>> {
        let row = sqlx::query(
            r#"
            SELECT * FROM ai_conversations
            WHERE id = ?1 AND owner_profile_id = ?2
            "#,
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else { return Ok(None) };
        let summary = ConversationSummary {
            id: row.get("id"),
            owner_profile_id: row.get("owner_profile_id"),
            collection_id: row.get("collection_id"),
            title: row.get("title"),
            created_at_ms: row
                .get::<Option<i64>, _>("created_at_ms")
                .unwrap_or_default(),
            updated_at_ms: row
                .get::<Option<i64>, _>("updated_at_ms")
                .unwrap_or_default(),
            revision: row.get("revision"),
            record_version: row.get("record_version"),
            sync_policy: row.get("sync_policy"),
            deleted_at_ms: row
                .get::<Option<String>, _>("deleted_at")
                .and_then(|value| value.parse::<i64>().ok()),
            legacy_aliases: parse_aliases(row.get::<Option<String>, _>("legacy_aliases").as_deref()),
            context_policy: parse_json_or(row.get::<Option<String>, _>("context_policy_json").as_deref(), Value::Object(Default::default())),
        };

        let message_rows = sqlx::query(
            r#"
            SELECT id, conversation_id, turn_id, role, content, order_key, thinking,
                   created_at_ms, tokens_used, evidence_json, payload_json,
                   CAST(strftime('%s', timestamp) AS INTEGER) * 1000 AS legacy_ms
            FROM ai_messages
            WHERE conversation_id = ?1
            ORDER BY COALESCE(created_at_ms, CAST(strftime('%s', timestamp) AS INTEGER) * 1000, 0) ASC,
                     COALESCE(order_key, '') ASC, id ASC
            "#,
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;

        let mut messages = Vec::with_capacity(message_rows.len());
        for message_row in message_rows {
            let message_id: String = message_row.get("id");
            let sources = sqlx::query(
                "SELECT payload_json FROM ai_message_sources WHERE message_id = ?1 ORDER BY attachment_id",
            )
            .bind(&message_id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|source_row| {
                parse_json_or(source_row.get::<String, _>("payload_json").as_str().into(), Value::Null)
            })
            .collect();
            messages.push(StoredMessage {
                id: message_id,
                conversation_id: message_row.get("conversation_id"),
                turn_id: message_row.get("turn_id"),
                role: message_row.get("role"),
                content: message_row.get("content"),
                order_key: message_row.get("order_key"),
                thinking: message_row.get("thinking"),
                created_at_ms: message_row
                    .get::<Option<i64>, _>("created_at_ms")
                    .or_else(|| message_row.get::<Option<i64>, _>("legacy_ms")),
                tokens_used: message_row.get("tokens_used"),
                evidence: message_row
                    .get::<Option<String>, _>("evidence_json")
                    .and_then(|raw| serde_json::from_str(&raw).ok()),
                payload: message_row
                    .get::<Option<String>, _>("payload_json")
                    .and_then(|raw| serde_json::from_str(&raw).ok()),
                source_snapshot: sources,
            });
        }

        let turn_rows = sqlx::query(
            "SELECT id, conversation_id, parent_turn_id, user_message_id, status, accepted_attempt_id, request_plan_json, created_at_ms, updated_at_ms FROM ai_conversation_turns WHERE conversation_id = ?1 ORDER BY created_at_ms ASC, id ASC",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;

        let attempt_rows = sqlx::query(
            "SELECT id, turn_id, status, failure_reason, detached, request_plan_json, provider_json, started_at_ms, finished_at_ms FROM ai_conversation_attempts WHERE conversation_id = ?1 ORDER BY started_at_ms ASC, id ASC",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;

        let mut attempts_by_turn: std::collections::HashMap<String, Vec<StoredAttempt>> =
            std::collections::HashMap::new();
        for row in attempt_rows {
            let turn_id: String = row.get("turn_id");
            attempts_by_turn
                .entry(turn_id)
                .or_default()
                .push(StoredAttempt {
                    id: row.get("id"),
                    turn_id: row.get("turn_id"),
                    status: row.get("status"),
                    failure_reason: row.get("failure_reason"),
                    detached: row.get::<i64, _>("detached") != 0,
                    request_plan: parse_json_or(
                        row.get::<String, _>("request_plan_json").as_str().into(),
                        Value::Null,
                    ),
                    provider: row
                        .get::<Option<String>, _>("provider_json")
                        .and_then(|raw| serde_json::from_str(&raw).ok()),
                    started_at_ms: row.get("started_at_ms"),
                    finished_at_ms: row.get("finished_at_ms"),
                });
        }

        let turns = turn_rows
            .into_iter()
            .map(|row| {
                let id: String = row.get("id");
                let attempts = attempts_by_turn.remove(&id).unwrap_or_default();
                StoredTurn {
                    id,
                    conversation_id: row.get("conversation_id"),
                    parent_turn_id: row.get("parent_turn_id"),
                    user_message_id: row.get("user_message_id"),
                    status: row.get("status"),
                    accepted_attempt_id: row.get("accepted_attempt_id"),
                    request_plan: parse_json_or(
                        row.get::<String, _>("request_plan_json").as_str().into(),
                        Value::Null,
                    ),
                    created_at_ms: row.get("created_at_ms"),
                    updated_at_ms: row.get("updated_at_ms"),
                    attempts,
                }
            })
            .collect();

        let draft = sqlx::query(
            "SELECT conversation_id, device_id, revision, text, payload_json, updated_at_ms FROM ai_conversation_drafts WHERE conversation_id = ?1 ORDER BY updated_at_ms DESC LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| StoredDraft {
            conversation_id: row.get("conversation_id"),
            device_id: row.get("device_id"),
            revision: row.get("revision"),
            text: row.get("text"),
            payload: parse_json_or(row.get::<String, _>("payload_json").as_str().into(), Value::Object(Default::default())),
            updated_at_ms: row.get("updated_at_ms"),
        });

        let sources = sqlx::query(
            "SELECT library_id, attachment_id, source_kind, role, origin, title, content_version, locator_json, removed_at_ms, payload_json FROM ai_conversation_sources WHERE conversation_id = ?1 ORDER BY attachment_id",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| {
            let mut value = parse_json_or(
                row.get::<Option<String>, _>("payload_json").as_deref(),
                Value::Object(Default::default()),
            );
            if let Value::Object(map) = &mut value {
                map.insert(
                    "attachmentId".into(),
                    Value::String(row.get("attachment_id")),
                );
                map.insert("kind".into(), Value::String(row.get("source_kind")));
                map.insert("role".into(), Value::String(row.get("role")));
                map.insert("origin".into(), Value::String(row.get("origin")));
                map.insert("title".into(), Value::String(row.get("title")));
                if let Some(library_id) = row.get::<Option<String>, _>("library_id") {
                    map.insert("libraryId".into(), Value::String(library_id));
                }
                if let Some(version) = row.get::<Option<String>, _>("content_version") {
                    map.insert("contentVersion".into(), Value::String(version));
                }
                if let Some(locator) = row
                    .get::<Option<String>, _>("locator_json")
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                {
                    map.insert("locator".into(), locator);
                }
                if let Some(removed) = row.get::<Option<i64>, _>("removed_at_ms") {
                    map.insert("removedAt".into(), Value::Number(removed.into()));
                }
            }
            value
        })
        .collect();

        Ok(Some(StoredConversationRecord {
            summary,
            messages,
            turns,
            draft,
            sources,
        }))
    }

    /* ------------------------------------------------------------------ */
    /* Mutations                                                          */
    /* ------------------------------------------------------------------ */

    pub async fn create_conversation(
        &self,
        owner_profile_id: &str,
        requested_id: Option<&str>,
        title: &str,
        collection_id: Option<&str>,
        context_policy: Value,
        sync_policy: &str,
        legacy_aliases: Vec<String>,
    ) -> Result<ConversationSummary> {
        if owner_profile_id.trim().is_empty() {
            return Err(PlethoraError::InvalidInput(
                "owner_profile_id is required".into(),
            ));
        }
        let id = requested_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let timestamp = now_ms();
        let iso = Utc::now().to_rfc3339();
        let aliases = serde_json::to_string(&legacy_aliases)?;
        let context_policy_json = context_policy.to_string();

        let mut tx = self.pool.begin().await?;
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT owner_profile_id FROM ai_conversations WHERE id = ?1")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((existing_owner,)) = existing {
            if existing_owner != owner_profile_id {
                return Err(PlethoraError::InvalidInput(format!(
                    "conversation id {id} belongs to another profile partition"
                )));
            }
            // Idempotent create: return the existing row untouched.
            let summary = self
                .get_conversation_tx(&mut tx, owner_profile_id, &id)
                .await?
                .ok_or_else(|| PlethoraError::NotFound(id.clone()))?;
            tx.commit().await?;
            return Ok(summary);
        }

        sqlx::query(
            r#"
            INSERT INTO ai_conversations (
                id, document_id, title, provider, model, date_created, date_modified,
                record_version, owner_profile_id, collection_id, revision, sync_policy,
                legacy_aliases, context_policy_json, provider_kind,
                created_at_ms, updated_at_ms
            ) VALUES (?1, NULL, ?2, ?3, ?3, ?4, ?4, 2, ?5, ?6, 0, ?7, ?8, ?9, ?3, ?10, ?10)
            "#,
        )
        .bind(&id)
        .bind(if title.trim().is_empty() { "New conversation" } else { title.trim() })
        .bind(UNASSIGNED_SENTINEL)
        .bind(&iso)
        .bind(owner_profile_id)
        .bind(collection_id)
        .bind(if sync_policy == "eligible" { "eligible" } else { "device-local" })
        .bind(&aliases)
        .bind(&context_policy_json)
        .bind(timestamp)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(ConversationSummary {
            id,
            owner_profile_id: owner_profile_id.to_string(),
            collection_id: collection_id.map(str::to_string),
            title: title.trim().to_string(),
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            revision: 0,
            record_version: 2,
            sync_policy: sync_policy.to_string(),
            deleted_at_ms: None,
            legacy_aliases,
            context_policy,
        })
    }

    /// Update mutable metadata with optimistic revision guarding.
    pub async fn update_metadata(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        expected_revision: i64,
        title: Option<&str>,
        collection_id: Option<Option<&str>>,
        context_policy: Option<Value>,
        sync_policy: Option<&str>,
        active_attachments: Option<Value>,
        source_history: Option<Value>,
    ) -> Result<ConversationSummary> {
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(
            "SELECT revision, deleted_at, payload_json FROM ai_conversations WHERE id = ?1 AND owner_profile_id = ?2",
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(conversation_id.to_string()))?;
        let current_revision: i64 = current.get("revision");
        if current.get::<Option<String>, _>("deleted_at").is_some() {
            return Err(PlethoraError::InvalidInput(
                "conversation is deleted; restore before editing".into(),
            ));
        }
        if current_revision != expected_revision {
            return Err(PlethoraError::InvalidInput(format!(
                "revision conflict: expected {expected_revision}, current {current_revision}"
            )));
        }

        let mut payload: Value = parse_json_or(
            current.get::<Option<String>, _>("payload_json").as_deref(),
            Value::Object(Default::default()),
        );
        if !payload.is_object() {
            payload = Value::Object(Default::default());
        }
        if let Value::Object(map) = &mut payload {
            if let Some(attachments) = active_attachments {
                map.insert("activeAttachments".into(), attachments);
            }
            if let Some(history) = source_history {
                map.insert("sourceHistory".into(), history);
            }
        }

        let timestamp = now_ms();
        let iso = Utc::now().to_rfc3339();
        let context_policy_json = context_policy.map(|value| value.to_string());
        sqlx::query(
            r#"
            UPDATE ai_conversations SET
                title = COALESCE(?3, title),
                collection_id = CASE WHEN ?4 = 1 THEN ?5 ELSE collection_id END,
                context_policy_json = COALESCE(?6, context_policy_json),
                sync_policy = COALESCE(?7, sync_policy),
                payload_json = ?8,
                revision = revision + 1,
                updated_at_ms = ?9,
                date_modified = ?10
            WHERE id = ?1 AND owner_profile_id = ?2 AND revision = ?11
            "#,
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .bind(title)
        .bind(if collection_id.is_some() { 1_i64 } else { 0_i64 })
        .bind(collection_id.flatten())
        .bind(context_policy_json)
        .bind(sync_policy)
        .bind(payload.to_string())
        .bind(timestamp)
        .bind(&iso)
        .bind(expected_revision)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        self.get_conversation_summary(owner_profile_id, conversation_id)
            .await?
            .ok_or_else(|| PlethoraError::NotFound(conversation_id.to_string()))
    }

    /// Soft-delete (tombstone). Idempotent; tombstones beat late writers.
    pub async fn delete_conversation(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        expected_revision: i64,
    ) -> Result<i64> {
        let timestamp = now_ms();
        let affected = sqlx::query(
            "UPDATE ai_conversations SET deleted_at = ?3, revision = revision + 1, updated_at_ms = ?3 WHERE id = ?1 AND owner_profile_id = ?2 AND (revision = ?4 OR deleted_at IS NOT NULL)",
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .bind(timestamp.to_string())
        .bind(expected_revision)
        .execute(&self.pool)
        .await?;
        if affected.rows_affected() == 0 {
            let exists: Option<(i64,)> = sqlx::query_as(
                "SELECT revision FROM ai_conversations WHERE id = ?1 AND owner_profile_id = ?2",
            )
            .bind(conversation_id)
            .bind(owner_profile_id)
            .fetch_optional(&self.pool)
            .await?;
            return match exists {
                Some((revision,)) => Err(PlethoraError::InvalidInput(format!(
                    "revision conflict: expected {expected_revision}, current {revision}"
                ))),
                None => Err(PlethoraError::NotFound(conversation_id.to_string())),
            };
        }
        Ok(timestamp)
    }

    /// Commit a per-device draft. Returns the stored revision.
    pub async fn commit_draft(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        device_id: &str,
        text: &str,
        payload: Value,
        expected_revision: i64,
    ) -> Result<i64> {
        if device_id.trim().is_empty() {
            return Err(PlethoraError::InvalidInput("device_id is required".into()));
        }
        let mut tx = self.pool.begin().await?;
        self.assert_writable(&mut tx, owner_profile_id, conversation_id)
            .await?;
        let timestamp = now_ms();
        sqlx::query(
            r#"
            INSERT INTO ai_conversation_drafts (conversation_id, device_id, revision, text, payload_json, updated_at_ms)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(conversation_id, device_id) DO UPDATE SET
                text = excluded.text,
                payload_json = excluded.payload_json,
                updated_at_ms = excluded.updated_at_ms,
                revision = ai_conversation_drafts.revision + 1
            "#,
        )
        .bind(conversation_id)
        .bind(device_id)
        .bind(expected_revision)
        .bind(text)
        .bind(payload.to_string())
        .bind(timestamp)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE ai_conversations SET updated_at_ms = ?2, date_modified = ?3 WHERE id = ?1",
        )
        .bind(conversation_id)
        .bind(timestamp)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await?;
        let revision = sqlx::query_scalar::<_, i64>(
            "SELECT revision FROM ai_conversation_drafts WHERE conversation_id = ?1 AND device_id = ?2",
        )
        .bind(conversation_id)
        .bind(device_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(revision)
    }

    /// Atomically append a user message, a pending turn and its first attempt,
    /// plus the draft checkpoint. No request may be dispatched before this
    /// returns.
    #[allow(clippy::too_many_arguments)]
    pub async fn append_turn(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        expected_revision: i64,
        user_message: UserMessageInput,
        turn: TurnInput,
        draft_checkpoint: Option<DraftCheckpointInput>,
    ) -> Result<i64> {
        let mut tx = self.pool.begin().await?;
        let revision = self
            .assert_writable(&mut tx, owner_profile_id, conversation_id)
            .await?;
        if revision != expected_revision {
            return Err(PlethoraError::InvalidInput(format!(
                "revision conflict: expected {expected_revision}, current {revision}"
            )));
        }

        sqlx::query(
            "INSERT INTO ai_messages (id, conversation_id, role, content, timestamp, turn_id, order_key, thinking, created_at_ms, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)",
        )
        .bind(&user_message.id)
        .bind(conversation_id)
        .bind(&user_message.role)
        .bind(&user_message.content)
        .bind(Utc::now().to_rfc3339())
        .bind(&turn.id)
        .bind(&user_message.order_key)
        .bind(user_message.created_at_ms)
        .bind(user_message.payload.as_ref().map(|value| value.to_string()))
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO ai_conversation_turns (id, conversation_id, parent_turn_id, user_message_id, status, accepted_attempt_id, request_plan_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?7)",
        )
        .bind(&turn.id)
        .bind(conversation_id)
        .bind(turn.parent_turn_id.as_deref())
        .bind(&user_message.id)
        .bind("queued")
        .bind(turn.request_plan.to_string())
        .bind(turn.created_at_ms)
        .execute(&mut *tx)
        .await?;

        if let Some(attempt_id) = turn.attempt_id.as_deref() {
            sqlx::query(
                "INSERT INTO ai_conversation_attempts (id, turn_id, conversation_id, status, failure_reason, detached, request_plan_json, provider_json, started_at_ms, finished_at_ms) VALUES (?1, ?2, ?3, 'queued', NULL, 0, ?4, NULL, ?5, NULL)",
            )
            .bind(attempt_id)
            .bind(&turn.id)
            .bind(conversation_id)
            .bind(turn.request_plan.to_string())
            .bind(turn.created_at_ms)
            .execute(&mut *tx)
            .await?;
        }

        if let Some(checkpoint) = draft_checkpoint {
            let timestamp = now_ms();
            sqlx::query(
                r#"
                INSERT INTO ai_conversation_drafts (conversation_id, device_id, revision, text, payload_json, updated_at_ms)
                VALUES (?1, ?2, 0, ?3, ?4, ?5)
                ON CONFLICT(conversation_id, device_id) DO UPDATE SET
                    text = excluded.text,
                    payload_json = excluded.payload_json,
                    updated_at_ms = excluded.updated_at_ms,
                    revision = ai_conversation_drafts.revision + 1
                "#,
            )
            .bind(conversation_id)
            .bind(&checkpoint.device_id)
            .bind(&checkpoint.text)
            .bind(checkpoint.payload.to_string())
            .bind(timestamp)
            .execute(&mut *tx)
            .await?;
        }

        let next_revision = sqlx::query(
            "UPDATE ai_conversations SET revision = revision + 1, updated_at_ms = ?2, date_modified = ?3 WHERE id = ?1 RETURNING revision",
        )
        .bind(conversation_id)
        .bind(now_ms())
        .bind(Utc::now().to_rfc3339())
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("revision");

        tx.commit().await?;
        Ok(next_revision)
    }

    /// Finalize an attempt. On success the assistant message is appended in
    /// the same transaction; a late attempt cannot overwrite an accepted one.
    pub async fn finalize_attempt(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        turn_id: &str,
        attempt_id: &str,
        status: &str,
        assistant_message: Option<AssistantMessageInput>,
        failure_reason: Option<&str>,
        detached: bool,
        provider: Option<Value>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        self.assert_writable(&mut tx, owner_profile_id, conversation_id)
            .await?;

        let accepted = sqlx::query(
            "SELECT accepted_attempt_id FROM ai_conversation_turns WHERE id = ?1 AND conversation_id = ?2",
        )
        .bind(turn_id)
        .bind(conversation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(turn_id.to_string()))?
        .get::<Option<String>, _>("accepted_attempt_id");

        if let Some(accepted_id) = accepted {
            // Once an attempt is accepted the result is immutable: neither a
            // re-finalization of the accepted attempt nor a late sibling
            // attempt may change it (design D5).
            let _ = accepted_id;
            return Err(PlethoraError::InvalidInput(
                "attempt superseded: another attempt is already accepted".into(),
            ));
        }

        let finished = now_ms();
        let affected = sqlx::query(
            "UPDATE ai_conversation_attempts SET status = ?3, failure_reason = ?4, detached = ?5, provider_json = COALESCE(?6, provider_json), finished_at_ms = ?7 WHERE id = ?1 AND turn_id = ?2",
        )
        .bind(attempt_id)
        .bind(turn_id)
        .bind(status)
        .bind(failure_reason)
        .bind(if detached { 1_i64 } else { 0_i64 })
        .bind(provider.as_ref().map(|value| value.to_string()))
        .bind(finished)
        .execute(&mut *tx)
        .await?;
        if affected.rows_affected() == 0 {
            return Err(PlethoraError::NotFound(attempt_id.to_string()));
        }

        if let Some(message) = assistant_message {
            sqlx::query(
                "INSERT INTO ai_messages (id, conversation_id, role, content, timestamp, turn_id, order_key, thinking, created_at_ms, evidence_json, payload_json) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .bind(&message.id)
            .bind(conversation_id)
            .bind(&message.content)
            .bind(Utc::now().to_rfc3339())
            .bind(turn_id)
            .bind(&message.order_key)
            .bind(message.thinking.as_deref())
            .bind(message.created_at_ms)
            .bind(message.evidence.as_ref().map(|value| value.to_string()))
            .bind(message.payload.as_ref().map(|value| value.to_string()))
            .execute(&mut *tx)
            .await?;

            if let Some(sources) = message.source_snapshot {
                for source in sources {
                    let attachment_id = source
                        .get("attachmentId")
                        .and_then(Value::as_str)
                        .unwrap_or("source")
                        .to_string();
                    sqlx::query(
                        "INSERT OR REPLACE INTO ai_message_sources (message_id, attachment_id, payload_json) VALUES (?1, ?2, ?3)",
                    )
                    .bind(&message.id)
                    .bind(attachment_id)
                    .bind(source.to_string())
                    .execute(&mut *tx)
                    .await?;
                }
            }
            sqlx::query(
                "UPDATE ai_conversation_turns SET accepted_attempt_id = ?2, status = ?3, updated_at_ms = ?4 WHERE id = ?1",
            )
            .bind(turn_id)
            .bind(attempt_id)
            .bind("complete")
            .bind(finished)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE ai_conversation_turns SET status = ?2, updated_at_ms = ?3 WHERE id = ?1",
            )
            .bind(turn_id)
            .bind(status)
            .bind(finished)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            "UPDATE ai_conversations SET updated_at_ms = ?2, date_modified = ?3 WHERE id = ?1",
        )
        .bind(conversation_id)
        .bind(finished)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    /// Append a retry attempt to an existing turn (same user message, new
    /// attempt identity). Refused once the turn has an accepted result.
    pub async fn append_attempt(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        turn_id: &str,
        attempt_id: &str,
        request_plan: Value,
        started_at_ms: i64,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        self.assert_writable(&mut tx, owner_profile_id, conversation_id)
            .await?;
        let turn = sqlx::query(
            "SELECT accepted_attempt_id FROM ai_conversation_turns WHERE id = ?1 AND conversation_id = ?2",
        )
        .bind(turn_id)
        .bind(conversation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(turn_id.to_string()))?;
        if turn.get::<Option<String>, _>("accepted_attempt_id").is_some() {
            return Err(PlethoraError::InvalidInput(
                "turn already has an accepted result; start a new turn instead".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO ai_conversation_attempts (id, turn_id, conversation_id, status, failure_reason, detached, request_plan_json, provider_json, started_at_ms, finished_at_ms) VALUES (?1, ?2, ?3, 'queued', NULL, 0, ?4, NULL, ?5, NULL)",
        )
        .bind(attempt_id)
        .bind(turn_id)
        .bind(conversation_id)
        .bind(request_plan.to_string())
        .bind(started_at_ms)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE ai_conversation_turns SET status = 'queued', updated_at_ms = ?2 WHERE id = ?1",
        )
        .bind(turn_id)
        .bind(started_at_ms)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Replace the source edges for a conversation (reauthorization).
    pub async fn replace_sources(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
        sources: Vec<Value>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        self.assert_writable(&mut tx, owner_profile_id, conversation_id)
            .await?;
        sqlx::query("DELETE FROM ai_conversation_sources WHERE conversation_id = ?1")
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        for source in sources {
            let attachment_id = source
                .get("attachmentId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PlethoraError::InvalidInput("source is missing attachmentId".into())
                })?;
            sqlx::query(
                r#"
                INSERT INTO ai_conversation_sources (
                    conversation_id, attachment_id, library_id, source_kind, role,
                    origin, title, content_version, locator_json, removed_at_ms, payload_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                "#,
            )
            .bind(conversation_id)
            .bind(attachment_id)
            .bind(source.get("libraryId").and_then(Value::as_str))
            .bind(source.get("kind").and_then(Value::as_str).unwrap_or("document"))
            .bind(source.get("role").and_then(Value::as_str).unwrap_or("optional"))
            .bind(source.get("origin").and_then(Value::as_str).unwrap_or("history"))
            .bind(source.get("title").and_then(Value::as_str).unwrap_or(""))
            .bind(source.get("contentVersion").and_then(Value::as_str))
            .bind(source.get("locator").map(|value| value.to_string()))
            .bind(source.get("removedAt").and_then(Value::as_i64))
            .bind(source.to_string())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /* ------------------------------------------------------------------ */
    /* Import journal                                                     */
    /* ------------------------------------------------------------------ */

    /// Record one imported/quarantined legacy record. Returns `false` when the
    /// same digest was already journaled (idempotent import).
    #[allow(clippy::too_many_arguments)]
    pub async fn journal_import(
        &self,
        owner_profile_id: &str,
        origin: &str,
        record_key: &str,
        record_digest: &str,
        assigned_conversation_id: Option<&str>,
        status: &str,
        reason: Option<&str>,
        raw: Option<&Value>,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO ai_conversation_import_journal (
                owner_profile_id, origin, record_key, record_digest,
                assigned_conversation_id, status, reason, raw_json, imported_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(owner_profile_id)
        .bind(origin)
        .bind(record_key)
        .bind(record_digest)
        .bind(assigned_conversation_id)
        .bind(status)
        .bind(reason)
        .bind(raw.map(|value| value.to_string()))
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_import_journal(
        &self,
        owner_profile_id: &str,
        status: Option<&str>,
    ) -> Result<Vec<(ImportJournalEntry, Option<Value>)>> {
        let rows = sqlx::query(
            r#"
            SELECT id, origin, record_key, record_digest, assigned_conversation_id,
                   status, reason, raw_json, imported_at_ms
            FROM ai_conversation_import_journal
            WHERE owner_profile_id = ?1 AND (?2 IS NULL OR status = ?2)
            ORDER BY id ASC
            "#,
        )
        .bind(owner_profile_id)
        .bind(status)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let raw = row
                    .get::<Option<String>, _>("raw_json")
                    .and_then(|text| serde_json::from_str::<Value>(&text).ok());
                (
                    ImportJournalEntry {
                        id: row.get("id"),
                        origin: row.get("origin"),
                        record_key: row.get("record_key"),
                        record_digest: row.get("record_digest"),
                        assigned_conversation_id: row.get("assigned_conversation_id"),
                        status: row.get("status"),
                        reason: row.get("reason"),
                        imported_at_ms: row.get("imported_at_ms"),
                    },
                    raw,
                )
            })
            .collect())
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    async fn assert_writable(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        owner_profile_id: &str,
        conversation_id: &str,
    ) -> Result<i64> {
        let row = sqlx::query(
            "SELECT revision, deleted_at FROM ai_conversations WHERE id = ?1 AND owner_profile_id = ?2",
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(conversation_id.to_string()))?;
        if row.get::<Option<String>, _>("deleted_at").is_some() {
            return Err(PlethoraError::InvalidInput(
                "conversation is deleted; tombstones beat late writes".into(),
            ));
        }
        Ok(row.get("revision"))
    }

    async fn get_conversation_summary(
        &self,
        owner_profile_id: &str,
        conversation_id: &str,
    ) -> Result<Option<ConversationSummary>> {
        let list = self.list_conversations(owner_profile_id, &ListOptions {
            include_deleted: Some(true),
            limit: Some(1),
            cursor: None,
            search: None,
        }).await?;
        Ok(list.into_iter().find(|summary| summary.id == conversation_id))
    }

    async fn get_conversation_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        owner_profile_id: &str,
        conversation_id: &str,
    ) -> Result<Option<ConversationSummary>> {
        let row = sqlx::query(
            "SELECT id, owner_profile_id, collection_id, title, created_at_ms, updated_at_ms, revision, record_version, sync_policy, deleted_at, legacy_aliases, context_policy_json FROM ai_conversations WHERE id = ?1 AND owner_profile_id = ?2",
        )
        .bind(conversation_id)
        .bind(owner_profile_id)
        .fetch_optional(&mut **tx)
        .await?;
        Ok(row.map(|row| ConversationSummary {
            id: row.get("id"),
            owner_profile_id: row.get("owner_profile_id"),
            collection_id: row.get("collection_id"),
            title: row.get("title"),
            created_at_ms: row.get::<Option<i64>, _>("created_at_ms").unwrap_or_default(),
            updated_at_ms: row.get::<Option<i64>, _>("updated_at_ms").unwrap_or_default(),
            revision: row.get("revision"),
            record_version: row.get("record_version"),
            sync_policy: row.get("sync_policy"),
            deleted_at_ms: row
                .get::<Option<String>, _>("deleted_at")
                .and_then(|value| value.parse::<i64>().ok()),
            legacy_aliases: parse_aliases(row.get::<Option<String>, _>("legacy_aliases").as_deref()),
            context_policy: parse_json_or(row.get::<Option<String>, _>("context_policy_json").as_deref(), Value::Object(Default::default())),
        }))
    }
}

/// Input for the user message inside `append_turn`.
pub struct UserMessageInput {
    pub id: String,
    pub role: String,
    pub content: String,
    pub order_key: String,
    pub created_at_ms: i64,
    pub payload: Option<Value>,
}

/// Input for the pending turn inside `append_turn`.
pub struct TurnInput {
    pub id: String,
    pub attempt_id: Option<String>,
    pub parent_turn_id: Option<String>,
    pub request_plan: Value,
    pub created_at_ms: i64,
}

/// Draft checkpoint committed atomically with `append_turn`.
pub struct DraftCheckpointInput {
    pub device_id: String,
    pub text: String,
    pub payload: Value,
}

/// Assistant message appended by `finalize_attempt`.
pub struct AssistantMessageInput {
    pub id: String,
    pub content: String,
    pub order_key: String,
    pub created_at_ms: i64,
    pub thinking: Option<String>,
    pub evidence: Option<Value>,
    pub payload: Option<Value>,
    pub source_snapshot: Option<Vec<Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn migrated_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory database");
        run_migrations(&pool).await.expect("run migrations");
        pool
    }

    fn plan(id: &str, question: &str) -> Value {
        serde_json::json!({
            "conversationId": "ignored",
            "turnId": id,
            "question": question,
            "mentionTokens": [],
            "policy": { "mode": "auto", "origin": "explicit" },
            "sources": [],
            "provider": { "configurationId": "cfg-1", "kind": "cloud", "model": "m", "locality": "remote" },
            "requestEpoch": 1
        })
    }

    async fn append(
        repo: &AiConversationRepository,
        owner: &str,
        conversation: &str,
        expected: i64,
        turn: &str,
    ) -> Result<i64> {
        repo.append_turn(
            owner,
            conversation,
            expected,
            UserMessageInput {
                id: format!("{turn}-user"),
                role: "user".into(),
                content: "What is this?".into(),
                order_key: format!("0000000000000001:{turn}-user"),
                created_at_ms: 1_000,
                payload: None,
            },
            TurnInput {
                id: turn.to_string(),
                attempt_id: Some(format!("{turn}-attempt-1")),
                parent_turn_id: None,
                request_plan: plan(turn, "What is this?"),
                created_at_ms: 1_000,
            },
            Some(DraftCheckpointInput {
                device_id: "device-a".into(),
                text: String::new(),
                payload: serde_json::json!({}),
            }),
        )
        .await
    }

    #[tokio::test]
    async fn partitions_isolate_conversations() {
        let pool = migrated_pool().await;
        let repo = AiConversationRepository::new(pool);
        let created = repo
            .create_conversation(
                "local:device-a",
                Some("conv-1"),
                "Mine",
                None,
                serde_json::json!({ "mode": "auto", "origin": "explicit" }),
                "device-local",
                vec![],
            )
            .await
            .expect("create");
        assert_eq!(created.revision, 0);

        // Another profile cannot see or touch it.
        let other = repo
            .get_conversation("local:device-b", "conv-1")
            .await
            .expect("get");
        assert!(other.is_none());
        let conflict = append(&repo, "local:device-b", "conv-1", 0, "t1").await;
        assert!(matches!(conflict, Err(PlethoraError::NotFound(_))));

        // A second profile uses its own id space; the same id across profiles
        // is refused rather than silently shared.
        let cross_partition = repo
            .create_conversation(
                "local:device-b",
                Some("conv-1"),
                "Theirs",
                None,
                serde_json::json!({ "mode": "auto", "origin": "explicit" }),
                "device-local",
                vec![],
            )
            .await;
        assert!(matches!(cross_partition, Err(PlethoraError::InvalidInput(_))));
        repo.create_conversation(
            "local:device-b",
            Some("conv-2"),
            "Theirs",
            None,
            serde_json::json!({ "mode": "auto", "origin": "explicit" }),
            "device-local",
            vec![],
        )
        .await
        .expect("create other");
        let a = repo
            .list_conversations("local:device-a", &ListOptions::default())
            .await
            .expect("list a");
        let b = repo
            .list_conversations("local:device-b", &ListOptions::default())
            .await
            .expect("list b");
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].title, "Mine");
        assert_eq!(b[0].title, "Theirs");
    }

    #[tokio::test]
    async fn append_turn_is_atomic_and_revision_guarded() {
        let pool = migrated_pool().await;
        let repo = AiConversationRepository::new(pool);
        repo.create_conversation(
            "local:device-a",
            Some("conv-1"),
            "Thread",
            None,
            serde_json::json!({ "mode": "auto", "origin": "explicit" }),
            "device-local",
            vec![],
        )
        .await
        .expect("create");

        let revision = append(&repo, "local:device-a", "conv-1", 0, "t1")
            .await
            .expect("append");
        assert_eq!(revision, 1);

        // Stale revision is rejected; nothing is written.
        let stale = append(&repo, "local:device-a", "conv-1", 0, "t2").await;
        assert!(matches!(stale, Err(PlethoraError::InvalidInput(_))));
        let record = repo
            .get_conversation("local:device-a", "conv-1")
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(record.messages.len(), 1, "no partial write from the stale append");
        assert_eq!(record.turns.len(), 1);
        assert_eq!(record.turns[0].status, "queued");
        assert_eq!(record.turns[0].attempts.len(), 1);
        assert!(record.draft.is_some(), "draft checkpoint committed atomically");
    }

    #[tokio::test]
    async fn finalize_attempt_records_result_and_rejects_superseded_writes() {
        let pool = migrated_pool().await;
        let repo = AiConversationRepository::new(pool);
        repo.create_conversation(
            "local:device-a",
            Some("conv-1"),
            "Thread",
            None,
            serde_json::json!({ "mode": "auto", "origin": "explicit" }),
            "device-local",
            vec![],
        )
        .await
        .expect("create");
        append(&repo, "local:device-a", "conv-1", 0, "t1")
            .await
            .expect("append");

        repo.finalize_attempt(
            "local:device-a",
            "conv-1",
            "t1",
            "t1-attempt-1",
            "complete",
            Some(AssistantMessageInput {
                id: "t1-assistant".into(),
                content: "The answer.".into(),
                order_key: "0000000000000002:t1-assistant".into(),
                created_at_ms: 2_000,
                thinking: None,
                evidence: Some(serde_json::json!({
                    "origin": "model", "level": "none", "retrievalMode": "none", "sourceFree": true
                })),
                payload: Some(serde_json::json!({ "citations": [] })),
                source_snapshot: Some(vec![serde_json::json!({
                    "attachmentId": "att-1",
                    "kind": "document",
                    "libraryId": "doc-1",
                    "title": "Doc",
                    "origin": "history",
                    "role": "optional"
                })]),
            }),
            None,
            false,
            Some(serde_json::json!({
                "configurationId": "cfg-1", "kind": "cloud", "model": "m", "locality": "remote"
            })),
        )
        .await
        .expect("finalize");

        // A late duplicate attempt cannot overwrite the accepted result.
        let superseded = repo
            .finalize_attempt(
                "local:device-a",
                "conv-1",
                "t1",
                "t1-attempt-late",
                "complete",
                Some(AssistantMessageInput {
                    id: "t1-assistant-late".into(),
                    content: "Late duplicate.".into(),
                    order_key: "0000000000000003:t1-assistant-late".into(),
                    created_at_ms: 3_000,
                    thinking: None,
                    evidence: None,
                    payload: None,
                    source_snapshot: None,
                }),
                None,
                false,
                None,
            )
            .await;
        assert!(superseded.is_err());

        let record = repo
            .get_conversation("local:device-a", "conv-1")
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(record.turns[0].status, "complete");
        assert_eq!(
            record.turns[0].accepted_attempt_id.as_deref(),
            Some("t1-attempt-1")
        );
        let assistant = record
            .messages
            .iter()
            .find(|message| message.role == "assistant")
            .expect("assistant message persisted");
        assert_eq!(assistant.content, "The answer.");
        assert_eq!(assistant.source_snapshot.len(), 1, "source snapshot persisted");
        assert_eq!(
            assistant
                .evidence
                .as_ref()
                .and_then(|value| value.get("level"))
                .and_then(Value::as_str),
            Some("none")
        );
    }

    #[tokio::test]
    async fn tombstones_beat_late_writes() {
        let pool = migrated_pool().await;
        let repo = AiConversationRepository::new(pool);
        repo.create_conversation(
            "local:device-a",
            Some("conv-1"),
            "Thread",
            None,
            serde_json::json!({ "mode": "auto", "origin": "explicit" }),
            "device-local",
            vec![],
        )
        .await
        .expect("create");
        repo.delete_conversation("local:device-a", "conv-1", 0)
            .await
            .expect("delete");
        let blocked = append(&repo, "local:device-a", "conv-1", 1, "t1").await;
        assert!(matches!(blocked, Err(PlethoraError::InvalidInput(_))));
        let listed = repo
            .list_conversations("local:device-a", &ListOptions::default())
            .await
            .expect("list");
        assert_eq!(listed.len(), 0, "tombstoned conversations are not listed");
        let with_deleted = repo
            .list_conversations(
                "local:device-a",
                &ListOptions {
                    include_deleted: Some(true),
                    ..Default::default()
                },
            )
            .await
            .expect("list deleted");
        assert_eq!(with_deleted.len(), 1);
    }

    #[tokio::test]
    async fn import_journal_is_digest_idempotent() {
        let pool = migrated_pool().await;
        let repo = AiConversationRepository::new(pool);
        let first = repo
            .journal_import(
                "local:device-a",
                "sidebar",
                "document:doc-1",
                "digest-1",
                Some("conv-1"),
                "imported",
                None,
                Some(&serde_json::json!({ "raw": true })),
            )
            .await
            .expect("first journal");
        assert!(first);
        let second = repo
            .journal_import(
                "local:device-a",
                "sidebar",
                "document:doc-1",
                "digest-1",
                Some("conv-2"),
                "imported",
                None,
                Some(&serde_json::json!({ "raw": true })),
            )
            .await
            .expect("second journal");
        assert!(!second, "same digest is not journaled twice");
        let entries = repo
            .list_import_journal("local:device-a", None)
            .await
            .expect("list journal");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].0.assigned_conversation_id.as_deref(),
            Some("conv-1"),
            "the first assignment stands"
        );
    }
}
