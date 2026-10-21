//! Session analysis repository — persistence of analysis checkpoints (runs & units)
//! and staging learning drafts (cards & extracts) before user acceptance.
//! Task 3.1 / OpenSpec D4, D5, D10.

use crate::models::extract::Extract;
use crate::models::learning_item::{ItemType, LearningItem};
use crate::models::recording_session::{
    AcceptSessionDraftResult, AcceptSessionDraftSpec, AcceptSessionDraftsInput,
    AcceptSessionDraftsResponse, CreateSessionAnalysisRun, CreateSessionLearningDraft,
    SessionAnalysisRun, SessionAnalysisUnit, SessionLearningDraft, SessionLearningDraftPage,
    SessionOperationError, UpdateSessionLearningDraft, UpsertSessionAnalysisUnit,
};
use sqlx::{Pool, Row, Sqlite};

type Result<T> = std::result::Result<T, SessionOperationError>;

#[derive(Clone)]
pub struct SessionAnalysisRepository {
    pool: Pool<Sqlite>,
}

impl SessionAnalysisRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_run(row: &sqlx::sqlite::SqliteRow) -> SessionAnalysisRun {
        SessionAnalysisRun {
            id: row.get("id"),
            session_id: row.get("session_id"),
            transcript_revision: row.get("transcript_revision"),
            profile_hash: row.get("profile_hash"),
            task_version: row.get("task_version"),
            generation_epoch: row.get("generation_epoch"),
            status: row.get("status"),
            blocked_reason: row.get("blocked_reason"),
            completed_units: row.get("completed_units"),
            total_units: row.get("total_units"),
            lease_owner: row.get("lease_owner"),
            lease_expires_at: row.get("lease_expires_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    fn row_to_unit(row: &sqlx::sqlite::SqliteRow) -> SessionAnalysisUnit {
        SessionAnalysisUnit {
            run_id: row.get("run_id"),
            unit_key: row.get("unit_key"),
            input_hash: row.get("input_hash"),
            segment_keys_json: row.get("segment_keys_json"),
            status: row.get("status"),
            result_json: row.get("result_json"),
            attempts: row.get("attempts"),
            error_code: row.get("error_code"),
        }
    }

    fn row_to_draft(row: &sqlx::sqlite::SqliteRow) -> SessionLearningDraft {
        SessionLearningDraft {
            id: row.get("id"),
            session_id: row.get("session_id"),
            run_id: row.get("run_id"),
            kind: row.get("kind"),
            status: row.get("status"),
            revision: row.get("revision"),
            payload_json: row.get("payload_json"),
            evidence_json: row.get("evidence_json"),
            content_hash: row.get("content_hash"),
            concept_key: row.get("concept_key"),
            duplicate_json: row.get("duplicate_json"),
            accepted_target_id: row.get("accepted_target_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    // ─── Runs ─────────────────────────────────────────────────────────────

    pub async fn create_analysis_run(
        &self,
        input: &CreateSessionAnalysisRun,
    ) -> Result<SessionAnalysisRun> {
        let inserted = sqlx::query(
            r#"
            INSERT INTO session_analysis_runs (
                id, session_id, transcript_revision, profile_hash, task_version,
                generation_epoch, status, completed_units, total_units, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, datetime('now'), datetime('now'))
            ON CONFLICT (session_id, transcript_revision, profile_hash, task_version, generation_epoch)
            DO NOTHING
            "#,
        )
        .bind(&input.id)
        .bind(&input.session_id)
        .bind(input.transcript_revision)
        .bind(&input.profile_hash)
        .bind(&input.task_version)
        .bind(&input.generation_epoch)
        .bind(input.total_units)
        .execute(&self.pool)
        .await?;

        if inserted.rows_affected() == 0 {
            let row = sqlx::query(
                r#"
                SELECT id, session_id, transcript_revision, profile_hash, task_version,
                       generation_epoch, status, blocked_reason, completed_units, total_units,
                       lease_owner, lease_expires_at, created_at, updated_at
                FROM session_analysis_runs
                WHERE session_id = ? AND transcript_revision = ? AND profile_hash = ?
                  AND task_version = ? AND generation_epoch = ?
                "#,
            )
            .bind(&input.session_id)
            .bind(input.transcript_revision)
            .bind(&input.profile_hash)
            .bind(&input.task_version)
            .bind(&input.generation_epoch)
            .fetch_one(&self.pool)
            .await?;
            Ok(Self::row_to_run(&row))
        } else {
            self.get_analysis_run(&input.id)
                .await?
                .ok_or_else(SessionOperationError::source_unavailable)
        }
    }

    pub async fn get_analysis_run(&self, run_id: &str) -> Result<Option<SessionAnalysisRun>> {
        let row = sqlx::query(
            r#"
            SELECT id, session_id, transcript_revision, profile_hash, task_version,
                   generation_epoch, status, blocked_reason, completed_units, total_units,
                   lease_owner, lease_expires_at, created_at, updated_at
            FROM session_analysis_runs
            WHERE id = ?
            "#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.as_ref().map(Self::row_to_run))
    }

    pub async fn update_analysis_run_status(
        &self,
        run_id: &str,
        status: &str,
        blocked_reason: Option<&str>,
        completed_units: i64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE session_analysis_runs
            SET status = ?, blocked_reason = ?, completed_units = ?, updated_at = datetime('now')
            WHERE id = ?
            "#,
        )
        .bind(status)
        .bind(blocked_reason)
        .bind(completed_units)
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ─── Units ────────────────────────────────────────────────────────────

    pub async fn upsert_analysis_unit(
        &self,
        input: &UpsertSessionAnalysisUnit,
    ) -> Result<SessionAnalysisUnit> {
        sqlx::query(
            r#"
            INSERT INTO session_analysis_units (
                run_id, unit_key, input_hash, segment_keys_json, status,
                result_json, attempts, error_code
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT (run_id, unit_key) DO UPDATE SET
                input_hash = excluded.input_hash,
                segment_keys_json = excluded.segment_keys_json,
                status = excluded.status,
                result_json = excluded.result_json,
                attempts = session_analysis_units.attempts + 1,
                error_code = excluded.error_code
            "#,
        )
        .bind(&input.run_id)
        .bind(&input.unit_key)
        .bind(&input.input_hash)
        .bind(&input.segment_keys_json)
        .bind(&input.status)
        .bind(&input.result_json)
        .bind(&input.error_code)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query(
            r#"
            SELECT run_id, unit_key, input_hash, segment_keys_json, status,
                   result_json, attempts, error_code
            FROM session_analysis_units
            WHERE run_id = ? AND unit_key = ?
            "#,
        )
        .bind(&input.run_id)
        .bind(&input.unit_key)
        .fetch_one(&self.pool)
        .await?;

        Ok(Self::row_to_unit(&row))
    }

    pub async fn list_analysis_units(&self, run_id: &str) -> Result<Vec<SessionAnalysisUnit>> {
        let rows = sqlx::query(
            r#"
            SELECT run_id, unit_key, input_hash, segment_keys_json, status,
                   result_json, attempts, error_code
            FROM session_analysis_units
            WHERE run_id = ?
            ORDER BY unit_key ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(Self::row_to_unit).collect())
    }

    // ─── Learning Drafts ──────────────────────────────────────────────────

    pub async fn create_learning_draft(
        &self,
        input: &CreateSessionLearningDraft,
    ) -> Result<SessionLearningDraft> {
        let status = input.status.as_deref().unwrap_or("proposed");

        let inserted = sqlx::query(
            r#"
            INSERT INTO session_learning_drafts (
                id, session_id, run_id, kind, status, revision,
                payload_json, evidence_json, content_hash, concept_key, duplicate_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT (session_id, run_id, content_hash, kind) WHERE run_id IS NOT NULL
            DO NOTHING
            "#,
        )
        .bind(&input.id)
        .bind(&input.session_id)
        .bind(&input.run_id)
        .bind(&input.kind)
        .bind(status)
        .bind(&input.payload_json)
        .bind(&input.evidence_json)
        .bind(&input.content_hash)
        .bind(&input.concept_key)
        .bind(&input.duplicate_json)
        .execute(&self.pool)
        .await?;

        if inserted.rows_affected() == 0 {
            if let Some(run_id) = &input.run_id {
                let row = sqlx::query(
                    r#"
                    SELECT id, session_id, run_id, kind, status, revision,
                           payload_json, evidence_json, content_hash, concept_key,
                           duplicate_json, accepted_target_id, created_at, updated_at
                    FROM session_learning_drafts
                    WHERE session_id = ? AND run_id = ? AND content_hash = ? AND kind = ?
                    "#,
                )
                .bind(&input.session_id)
                .bind(run_id)
                .bind(&input.content_hash)
                .bind(&input.kind)
                .fetch_one(&self.pool)
                .await?;
                return Ok(Self::row_to_draft(&row));
            }
        }

        self.get_learning_draft(&input.id)
            .await?
            .ok_or_else(SessionOperationError::source_unavailable)
    }

    pub async fn create_learning_drafts_batch(
        &self,
        drafts: &[CreateSessionLearningDraft],
    ) -> Result<Vec<SessionLearningDraft>> {
        let mut results = Vec::with_capacity(drafts.len());
        for draft in drafts {
            let created = self.create_learning_draft(draft).await?;
            results.push(created);
        }
        Ok(results)
    }

    pub async fn get_learning_draft(&self, draft_id: &str) -> Result<Option<SessionLearningDraft>> {
        let row = sqlx::query(
            r#"
            SELECT id, session_id, run_id, kind, status, revision,
                   payload_json, evidence_json, content_hash, concept_key,
                   duplicate_json, accepted_target_id, created_at, updated_at
            FROM session_learning_drafts
            WHERE id = ?
            "#,
        )
        .bind(draft_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.as_ref().map(Self::row_to_draft))
    }

    pub async fn list_learning_drafts(
        &self,
        session_id: &str,
        status: Option<&str>,
        kind: Option<&str>,
        cursor: Option<&str>,
        limit: Option<i64>,
    ) -> Result<SessionLearningDraftPage> {
        let page_size = limit.unwrap_or(50).clamp(1, 100);

        let total: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM session_learning_drafts
            WHERE session_id = ?
              AND (? IS NULL OR status = ?)
              AND (? IS NULL OR kind = ?)
            "#,
        )
        .bind(session_id)
        .bind(status)
        .bind(status)
        .bind(kind)
        .bind(kind)
        .fetch_one(&self.pool)
        .await?;

        let rows = if let Some(cursor_id) = cursor {
            sqlx::query(
                r#"
                SELECT id, session_id, run_id, kind, status, revision,
                       payload_json, evidence_json, content_hash, concept_key,
                       duplicate_json, accepted_target_id, created_at, updated_at
                FROM session_learning_drafts
                WHERE session_id = ?
                  AND (? IS NULL OR status = ?)
                  AND (? IS NULL OR kind = ?)
                  AND id > ?
                ORDER BY created_at ASC, id ASC
                LIMIT ?
                "#,
            )
            .bind(session_id)
            .bind(status)
            .bind(status)
            .bind(kind)
            .bind(kind)
            .bind(cursor_id)
            .bind(page_size)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                r#"
                SELECT id, session_id, run_id, kind, status, revision,
                       payload_json, evidence_json, content_hash, concept_key,
                       duplicate_json, accepted_target_id, created_at, updated_at
                FROM session_learning_drafts
                WHERE session_id = ?
                  AND (? IS NULL OR status = ?)
                  AND (? IS NULL OR kind = ?)
                ORDER BY created_at ASC, id ASC
                LIMIT ?
                "#,
            )
            .bind(session_id)
            .bind(status)
            .bind(status)
            .bind(kind)
            .bind(kind)
            .bind(page_size)
            .fetch_all(&self.pool)
            .await?
        };

        let items: Vec<SessionLearningDraft> = rows.iter().map(Self::row_to_draft).collect();
        let next_cursor = if items.len() as i64 == page_size {
            items.last().map(|d| d.id.clone())
        } else {
            None
        };

        Ok(SessionLearningDraftPage {
            items,
            next_cursor,
            total,
        })
    }

    pub async fn update_learning_draft(
        &self,
        update: &UpdateSessionLearningDraft,
    ) -> Result<SessionLearningDraft> {
        let current = self
            .get_learning_draft(&update.id)
            .await?
            .ok_or_else(SessionOperationError::source_unavailable)?;

        if current.revision != update.expected_revision {
            return Err(SessionOperationError::stale());
        }

        let next_revision = current.revision + 1;
        let payload = update
            .payload_json
            .as_deref()
            .unwrap_or(&current.payload_json);
        let status = update.status.as_deref().unwrap_or(&current.status);
        let duplicate = update
            .duplicate_json
            .as_deref()
            .or(current.duplicate_json.as_deref());

        sqlx::query(
            r#"
            UPDATE session_learning_drafts
            SET revision = ?, payload_json = ?, status = ?, duplicate_json = ?, updated_at = datetime('now')
            WHERE id = ? AND revision = ?
            "#,
        )
        .bind(next_revision)
        .bind(payload)
        .bind(status)
        .bind(duplicate)
        .bind(&update.id)
        .bind(update.expected_revision)
        .execute(&self.pool)
        .await?;

        self.get_learning_draft(&update.id)
            .await?
            .ok_or_else(SessionOperationError::source_unavailable)
    }

    pub async fn reject_learning_drafts(
        &self,
        session_id: &str,
        draft_ids: &[String],
    ) -> Result<i64> {
        let mut count = 0;
        for id in draft_ids {
            let res = sqlx::query(
                r#"
                UPDATE session_learning_drafts
                SET status = 'rejected', updated_at = datetime('now')
                WHERE id = ? AND session_id = ?
                "#,
            )
            .bind(id)
            .bind(session_id)
            .execute(&self.pool)
            .await?;
            count += res.rows_affected();
        }
        Ok(count as i64)
    }

    pub async fn supersede_learning_drafts_for_run(&self, run_id: &str) -> Result<i64> {
        let res = sqlx::query(
            r#"
            UPDATE session_learning_drafts
            SET status = 'superseded', updated_at = datetime('now')
            WHERE run_id = ? AND status = 'proposed'
            "#,
        )
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() as i64)
    }

    // ─── Acceptance (Task 3.2 / D10) ─────────────────────────────────────────

    pub async fn accept_session_drafts(
        &self,
        input: &AcceptSessionDraftsInput,
    ) -> Result<AcceptSessionDraftsResponse> {
        let doc_id: Option<String> = sqlx::query_scalar(
            "SELECT document_id FROM recording_sessions WHERE id = ?",
        )
        .bind(&input.session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(SessionOperationError::from)?;
        let doc_id = doc_id.unwrap_or_default();

        let all_or_nothing = input.all_or_nothing.unwrap_or(false);

        if all_or_nothing {
            let mut tx = self.pool.begin().await.map_err(SessionOperationError::from)?;
            let mut results = Vec::with_capacity(input.items.len());
            let mut failed = false;

            for spec in &input.items {
                match Self::accept_single_draft_in_tx(
                    &mut tx,
                    &input.session_id,
                    &doc_id,
                    spec,
                    input.provider.as_deref(),
                    input.model.as_deref(),
                )
                .await
                {
                    Ok((target_id, target_kind)) => {
                        results.push(AcceptSessionDraftResult {
                            draft_id: spec.draft_id.clone(),
                            success: true,
                            target_id: Some(target_id),
                            target_kind: Some(target_kind),
                            error: None,
                        });
                    }
                    Err(err) => {
                        results.push(AcceptSessionDraftResult {
                            draft_id: spec.draft_id.clone(),
                            success: false,
                            target_id: None,
                            target_kind: None,
                            error: Some(err),
                        });
                        failed = true;
                        break;
                    }
                }
            }

            if failed {
                drop(tx);
                let failed_count = input.items.len();
                return Ok(AcceptSessionDraftsResponse {
                    results,
                    accepted_count: 0,
                    failed_count,
                });
            } else {
                tx.commit().await.map_err(SessionOperationError::from)?;
                crate::sync::journal::notify_after_commit();
                let accepted_count = results.len();
                return Ok(AcceptSessionDraftsResponse {
                    results,
                    accepted_count,
                    failed_count: 0,
                });
            }
        } else {
            let mut results = Vec::with_capacity(input.items.len());
            let mut accepted_count = 0;
            let mut failed_count = 0;

            for spec in &input.items {
                let mut tx = match self.pool.begin().await {
                    Ok(t) => t,
                    Err(e) => {
                        results.push(AcceptSessionDraftResult {
                            draft_id: spec.draft_id.clone(),
                            success: false,
                            target_id: None,
                            target_kind: None,
                            error: Some(e.to_string()),
                        });
                        failed_count += 1;
                        continue;
                    }
                };

                match Self::accept_single_draft_in_tx(
                    &mut tx,
                    &input.session_id,
                    &doc_id,
                    spec,
                    input.provider.as_deref(),
                    input.model.as_deref(),
                )
                .await
                {
                    Ok((target_id, target_kind)) => {
                        if let Err(e) = tx.commit().await {
                            results.push(AcceptSessionDraftResult {
                                draft_id: spec.draft_id.clone(),
                                success: false,
                                target_id: None,
                                target_kind: None,
                                error: Some(e.to_string()),
                            });
                            failed_count += 1;
                        } else {
                            crate::sync::journal::notify_after_commit();
                            results.push(AcceptSessionDraftResult {
                                draft_id: spec.draft_id.clone(),
                                success: true,
                                target_id: Some(target_id),
                                target_kind: Some(target_kind),
                                error: None,
                            });
                            accepted_count += 1;
                        }
                    }
                    Err(err) => {
                        drop(tx);
                        results.push(AcceptSessionDraftResult {
                            draft_id: spec.draft_id.clone(),
                            success: false,
                            target_id: None,
                            target_kind: None,
                            error: Some(err),
                        });
                        failed_count += 1;
                    }
                }
            }

            Ok(AcceptSessionDraftsResponse {
                results,
                accepted_count,
                failed_count,
            })
        }
    }

    async fn accept_single_draft_in_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        session_id: &str,
        session_doc_id: &str,
        spec: &AcceptSessionDraftSpec,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> std::result::Result<(String, String), String> {
        let row = sqlx::query(
            r#"
            SELECT id, session_id, run_id, kind, status, revision,
                   payload_json, evidence_json, content_hash, concept_key,
                   duplicate_json, accepted_target_id, created_at, updated_at
            FROM session_learning_drafts
            WHERE id = ?
            "#,
        )
        .bind(&spec.draft_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Draft {} not found", spec.draft_id))?;

        let draft = Self::row_to_draft(&row);

        if draft.session_id != session_id {
            return Err(format!(
                "Draft {} does not belong to session {}",
                spec.draft_id, session_id
            ));
        }

        // Idempotent: return target if already accepted
        if draft.status == "accepted" {
            if let Some(target_id) = draft.accepted_target_id {
                return Ok((target_id, draft.kind));
            }
        }

        if draft.revision != spec.expected_revision {
            return Err(format!(
                "Stale revision for draft {}: expected {}, found {}",
                spec.draft_id, spec.expected_revision, draft.revision
            ));
        }

        let payload: serde_json::Value =
            serde_json::from_str(&draft.payload_json).unwrap_or(serde_json::Value::Null);

        let item_doc_id = payload
            .get("documentId")
            .or_else(|| payload.get("document_id"))
            .and_then(|v| v.as_str())
            .unwrap_or(session_doc_id);

        let is_replace = matches!(
            spec.duplicate_decision.as_deref(),
            Some("replace") | Some("update")
        );

        let mut final_target_id = String::new();
        let target_kind = draft.kind.clone();
        let now_dt = chrono::Utc::now();
        let now = now_dt.to_rfc3339();

        if is_replace {
            let replace_id = spec
                .duplicate_target_id
                .as_deref()
                .or_else(|| {
                    payload
                        .get("duplicateTargetId")
                        .or_else(|| payload.get("duplicate_target_id"))
                        .and_then(|v| v.as_str())
                });

            if let Some(rep_id) = replace_id {
                final_target_id = rep_id.to_string();
                if draft.kind == "extract" {
                    let quote = payload
                        .get("quote")
                        .or_else(|| payload.get("content"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let notes = payload.get("notes").and_then(|v| v.as_str());
                    sqlx::query(
                        "UPDATE extracts SET content = ?1, notes = ?2, date_modified = ?3 WHERE id = ?4",
                    )
                    .bind(quote)
                    .bind(notes)
                    .bind(&now)
                    .bind(&final_target_id)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Failed to update extract {}: {}", final_target_id, e))?;
                } else {
                    let question = payload
                        .get("question")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let answer = payload.get("answer").and_then(|v| v.as_str());
                    let cloze_text = payload
                        .get("clozeText")
                        .or_else(|| payload.get("cloze_text"))
                        .and_then(|v| v.as_str());
                    sqlx::query(
                        "UPDATE learning_items SET question = ?1, answer = ?2, cloze_text = ?3, date_modified = ?4, updated_at = ?4 WHERE id = ?5",
                    )
                    .bind(question)
                    .bind(answer)
                    .bind(cloze_text)
                    .bind(&now)
                    .bind(&final_target_id)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Failed to update learning_item {}: {}", final_target_id, e))?;
                }
            } else {
                return Err("Duplicate decision was replace/update but no duplicate_target_id provided".to_string());
            }
        } else {
            final_target_id = uuid::Uuid::new_v4().to_string();
            let parsed_tags: Vec<String> = payload
                .get("tags")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            if draft.kind == "extract" {
                let quote = payload
                    .get("quote")
                    .or_else(|| payload.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let notes = payload.get("notes").and_then(|v| v.as_str());

                let mut extract = Extract::new(item_doc_id.to_string(), quote.to_string());
                extract.id = final_target_id.clone();
                extract.notes = notes.map(|s| s.to_string());
                extract.tags = parsed_tags;

                let tags_json = serde_json::to_string(&extract.tags).map_err(|e| e.to_string())?;

                sqlx::query(
                    r#"
                    INSERT INTO extracts (
                        id, collection_id, document_id, content, notes, date_created, date_modified, tags,
                        review_count, reps, priority_score, is_dismissed
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 0.0, 0)
                    "#,
                )
                .bind(&extract.id)
                .bind(&extract.collection_id)
                .bind(&extract.document_id)
                .bind(&extract.content)
                .bind(&extract.notes)
                .bind(extract.date_created)
                .bind(extract.date_modified)
                .bind(&tags_json)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Failed to insert extract: {}", e))?;

                if !extract.document_id.is_empty() {
                    let doc_node = crate::database::element_tree_repository::find_node_id_in_tx(
                        tx,
                        crate::database::element_tree_repository::ElementKind::Document,
                        &extract.document_id,
                    )
                    .await
                    .ok()
                    .flatten();
                    if let Some(parent_id) = doc_node {
                        let _ = crate::database::element_tree_repository::register_node_in_tx(
                            tx,
                            crate::database::element_tree_repository::ElementKind::Extract,
                            &extract.id,
                            crate::database::element_tree_repository::ELEMENT_TYPE_TOPIC,
                            Some(parent_id),
                            &now,
                        )
                        .await;
                    }
                }
            } else {
                let raw_type = payload
                    .get("itemType")
                    .or_else(|| payload.get("item_type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("flashcard")
                    .to_lowercase();
                let answer = payload.get("answer").and_then(|v| v.as_str());
                let item_type = match raw_type.as_str() {
                    "cloze" => ItemType::Cloze,
                    "qa" => ItemType::Qa,
                    "definition" | "comparison" | "cause" | "process" => {
                        if answer.is_some() && !answer.unwrap().trim().is_empty() {
                            ItemType::Flashcard
                        } else {
                            ItemType::Qa
                        }
                    }
                    _ => ItemType::Flashcard,
                };
                let raw_question = payload
                    .get("question")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let question = if item_type == ItemType::Cloze || raw_question.contains("{{") || raw_question.contains("[[") {
                    normalize_cloze_markers(raw_question)
                } else {
                    raw_question.to_string()
                };
                let raw_cloze = payload
                    .get("clozeText")
                    .or_else(|| payload.get("cloze_text"))
                    .and_then(|v| v.as_str());
                let clooze_norm = raw_cloze.map(normalize_cloze_markers);
                let cloze_text = clooze_norm.or_else(|| {
                    if item_type == ItemType::Cloze {
                        Some(question.clone())
                    } else {
                        None
                    }
                });
                let extract_id = payload
                    .get("extractId")
                    .or_else(|| payload.get("extract_id"))
                    .and_then(|v| v.as_str());

                let mut item = LearningItem::new(item_type, question);
                item.id = final_target_id.clone();
                item.document_id = if item_doc_id.is_empty() {
                    None
                } else {
                    Some(item_doc_id.to_string())
                };
                item.extract_id = extract_id.map(|s| s.to_string());
                item.answer = answer.map(|s| s.to_string());
                item.cloze_text = cloze_text;
                item.tags = parsed_tags;
                item.acceptance_id = Some(draft.id.clone());
                item.proposal_id = Some(draft.content_hash.clone());

                let item_type_str = format!("{:?}", item.item_type).to_lowercase();
                let state_str = format!("{:?}", item.state).to_lowercase();
                let tags_json = serde_json::to_string(&item.tags).map_err(|e| e.to_string())?;

                sqlx::query(
                    r#"
                    INSERT INTO learning_items (
                        id, collection_id, extract_id, document_id, item_type, question,
                        answer, cloze_text, difficulty, interval, ease_factor, due_date,
                        date_created, date_modified, last_review_date, review_count, lapses,
                        state, is_suspended, tags, algorithm_type, algorithm_state, updated_at,
                        priority_slider, priority_score, priority_explicitly_set,
                        acceptance_id, proposal_id
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6,
                        ?7, ?8, ?9, ?10, ?11, ?12,
                        ?13, ?14, ?15, ?16, ?17,
                        ?18, ?19, ?20, ?21, ?22, ?23,
                        ?24, ?25, ?26,
                        ?27, ?28
                    )
                    "#,
                )
                .bind(&item.id)
                .bind(&item.collection_id)
                .bind(&item.extract_id)
                .bind(&item.document_id)
                .bind(&item_type_str)
                .bind(&item.question)
                .bind(&item.answer)
                .bind(&item.cloze_text)
                .bind(item.difficulty)
                .bind(item.interval)
                .bind(item.ease_factor)
                .bind(item.due_date)
                .bind(item.date_created)
                .bind(item.date_modified)
                .bind(item.last_review_date)
                .bind(item.review_count)
                .bind(item.lapses)
                .bind(&state_str)
                .bind(item.is_suspended)
                .bind(&tags_json)
                .bind(&item.algorithm_type)
                .bind(&item.algorithm_state)
                .bind(item.date_modified)
                .bind(50)
                .bind(0.0)
                .bind(0)
                .bind(&item.acceptance_id)
                .bind(&item.proposal_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Failed to insert learning_item: {}", e))?;

                let parent_node = if let Some(ext_id) = &item.extract_id {
                    crate::database::element_tree_repository::find_node_id_in_tx(
                        tx,
                        crate::database::element_tree_repository::ElementKind::Extract,
                        ext_id,
                    )
                    .await
                    .ok()
                    .flatten()
                } else if let Some(doc_id) = &item.document_id {
                    crate::database::element_tree_repository::find_node_id_in_tx(
                        tx,
                        crate::database::element_tree_repository::ElementKind::Document,
                        doc_id,
                    )
                    .await
                    .ok()
                    .flatten()
                } else {
                    None
                };
                if let Some(parent_id) = parent_node {
                    let _ = crate::database::element_tree_repository::register_node_in_tx(
                        tx,
                        crate::database::element_tree_repository::ElementKind::LearningItem,
                        &item.id,
                        crate::database::element_tree_repository::ELEMENT_TYPE_ITEM,
                        Some(parent_id),
                        &now,
                    )
                    .await;
                }
            }
        }

        // Insert learning_object_sources
        let los_id = uuid::Uuid::new_v4().to_string();
        let los_hash = crate::database::learning_object_source_repository::LearningObjectSourceRepository::compute_evidence_hash(&draft.evidence_json);
        let los_target_kind = if target_kind == "extract" { "extract" } else { "card" };

        sqlx::query(
            r#"
            INSERT INTO learning_object_sources (
                id, target_kind, target_id, session_id, document_id, evidence_json, evidence_hash, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(target_kind, target_id, evidence_hash) DO NOTHING
            "#,
        )
        .bind(&los_id)
        .bind(los_target_kind)
        .bind(&final_target_id)
        .bind(session_id)
        .bind(item_doc_id)
        .bind(&draft.evidence_json)
        .bind(&los_hash)
        .bind(&now)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to insert learning_object_sources: {}", e))?;

        // Insert ai_provenance
        let prov_id = uuid::Uuid::new_v4().to_string();
        let prov_provider = provider.unwrap_or("session_analysis");
        let prov_model = model.unwrap_or("on_device");

        sqlx::query(
            r#"
            INSERT INTO ai_provenance (
                id, target_kind, target_id, task_id, provider, model, model_class, input_fingerprint, created_at, metadata_json
            ) VALUES (?1, ?2, ?3, 'session_analysis', ?4, ?5, 'analysis', ?6, ?7, ?8)
            "#,
        )
        .bind(&prov_id)
        .bind(los_target_kind)
        .bind(&final_target_id)
        .bind(prov_provider)
        .bind(prov_model)
        .bind(&draft.content_hash)
        .bind(&now)
        .bind(&draft.evidence_json)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to insert ai_provenance: {}", e))?;

        // Update session_learning_drafts
        let next_rev = draft.revision + 1;
        let res = sqlx::query(
            r#"
            UPDATE session_learning_drafts
            SET status = 'accepted', accepted_target_id = ?1, revision = ?2, updated_at = datetime('now')
            WHERE id = ?3 AND revision = ?4
            "#,
        )
        .bind(&final_target_id)
        .bind(next_rev)
        .bind(&draft.id)
        .bind(draft.revision)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to update draft status: {}", e))?;

        if res.rows_affected() == 0 {
            return Err("Stale revision during draft update".to_string());
        }

        Ok((final_target_id, target_kind))
    }
}

pub fn normalize_cloze_markers(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut result = String::with_capacity(text.len() + 16);
    let mut cloze_idx = 1usize;
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() {
        if i + 1 < bytes.len()
            && ((bytes[i] == b'{' && bytes[i + 1] == b'{')
                || (bytes[i] == b'[' && bytes[i + 1] == b'['))
        {
            let is_brace = bytes[i] == b'{';
            let closer = if is_brace { "}}" } else { "]]" };
            let start_inner = i + 2;
            if let Some(rel_close) = text[start_inner..].find(closer) {
                let inner = &text[start_inner..start_inner + rel_close];
                let is_already_numbered = inner.starts_with('c')
                    && inner
                        .chars()
                        .skip(1)
                        .take_while(|c| c.is_ascii_digit())
                        .count()
                        > 0
                    && inner.contains("::");
                if is_already_numbered {
                    result.push_str("{{");
                    result.push_str(inner);
                    result.push_str("}}");
                } else {
                    let clean = if inner.starts_with("::") {
                        &inner[2..]
                    } else {
                        inner
                    };
                    result.push_str(&format!("{{{{c{}::{}}}}}", cloze_idx, clean));
                    cloze_idx += 1;
                }
                i = start_inner + rel_close + 2;
                continue;
            }
        }
        if let Some(ch) = text[i..].chars().next() {
            result.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }
    result
}

use super::Repository;

impl Repository {
    pub async fn create_session_analysis_run(
        &self,
        input: &CreateSessionAnalysisRun,
    ) -> std::result::Result<SessionAnalysisRun, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.create_analysis_run(input).await
    }

    pub async fn get_session_analysis_run(
        &self,
        run_id: &str,
    ) -> std::result::Result<Option<SessionAnalysisRun>, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.get_analysis_run(run_id).await
    }

    pub async fn upsert_session_analysis_unit(
        &self,
        input: &UpsertSessionAnalysisUnit,
    ) -> std::result::Result<SessionAnalysisUnit, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.upsert_analysis_unit(input).await
    }

    pub async fn list_session_analysis_units(
        &self,
        run_id: &str,
    ) -> std::result::Result<Vec<SessionAnalysisUnit>, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.list_analysis_units(run_id).await
    }

    pub async fn create_session_learning_draft(
        &self,
        input: &CreateSessionLearningDraft,
    ) -> std::result::Result<SessionLearningDraft, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.create_learning_draft(input).await
    }

    pub async fn get_session_learning_draft(
        &self,
        draft_id: &str,
    ) -> std::result::Result<Option<SessionLearningDraft>, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.get_learning_draft(draft_id).await
    }

    pub async fn list_session_learning_drafts(
        &self,
        session_id: &str,
        status: Option<&str>,
        kind: Option<&str>,
        cursor: Option<&str>,
        limit: Option<i64>,
    ) -> std::result::Result<SessionLearningDraftPage, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.list_learning_drafts(session_id, status, kind, cursor, limit).await
    }

    pub async fn update_session_learning_draft(
        &self,
        update: &UpdateSessionLearningDraft,
    ) -> std::result::Result<SessionLearningDraft, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.update_learning_draft(update).await
    }

    pub async fn reject_session_learning_drafts(
        &self,
        session_id: &str,
        draft_ids: &[String],
    ) -> std::result::Result<i64, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.reject_learning_drafts(session_id, draft_ids).await
    }

    pub async fn accept_session_drafts(
        &self,
        input: &AcceptSessionDraftsInput,
    ) -> std::result::Result<AcceptSessionDraftsResponse, SessionOperationError> {
        let repo = SessionAnalysisRepository::new(self.pool().clone());
        repo.accept_session_drafts(input).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> (Pool<Sqlite>, String) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let session_id = "sess-analysis-test-1".to_string();
        sqlx::query(
            r#"
            INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified)
            VALUES ('doc-test-1', 'Test Document', 'test.txt', 'txt', datetime('now'), datetime('now'))
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO recording_sessions (
                id, document_id, origin, content_type, profile_json, capture_state,
                ingestion_state, transcript_revision, created_at, updated_at, version
            ) VALUES (?, 'doc-test-1', 'recorded', 'lecture', '{}', 'saved', 'saved', 1, datetime('now'), datetime('now'), 1)
            "#,
        )
        .bind(&session_id)
        .execute(&pool)
        .await
        .unwrap();

        (pool, session_id)
    }

    #[tokio::test]
    async fn test_analysis_runs_and_checkpoints_lifecycle() {
        let (pool, session_id) = setup_test_db().await;
        let repo = SessionAnalysisRepository::new(pool.clone());

        // Create run
        let run_input = CreateSessionAnalysisRun {
            id: "run-1".to_string(),
            session_id: session_id.clone(),
            transcript_revision: 1,
            profile_hash: "profile-hash-1".to_string(),
            task_version: "v1".to_string(),
            generation_epoch: "epoch-1".to_string(),
            total_units: 5,
        };
        let run = repo.create_analysis_run(&run_input).await.unwrap();
        assert_eq!(run.id, "run-1");
        assert_eq!(run.status, "queued");
        assert_eq!(run.completed_units, 0);

        // Idempotent duplicate run creation
        let dup = repo.create_analysis_run(&run_input).await.unwrap();
        assert_eq!(dup.id, "run-1");

        // Update run status
        repo.update_analysis_run_status("run-1", "running", None, 2)
            .await
            .unwrap();
        let updated_run = repo.get_analysis_run("run-1").await.unwrap().unwrap();
        assert_eq!(updated_run.status, "running");
        assert_eq!(updated_run.completed_units, 2);

        // Upsert analysis units
        let unit_1 = repo
            .upsert_analysis_unit(&UpsertSessionAnalysisUnit {
                run_id: "run-1".to_string(),
                unit_key: "unit-0".to_string(),
                input_hash: "hash-0".to_string(),
                segment_keys_json: "[\"seg-0\"]".to_string(),
                status: "completed".to_string(),
                result_json: Some("{\"topics\":[]}".to_string()),
                error_code: None,
            })
            .await
            .unwrap();
        assert_eq!(unit_1.attempts, 1);
        assert_eq!(unit_1.status, "completed");

        let units = repo.list_analysis_units("run-1").await.unwrap();
        assert_eq!(units.len(), 1);
    }

    #[tokio::test]
    async fn test_learning_drafts_paging_and_idempotency_and_rejection() {
        let (pool, session_id) = setup_test_db().await;
        let repo = SessionAnalysisRepository::new(pool.clone());

        let run_input = CreateSessionAnalysisRun {
            id: "run-drafts-1".to_string(),
            session_id: session_id.clone(),
            transcript_revision: 1,
            profile_hash: "profile-hash-drafts".to_string(),
            task_version: "v1".to_string(),
            generation_epoch: "epoch-1".to_string(),
            total_units: 10,
        };
        repo.create_analysis_run(&run_input).await.unwrap();

        // 1. Over 100 drafts survive restart and page access
        let mut created_ids = Vec::new();
        for i in 0..105 {
            let draft = repo
                .create_learning_draft(&CreateSessionLearningDraft {
                    id: format!("draft-card-{}", i),
                    session_id: session_id.clone(),
                    run_id: Some("run-drafts-1".to_string()),
                    kind: "card".to_string(),
                    status: Some("proposed".to_string()),
                    payload_json: format!("{{\"front\":\"Q{}\",\"back\":\"A{}\"}}", i, i),
                    evidence_json: "{}".to_string(),
                    content_hash: format!("content-hash-{}", i),
                    concept_key: Some("concept-ai".to_string()),
                    duplicate_json: None,
                })
                .await
                .unwrap();
            created_ids.push(draft.id);
        }

        // Paging access: page 1 of 50
        let page_1 = repo
            .list_learning_drafts(&session_id, Some("proposed"), Some("card"), None, Some(50))
            .await
            .unwrap();
        assert_eq!(page_1.items.len(), 50);
        assert_eq!(page_1.total, 105);
        assert!(page_1.next_cursor.is_some());

        // Paging access: page 2 of 50
        let page_2 = repo
            .list_learning_drafts(
                &session_id,
                Some("proposed"),
                Some("card"),
                page_1.next_cursor.as_deref(),
                Some(50),
            )
            .await
            .unwrap();
        assert_eq!(page_2.items.len(), 50);

        // 2. Retry same unit yields same drafts (idempotency by run_id, session_id, content_hash, kind)
        let retry_draft = repo
            .create_learning_draft(&CreateSessionLearningDraft {
                id: "different-id-same-content".to_string(),
                session_id: session_id.clone(),
                run_id: Some("run-drafts-1".to_string()),
                kind: "card".to_string(),
                status: Some("proposed".to_string()),
                payload_json: "{\"front\":\"Q0\",\"back\":\"A0\"}".to_string(),
                evidence_json: "{}".to_string(),
                content_hash: "content-hash-0".to_string(),
                concept_key: Some("concept-ai".to_string()),
                duplicate_json: None,
            })
            .await
            .unwrap();
        assert_eq!(retry_draft.id, "draft-card-0");

        // 3. Stale edit conflicts (optimistic concurrency)
        let update_res = repo
            .update_learning_draft(&UpdateSessionLearningDraft {
                id: "draft-card-0".to_string(),
                expected_revision: 999, // Stale!
                payload_json: Some("{\"front\":\"Edited Q\"}".to_string()),
                status: None,
                duplicate_json: None,
            })
            .await;
        assert!(update_res.is_err());

        // Successful edit increments revision
        let updated_draft = repo
            .update_learning_draft(&UpdateSessionLearningDraft {
                id: "draft-card-0".to_string(),
                expected_revision: 1,
                payload_json: Some("{\"front\":\"Edited Q\"}".to_string()),
                status: None,
                duplicate_json: None,
            })
            .await
            .unwrap();
        assert_eq!(updated_draft.revision, 2);
        assert_eq!(updated_draft.payload_json, "{\"front\":\"Edited Q\"}");

        // 4. Reject drafts creates zero learning_items / extracts
        let rejected_count = repo
            .reject_learning_drafts(&session_id, &[created_ids[1].clone(), created_ids[2].clone()])
            .await
            .unwrap();
        assert_eq!(rejected_count, 2);

        let rejected_draft = repo.get_learning_draft(&created_ids[1]).await.unwrap().unwrap();
        assert_eq!(rejected_draft.status, "rejected");

        // Verify learning_items and extracts count is still 0
        let learning_items_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        let extracts_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM extracts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(learning_items_count, 0);
        assert_eq!(extracts_count, 0);

        // 5. Manual run-null support
        let manual_draft = repo
            .create_learning_draft(&CreateSessionLearningDraft {
                id: "manual-draft-1".to_string(),
                session_id: session_id.clone(),
                run_id: None,
                kind: "extract".to_string(),
                status: Some("proposed".to_string()),
                payload_json: "{\"verbatimText\":\"Manual quotation\"}".to_string(),
                evidence_json: "{}".to_string(),
                content_hash: "manual-hash-1".to_string(),
                concept_key: None,
                duplicate_json: None,
            })
            .await
            .unwrap();
        assert_eq!(manual_draft.run_id, None);
        assert_eq!(manual_draft.kind, "extract");
    }

    #[test]
    fn test_cloze_markers_normalization() {
        assert_eq!(
            normalize_cloze_markers("The capital of France is {{Paris}}."),
            "The capital of France is {{c1::Paris}}."
        );
        assert_eq!(
            normalize_cloze_markers("{{Paris}} is capital and {{Euro}} is currency."),
            "{{c1::Paris}} is capital and {{c2::Euro}} is currency."
        );
        assert_eq!(
            normalize_cloze_markers("Already {{c3::preserved}}."),
            "Already {{c3::preserved}}."
        );
        assert_eq!(
            normalize_cloze_markers("No cloze here."),
            "No cloze here."
        );
    }

    #[tokio::test]
    async fn test_accept_card_and_extract_drafts_lifecycle() {
        let (pool, session_id) = setup_test_db().await;
        let repo = SessionAnalysisRepository::new(pool.clone());

        // 1. Create a card draft and an extract draft
        let card_draft = repo
            .create_learning_draft(&CreateSessionLearningDraft {
                id: "draft-card-accept-1".to_string(),
                session_id: session_id.clone(),
                run_id: None,
                kind: "card".to_string(),
                status: Some("proposed".to_string()),
                payload_json: serde_json::to_string(&serde_json::json!({
                    "itemType": "flashcard",
                    "question": "What is Mitochondria?",
                    "answer": "Powerhouse of the cell",
                    "tags": ["biology", "cell"]
                }))
                .unwrap(),
                evidence_json: serde_json::to_string(&serde_json::json!({
                    "segmentKeys": ["seg-1"],
                    "startMs": 1000,
                    "endMs": 5000
                }))
                .unwrap(),
                content_hash: "hash-card-1".to_string(),
                concept_key: None,
                duplicate_json: None,
            })
            .await
            .unwrap();

        let extract_draft = repo
            .create_learning_draft(&CreateSessionLearningDraft {
                id: "draft-extract-accept-1".to_string(),
                session_id: session_id.clone(),
                run_id: None,
                kind: "extract".to_string(),
                status: Some("proposed".to_string()),
                payload_json: serde_json::to_string(&serde_json::json!({
                    "quote": "Mitochondria generate ATP via oxidative phosphorylation.",
                    "notes": "Key concept for exam",
                    "tags": ["biology"]
                }))
                .unwrap(),
                evidence_json: serde_json::to_string(&serde_json::json!({
                    "segmentKeys": ["seg-2"],
                    "startMs": 6000,
                    "endMs": 9000
                }))
                .unwrap(),
                content_hash: "hash-extract-1".to_string(),
                concept_key: None,
                duplicate_json: None,
            })
            .await
            .unwrap();

        // 2. Accept both drafts
        let accept_res = repo
            .accept_session_drafts(&AcceptSessionDraftsInput {
                session_id: session_id.clone(),
                items: vec![
                    AcceptSessionDraftSpec {
                        draft_id: card_draft.id.clone(),
                        expected_revision: 1,
                        duplicate_decision: None,
                        duplicate_target_id: None,
                    },
                    AcceptSessionDraftSpec {
                        draft_id: extract_draft.id.clone(),
                        expected_revision: 1,
                        duplicate_decision: None,
                        duplicate_target_id: None,
                    },
                ],
                provider: Some("test_provider".to_string()),
                model: Some("test_model".to_string()),
                all_or_nothing: Some(false),
            })
            .await
            .unwrap();

        assert_eq!(accept_res.accepted_count, 2);
        assert_eq!(accept_res.failed_count, 0);

        let card_target_id = accept_res.results[0].target_id.clone().unwrap();
        let extract_target_id = accept_res.results[1].target_id.clone().unwrap();

        // 3. Verify card in learning_items
        let card_q: String = sqlx::query_scalar("SELECT question FROM learning_items WHERE id = ?")
            .bind(&card_target_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(card_q, "What is Mitochondria?");

        // 4. Verify extract in extracts
        let ext_content: String = sqlx::query_scalar("SELECT content FROM extracts WHERE id = ?")
            .bind(&extract_target_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            ext_content,
            "Mitochondria generate ATP via oxidative phosphorylation."
        );

        // 5. Verify learning_object_sources
        let los_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_object_sources WHERE session_id = ?",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(los_count, 2);

        // 6. Verify ai_provenance
        let prov_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_provenance WHERE target_id IN (?, ?)",
        )
        .bind(&card_target_id)
        .bind(&extract_target_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(prov_count, 2);

        // 7. Verify draft status updated to accepted
        let updated_card_draft = repo.get_learning_draft(&card_draft.id).await.unwrap().unwrap();
        assert_eq!(updated_card_draft.status, "accepted");
        assert_eq!(updated_card_draft.accepted_target_id, Some(card_target_id.clone()));

        // 8. Idempotent acceptance retry returns same target without recreating
        let retry_res = repo
            .accept_session_drafts(&AcceptSessionDraftsInput {
                session_id: session_id.clone(),
                items: vec![AcceptSessionDraftSpec {
                    draft_id: card_draft.id.clone(),
                    expected_revision: 2,
                    duplicate_decision: None,
                    duplicate_target_id: None,
                }],
                provider: None,
                model: None,
                all_or_nothing: None,
            })
            .await
            .unwrap();
        assert_eq!(retry_res.results[0].target_id, Some(card_target_id));
        let total_cards: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(total_cards, 1);
    }

    #[tokio::test]
    async fn test_accept_duplicate_decision_replace_updates_existing_item() {
        let (pool, session_id) = setup_test_db().await;
        let repo = SessionAnalysisRepository::new(pool.clone());

        // Insert existing learning item
        let existing_id = "existing-card-1".to_string();
        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, item_type, question, answer, due_date, date_created, date_modified
            ) VALUES (?, 'flashcard', 'Old Question', 'Old Answer', datetime('now'), datetime('now'), datetime('now'))
            "#,
        )
        .bind(&existing_id)
        .execute(&pool)
        .await
        .unwrap();

        // Create draft with improved text
        let draft = repo
            .create_learning_draft(&CreateSessionLearningDraft {
                id: "draft-replace-1".to_string(),
                session_id: session_id.clone(),
                run_id: None,
                kind: "card".to_string(),
                status: Some("proposed".to_string()),
                payload_json: serde_json::to_string(&serde_json::json!({
                    "itemType": "flashcard",
                    "question": "Updated Better Question",
                    "answer": "Updated Better Answer",
                }))
                .unwrap(),
                evidence_json: "{}".to_string(),
                content_hash: "hash-replace-1".to_string(),
                concept_key: None,
                duplicate_json: None,
            })
            .await
            .unwrap();

        // Accept with duplicate_decision: replace
        let res = repo
            .accept_session_drafts(&AcceptSessionDraftsInput {
                session_id: session_id.clone(),
                items: vec![AcceptSessionDraftSpec {
                    draft_id: draft.id.clone(),
                    expected_revision: 1,
                    duplicate_decision: Some("replace".to_string()),
                    duplicate_target_id: Some(existing_id.clone()),
                }],
                provider: None,
                model: None,
                all_or_nothing: None,
            })
            .await
            .unwrap();

        assert_eq!(res.accepted_count, 1);
        assert_eq!(res.results[0].target_id, Some(existing_id.clone()));

        // Verify existing item updated
        let updated_q: String = sqlx::query_scalar("SELECT question FROM learning_items WHERE id = ?")
            .bind(&existing_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(updated_q, "Updated Better Question");

        // Total count remains 1 (no new row created)
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_20_item_batch_rolls_back_on_single_failing_provenance_insert() {
        let (pool, session_id) = setup_test_db().await;
        let repo = SessionAnalysisRepository::new(pool.clone());

        repo.create_analysis_run(&CreateSessionAnalysisRun {
            id: "run-batch-test".to_string(),
            session_id: session_id.clone(),
            transcript_revision: 1,
            profile_hash: "profile-batch-hash".to_string(),
            task_version: "v1".to_string(),
            generation_epoch: "epoch-batch".to_string(),
            total_units: 20,
        })
        .await
        .unwrap();

        // Create 20 card drafts
        let mut specs = Vec::new();
        for i in 1..=20 {
            let draft_id = format!("draft-batch-{}", i);
            let content_hash = format!("hash-prov-{}", i);
            let draft = repo
                .create_learning_draft(&CreateSessionLearningDraft {
                    id: draft_id.clone(),
                    session_id: session_id.clone(),
                    run_id: Some("run-batch-test".to_string()),
                    kind: "card".to_string(),
                    status: Some("proposed".to_string()),
                    payload_json: serde_json::to_string(&serde_json::json!({
                        "itemType": "flashcard",
                        "question": format!("Question {}", i),
                        "answer": format!("Answer {}", i)
                    }))
                    .unwrap(),
                    evidence_json: "{}".to_string(),
                    content_hash: content_hash.clone(),
                    concept_key: None,
                    duplicate_json: None,
                })
                .await
                .unwrap();

            specs.push(AcceptSessionDraftSpec {
                draft_id: draft.id,
                expected_revision: 1,
                duplicate_decision: None,
                duplicate_target_id: None,
            });
        }

        // Install a trigger that aborts when item 10's provenance is inserted
        sqlx::query(
            r#"
            CREATE TRIGGER fail_item_10
            BEFORE INSERT ON ai_provenance
            WHEN NEW.input_fingerprint = 'hash-prov-10'
            BEGIN
                SELECT RAISE(ABORT, 'Simulated provenance failure for item 10');
            END;
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        // 1. Test all_or_nothing: true -> whole 20-item batch rolls back
        let all_res = repo
            .accept_session_drafts(&AcceptSessionDraftsInput {
                session_id: session_id.clone(),
                items: specs.clone(),
                provider: Some("prov".to_string()),
                model: Some("model".to_string()),
                all_or_nothing: Some(true),
            })
            .await
            .unwrap();

        assert_eq!(all_res.accepted_count, 0);
        assert_eq!(all_res.failed_count, 20);

        // 0 learning items in DB
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);

        // All 20 drafts are still proposed
        let proposed_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM session_learning_drafts WHERE status = 'proposed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(proposed_count, 20);

        // 2. Test all_or_nothing: false -> 19 succeed, only item 10 rolls back
        let per_item_res = repo
            .accept_session_drafts(&AcceptSessionDraftsInput {
                session_id: session_id.clone(),
                items: specs.clone(),
                provider: Some("prov".to_string()),
                model: Some("model".to_string()),
                all_or_nothing: Some(false),
            })
            .await
            .unwrap();

        assert_eq!(per_item_res.accepted_count, 19);
        assert_eq!(per_item_res.failed_count, 1);
        assert_eq!(per_item_res.results[9].success, false); // index 9 is item 10

        // Exactly 19 cards in DB
        let cards_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cards_count, 19);

        // Draft 10 is still proposed, others are accepted
        let draft_10 = repo
            .get_learning_draft("draft-batch-10")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(draft_10.status, "proposed");
        assert_eq!(draft_10.accepted_target_id, None);
    }
}
