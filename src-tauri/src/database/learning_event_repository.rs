//! Repository for the unified append-only learning event spine (Phase 1A).
//!
//! Matches `openspec/changes/unify-learning-state-and-events/design.md` and
//! migration `168_unify_learning_state_events`.

use crate::error::{PlethoraError, Result};
use crate::models::learning_event::{
    validate_learning_event_input, AppendLearningEventInput, AppendLearningEventResult,
    LearningEvent, LearningEventCheckpoint, LearningEventFilter, LearningEventType,
    LEARNING_EVENT_SCHEMA_VERSION,
};
use chrono::Utc;
use sqlx::{Pool, QueryBuilder, Row, Sqlite, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct LearningEventRepository {
    pool: Pool<Sqlite>,
}

impl LearningEventRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_event(row: &sqlx::sqlite::SqliteRow) -> Result<LearningEvent> {
        let event_type_str: String = row.try_get("event_type")?;
        let payload_json: String = row.try_get("payload_json")?;
        let payload = serde_json::from_str(&payload_json)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));

        Ok(LearningEvent {
            seq: row.try_get("seq")?,
            id: row.try_get("id")?,
            idempotency_key: row.try_get("idempotency_key")?,
            schema_version: row.try_get("schema_version")?,
            event_type: LearningEventType::from_db_str(&event_type_str)?,
            actor: row.try_get("actor")?,
            surface: row.try_get("surface")?,
            session_id: row.try_get("session_id")?,
            goal_id: row.try_get("goal_id")?,
            entity_kind: row.try_get("entity_kind")?,
            entity_id: row.try_get("entity_id")?,
            document_id: row.try_get("document_id")?,
            is_local_only: row.try_get::<i64, _>("is_local_only")? != 0,
            is_ai_excluded: row.try_get::<i64, _>("is_ai_excluded")? != 0,
            payload,
            occurred_at: row.try_get("occurred_at")?,
            created_at: row.try_get("created_at")?,
            retracted_by_event_id: row.try_get("retracted_by_event_id")?,
        })
    }

    /// Transactional append with deterministic idempotency deduplication,
    /// document privacy inheritance, and Health Vault hard boundary validation.
    pub async fn append_learning_event_tx(
        tx: &mut Transaction<'_, Sqlite>,
        input: &AppendLearningEventInput,
    ) -> Result<AppendLearningEventResult> {
        validate_learning_event_input(input)?;

        let mut is_local_only = input.is_local_only.unwrap_or(false);
        let mut is_ai_excluded = input.is_ai_excluded.unwrap_or(false);

        let effective_doc_id = input.document_id.as_deref().or_else(|| {
            if input.entity_kind == "document" {
                Some(input.entity_id.as_str())
            } else {
                None
            }
        });

        if let Some(doc_id) = effective_doc_id {
            if let Some(doc_row) = sqlx::query(
                "SELECT is_local_only, is_ai_excluded FROM documents WHERE id = ?1",
            )
            .bind(doc_id)
            .fetch_optional(&mut **tx)
            .await?
            {
                let doc_local: i64 = doc_row.try_get("is_local_only").unwrap_or(0);
                let doc_ai_excl: i64 = doc_row.try_get("is_ai_excluded").unwrap_or(0);
                is_local_only = is_local_only || doc_local != 0;
                is_ai_excluded = is_ai_excluded || doc_ai_excl != 0;
            }
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let occurred_at = input
            .occurred_at
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| now.clone());
        let actor = input
            .actor
            .clone()
            .unwrap_or_else(|| "user".to_string());
        let payload_json = serde_json::to_string(&input.payload)?;
        let document_id = effective_doc_id.map(|s| s.to_string());

        let result = sqlx::query(
            "INSERT INTO learning_events (
                id, idempotency_key, schema_version, event_type, actor, surface,
                session_id, goal_id, entity_kind, entity_id, document_id,
                is_local_only, is_ai_excluded, payload_json, occurred_at, created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, ?16
            ) ON CONFLICT(idempotency_key) DO NOTHING",
        )
        .bind(&id)
        .bind(&input.idempotency_key)
        .bind(LEARNING_EVENT_SCHEMA_VERSION)
        .bind(input.event_type.as_str())
        .bind(&actor)
        .bind(&input.surface)
        .bind(&input.session_id)
        .bind(&input.goal_id)
        .bind(&input.entity_kind)
        .bind(&input.entity_id)
        .bind(&document_id)
        .bind(if is_local_only { 1_i64 } else { 0_i64 })
        .bind(if is_ai_excluded { 1_i64 } else { 0_i64 })
        .bind(&payload_json)
        .bind(&occurred_at)
        .bind(&now)
        .execute(&mut **tx)
        .await?;

        let inserted = result.rows_affected() > 0;

        if inserted {
            if let Some(ref target_event_id) = input.retracts_event_id {
                sqlx::query(
                    "UPDATE learning_events
                     SET retracted_by_event_id = ?1
                     WHERE id = ?2 AND retracted_by_event_id IS NULL",
                )
                .bind(&id)
                .bind(target_event_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        let row = sqlx::query(
            "SELECT seq, id, idempotency_key, schema_version, event_type, actor, surface,
                    session_id, goal_id, entity_kind, entity_id, document_id,
                    is_local_only, is_ai_excluded, payload_json, occurred_at, created_at,
                    retracted_by_event_id
             FROM learning_events
             WHERE idempotency_key = ?1",
        )
        .bind(&input.idempotency_key)
        .fetch_one(&mut **tx)
        .await?;

        let event = Self::row_to_event(&row)?;
        if inserted && !event.is_local_only && event.actor != "sync" {
            let sync_payload = serde_json::to_vec(&event).map_err(|e| {
                PlethoraError::Internal(format!("LearningEvent sync payload encode failed: {e}"))
            })?;
            crate::sync::journal::journal_entity(
                tx,
                crate::sync::types::EntityType::LearningEvent,
                &event.id,
                crate::sync::types::SyncOperation::AppendEvent,
                None,
                sync_payload,
            )
            .await?;
        }
        Ok(AppendLearningEventResult { event, inserted })
    }

    pub async fn append_learning_event(
        &self,
        input: &AppendLearningEventInput,
    ) -> Result<AppendLearningEventResult> {
        let mut tx = self.pool.begin().await?;
        let res = Self::append_learning_event_tx(&mut tx, input).await?;
        tx.commit().await?;
        Ok(res)
    }

    /// Appends a compensating event and atomically marks `target_event_id` as retracted.
    pub async fn retract_learning_event(
        &self,
        target_event_id: &str,
        input: &AppendLearningEventInput,
    ) -> Result<AppendLearningEventResult> {
        let mut tx = self.pool.begin().await?;

        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM learning_events WHERE id = ?1")
                .bind(target_event_id)
                .fetch_optional(&mut *tx)
                .await?;
        if exists.is_none() {
            return Err(PlethoraError::NotFound(format!(
                "Learning event '{}' not found",
                target_event_id
            )));
        }

        let mut merged = input.clone();
        merged.retracts_event_id = Some(target_event_id.to_string());

        let res = Self::append_learning_event_tx(&mut tx, &merged).await?;
        tx.commit().await?;
        Ok(res)
    }

    pub async fn list_learning_events(
        &self,
        filter: &LearningEventFilter,
    ) -> Result<Vec<LearningEvent>> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
            "SELECT seq, id, idempotency_key, schema_version, event_type, actor, surface,
                    session_id, goal_id, entity_kind, entity_id, document_id,
                    is_local_only, is_ai_excluded, payload_json, occurred_at, created_at,
                    retracted_by_event_id
             FROM learning_events WHERE 1 = 1",
        );

        if let Some(ref types) = filter.event_types {
            if !types.is_empty() {
                qb.push(" AND event_type IN (");
                let mut sep = qb.separated(", ");
                for t in types {
                    sep.push_bind(t.as_str());
                }
                qb.push(")");
            }
        }

        if let Some(ref surfaces) = filter.surfaces {
            if !surfaces.is_empty() {
                qb.push(" AND surface IN (");
                let mut sep = qb.separated(", ");
                for s in surfaces {
                    sep.push_bind(s.as_str());
                }
                qb.push(")");
            }
        }

        if let Some(ref entity_kind) = filter.entity_kind {
            qb.push(" AND entity_kind = ").push_bind(entity_kind);
        }
        if let Some(ref entity_id) = filter.entity_id {
            qb.push(" AND entity_id = ").push_bind(entity_id);
        }
        if let Some(ref document_id) = filter.document_id {
            qb.push(" AND document_id = ").push_bind(document_id);
        }
        if let Some(ref session_id) = filter.session_id {
            qb.push(" AND session_id = ").push_bind(session_id);
        }
        if let Some(ref goal_id) = filter.goal_id {
            qb.push(" AND goal_id = ").push_bind(goal_id);
        }
        if let Some(since_seq) = filter.since_seq {
            qb.push(" AND seq > ").push_bind(since_seq);
        }
        if !filter.include_retracted.unwrap_or(false) {
            qb.push(" AND retracted_by_event_id IS NULL");
        }
        if filter.exclude_ai_excluded.unwrap_or(false) {
            qb.push(" AND is_ai_excluded = 0");
        }

        qb.push(" ORDER BY seq ASC");

        if let Some(limit) = filter.limit {
            qb.push(" LIMIT ").push_bind(limit.max(0));
        }

        let rows = qb.build().fetch_all(&self.pool).await?;
        rows.iter().map(Self::row_to_event).collect()
    }

    pub async fn get_checkpoint(
        &self,
        consumer_id: &str,
    ) -> Result<Option<LearningEventCheckpoint>> {
        let row = sqlx::query(
            "SELECT consumer_id, last_seq, policy_version, updated_at
             FROM learning_event_checkpoints
             WHERE consumer_id = ?1",
        )
        .bind(consumer_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(match row {
            Some(r) => Some(LearningEventCheckpoint {
                consumer_id: r.try_get("consumer_id")?,
                last_seq: r.try_get("last_seq")?,
                policy_version: r.try_get("policy_version")?,
                updated_at: r.try_get("updated_at")?,
            }),
            None => None,
        })
    }

    pub async fn advance_checkpoint(
        &self,
        consumer_id: &str,
        last_seq: i64,
        policy_version: &str,
    ) -> Result<LearningEventCheckpoint> {
        if consumer_id.trim().is_empty() {
            return Err(PlethoraError::Validation(
                "consumer_id cannot be empty".to_string(),
            ));
        }
        let now = Utc::now().to_rfc3339();
        let clamped_seq = last_seq.max(0);

        sqlx::query(
            "INSERT INTO learning_event_checkpoints (consumer_id, last_seq, policy_version, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(consumer_id) DO UPDATE SET
                 last_seq = MAX(learning_event_checkpoints.last_seq, excluded.last_seq),
                 policy_version = excluded.policy_version,
                 updated_at = excluded.updated_at",
        )
        .bind(consumer_id)
        .bind(clamped_seq)
        .bind(policy_version)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_checkpoint(consumer_id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Failed to read updated checkpoint".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::database::Repository;
    use crate::models::{Document, FileType};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn migration_168_schema_and_fk_check() {
        let pool = setup_pool().await;
        let fk_violations: Vec<(String, i64, String, i64)> =
            sqlx::query_as("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(fk_violations.is_empty(), "FK violations: {:?}", fk_violations);
    }

    #[tokio::test]
    async fn idempotent_append_and_retraction() {
        let pool = setup_pool().await;
        let repo = LearningEventRepository::new(pool);

        let input = AppendLearningEventInput {
            idempotency_key: "review_commit:rr-1".to_string(),
            event_type: LearningEventType::ReviewCommitted,
            actor: Some("user".to_string()),
            surface: "scroll_mode".to_string(),
            session_id: Some("sess-1".to_string()),
            goal_id: None,
            entity_kind: "learning_item".to_string(),
            entity_id: "item-1".to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({ "rating": 3, "elapsedDays": 4.0 }),
            occurred_at: Some("2026-11-28T10:00:00Z".to_string()),
            retracts_event_id: None,
        };

        let first = repo.append_learning_event(&input).await.unwrap();
        assert!(first.inserted);

        // Duplicate idempotency key must not double-insert
        let dup = repo.append_learning_event(&input).await.unwrap();
        assert!(!dup.inserted);
        assert_eq!(dup.event.id, first.event.id);
        assert_eq!(dup.event.seq, first.event.seq);

        // Retract the review_committed event
        let undo_input = AppendLearningEventInput {
            idempotency_key: "review_undo:rr-1".to_string(),
            event_type: LearningEventType::ReviewUndone,
            actor: Some("user".to_string()),
            surface: "scroll_mode".to_string(),
            session_id: Some("sess-1".to_string()),
            goal_id: None,
            entity_kind: "learning_item".to_string(),
            entity_id: "item-1".to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({ "undoneReviewResultId": "rr-1" }),
            occurred_at: Some("2026-11-28T10:01:00Z".to_string()),
            retracts_event_id: None,
        };

        let retracted = repo
            .retract_learning_event(&first.event.id, &undo_input)
            .await
            .unwrap();
        assert!(retracted.inserted);

        // Default list excludes retracted events
        let active = repo
            .list_learning_events(&LearningEventFilter::default())
            .await
            .unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, retracted.event.id);

        // Including retracted shows both, with retraction link set
        let all = repo
            .list_learning_events(&LearningEventFilter {
                include_retracted: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(
            all[0].retracted_by_event_id.as_deref(),
            Some(retracted.event.id.as_str())
        );
    }

    #[tokio::test]
    async fn privacy_inheritance_and_health_vault_rejection() {
        let pool = setup_pool().await;
        let main_repo = Repository::new(pool.clone());
        let event_repo = LearningEventRepository::new(pool);

        let mut doc = Document::new("Private Notes".into(), "notes.md".into(), FileType::Markdown);
        doc.is_local_only = true;
        doc.is_ai_excluded = true;
        main_repo.create_document(&doc).await.unwrap();

        let input = AppendLearningEventInput {
            idempotency_key: "reading:private-1".to_string(),
            event_type: LearningEventType::ReadingProgressed,
            actor: None,
            surface: "reader".to_string(),
            session_id: None,
            goal_id: None,
            entity_kind: "document".to_string(),
            entity_id: doc.id.clone(),
            document_id: Some(doc.id.clone()),
            is_local_only: Some(false),
            is_ai_excluded: Some(false),
            payload: serde_json::json!({ "progress": 0.5 }),
            occurred_at: None,
            retracts_event_id: None,
        };

        let res = event_repo.append_learning_event(&input).await.unwrap();
        assert!(res.event.is_local_only, "Must inherit is_local_only from document");
        assert!(res.event.is_ai_excluded, "Must inherit is_ai_excluded from document");

        // exclude_ai_excluded filter hides it
        let ai_visible = event_repo
            .list_learning_events(&LearningEventFilter {
                exclude_ai_excluded: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(ai_visible.is_empty());

        // Health Vault entity_kind must be rejected
        let bad_entity = AppendLearningEventInput {
            idempotency_key: "health:bad-1".to_string(),
            event_type: LearningEventType::PracticeAttempted,
            actor: None,
            surface: "unknown".to_string(),
            session_id: None,
            goal_id: None,
            entity_kind: "health_metric".to_string(),
            entity_id: "hr-1".to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({}),
            occurred_at: None,
            retracts_event_id: None,
        };
        assert!(event_repo.append_learning_event(&bad_entity).await.is_err());

        // Health Vault payload key must be rejected
        let bad_payload = AppendLearningEventInput {
            idempotency_key: "health:bad-2".to_string(),
            event_type: LearningEventType::SessionCompleted,
            actor: None,
            surface: "unified_session".to_string(),
            session_id: None,
            goal_id: None,
            entity_kind: "learning_session".to_string(),
            entity_id: "s-1".to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({ "heartRateBpm": 72 }),
            occurred_at: None,
            retracts_event_id: None,
        };
        assert!(event_repo.append_learning_event(&bad_payload).await.is_err());
    }

    #[tokio::test]
    async fn checkpoint_monotonic_advance() {
        let pool = setup_pool().await;
        let repo = LearningEventRepository::new(pool);

        assert!(repo.get_checkpoint("learner_model_v1").await.unwrap().is_none());

        let cp1 = repo
            .advance_checkpoint("learner_model_v1", 10, "v1")
            .await
            .unwrap();
        assert_eq!(cp1.last_seq, 10);

        // Moving backwards does not regress last_seq
        let cp2 = repo
            .advance_checkpoint("learner_model_v1", 5, "v1")
            .await
            .unwrap();
        assert_eq!(cp2.last_seq, 10);

        let cp3 = repo
            .advance_checkpoint("learner_model_v1", 25, "v2")
            .await
            .unwrap();
        assert_eq!(cp3.last_seq, 25);
        assert_eq!(cp3.policy_version, "v2");
    }
}
