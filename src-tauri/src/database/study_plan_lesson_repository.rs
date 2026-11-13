//! Versioned Study Plan lesson repository.
//!
//! Implements the durable lesson checkpoint semantics: expected-revision CAS,
//! idempotent duplicate delivery by request id, and restart restoration of the
//! last committed prompt/answer/hint state.

use crate::models::study_plan_lesson::{
    CreateStudyPlanLessonInput, LessonStyle, SaveStudyPlanLessonCheckpointInput, StudyPlanLesson,
};
use crate::models::study_source::{StudyCommandError, StudyErrorCode};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

#[derive(Clone)]
pub struct StudyPlanLessonRepository {
    pool: Pool<Sqlite>,
}

impl StudyPlanLessonRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_lesson(row: &sqlx::sqlite::SqliteRow) -> StudyPlanLesson {
        StudyPlanLesson {
            id: row.get("id"),
            plan_id: row.get("plan_id"),
            plan_version_id: row.get("plan_version_id"),
            node_id: row.get("node_id"),
            objective_index: row.get("objective_index"),
            style: match row.get::<String, _>("style").as_str() {
                "explain-check" => LessonStyle::ExplainCheck,
                "challenge" => LessonStyle::Challenge,
                _ => LessonStyle::Guided,
            },
            knowledge_authority_json: row.get("knowledge_authority_json"),
            source_revision_snapshot: row.get("source_revision_snapshot"),
            prompt_text: row.get("prompt_text"),
            answer_draft: row.get("answer_draft"),
            hint_count: row.get("hint_count"),
            turn_count: row.get("turn_count"),
            turn_state_json: row.get("turn_state_json"),
            revision: row.get("revision"),
            last_turn_request_id: row.get("last_turn_request_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    /// Creates a lesson for a plan version + node + objective. Reopening the
    /// same key returns the existing lesson (idempotent start).
    pub async fn create_lesson(
        &self,
        input: CreateStudyPlanLessonInput,
    ) -> Result<StudyPlanLesson, StudyCommandError> {
        let existing = sqlx::query(
            "SELECT * FROM study_plan_lessons
             WHERE plan_version_id = ?1 AND node_id = ?2 AND objective_index = ?3 LIMIT 1",
        )
        .bind(&input.plan_version_id)
        .bind(&input.node_id)
        .bind(input.objective_index)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if let Some(row) = existing {
            return Ok(Self::row_to_lesson(&row));
        }

        let id = format!("spl_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let authority = input.knowledge_authority_json.unwrap_or_else(|| {
            "{\"kind\":\"library\",\"policy\":\"source-only\"}".to_string()
        });
        let style = match input.style.unwrap_or_default() {
            LessonStyle::ExplainCheck => "explain-check".to_string(),
            LessonStyle::Challenge => "challenge".to_string(),
            LessonStyle::Guided => "guided".to_string(),
        };
        let prompt = input.prompt_text.unwrap_or_default();
        let snapshot = input.source_revision_snapshot.unwrap_or_default();

        sqlx::query(
            r#"
            INSERT INTO study_plan_lessons (
                id, plan_id, plan_version_id, node_id, objective_index, style,
                knowledge_authority_json, source_revision_snapshot, prompt_text,
                answer_draft, hint_count, turn_count, turn_state_json, revision,
                last_turn_request_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', 0, 0, '{}', 1, NULL, ?10, ?10)
            "#,
        )
        .bind(&id)
        .bind(&input.plan_id)
        .bind(&input.plan_version_id)
        .bind(&input.node_id)
        .bind(input.objective_index)
        .bind(style)
        .bind(authority)
        .bind(snapshot)
        .bind(prompt)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_lesson(&id).await?.ok_or_else(|| {
            StudyCommandError::new(
                StudyErrorCode::InternalError,
                "study_plan.error.lesson_not_found",
                false,
            )
        })
    }

    pub async fn get_lesson(
        &self,
        lesson_id: &str,
    ) -> Result<Option<StudyPlanLesson>, StudyCommandError> {
        let row = sqlx::query("SELECT * FROM study_plan_lessons WHERE id = ?1 LIMIT 1")
            .bind(lesson_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(row.map(|r| Self::row_to_lesson(&r)))
    }

    pub async fn list_lessons_for_node(
        &self,
        plan_version_id: &str,
        node_id: &str,
    ) -> Result<Vec<StudyPlanLesson>, StudyCommandError> {
        let rows = sqlx::query(
            "SELECT * FROM study_plan_lessons
             WHERE plan_version_id = ?1 AND node_id = ?2 ORDER BY objective_index ASC",
        )
        .bind(plan_version_id)
        .bind(node_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(rows.iter().map(Self::row_to_lesson).collect())
    }

    /// Saves a checkpoint under an expected revision (CAS). Duplicate delivery
    /// of the same turn request id with the same payload is a no-op that
    /// returns the current row without bumping the revision.
    pub async fn save_checkpoint(
        &self,
        input: SaveStudyPlanLessonCheckpointInput,
    ) -> Result<StudyPlanLesson, StudyCommandError> {
        let current = self
            .get_lesson(&input.lesson_id)
            .await?
            .ok_or_else(|| {
                StudyCommandError::new(
                    StudyErrorCode::NotFound,
                    "study_plan.error.lesson_not_found",
                    false,
                )
            })?;

        if current.revision != input.expected_revision {
            let mut details = crate::models::study_source::StudyCommandErrorDetails::default();
            details.expected_revision = Some(input.expected_revision);
            details.actual_revision = Some(current.revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        // Idempotent duplicate delivery: identical request id + identical payload.
        if let Some(ref request_id) = input.turn_request_id {
            if current.last_turn_request_id.as_deref() == Some(request_id.as_str())
                && input.prompt_text.as_deref() == Some(current.prompt_text.as_str())
                && input.answer_draft.as_deref() == Some(current.answer_draft.as_str())
                && input.hint_count.unwrap_or(current.hint_count) == current.hint_count
                && input.turn_count.unwrap_or(current.turn_count) == current.turn_count
            {
                return Ok(current);
            }
        }

        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            r#"
            UPDATE study_plan_lessons SET
                revision = revision + 1,
                prompt_text = COALESCE(?1, prompt_text),
                answer_draft = COALESCE(?2, answer_draft),
                hint_count = COALESCE(?3, hint_count),
                turn_count = COALESCE(?4, turn_count),
                turn_state_json = COALESCE(?5, turn_state_json),
                style = ?6,
                last_turn_request_id = ?7,
                updated_at = ?8
            WHERE id = ?9 AND revision = ?10
            "#,
        )
        .bind(input.prompt_text)
        .bind(input.answer_draft)
        .bind(input.hint_count)
        .bind(input.turn_count)
        .bind(input.turn_state_json)
        .bind(match input.style.unwrap_or(current.style) {
            LessonStyle::ExplainCheck => "explain-check".to_string(),
            LessonStyle::Challenge => "challenge".to_string(),
            LessonStyle::Guided => "guided".to_string(),
        })
        .bind(&input.turn_request_id)
        .bind(&now)
        .bind(&input.lesson_id)
        .bind(input.expected_revision)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if updated.rows_affected() == 0 {
            let mut details = crate::models::study_source::StudyCommandErrorDetails::default();
            details.expected_revision = Some(input.expected_revision);
            details.actual_revision = Some(current.revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        self.get_lesson(&input.lesson_id).await?.ok_or_else(|| {
            StudyCommandError::new(
                StudyErrorCode::InternalError,
                "study_plan.error.lesson_not_found",
                false,
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_db() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::migrations::run_migrations(&pool).await.unwrap();
        pool
    }

    fn create_input() -> CreateStudyPlanLessonInput {
        CreateStudyPlanLessonInput {
            plan_id: "sp_1".to_string(),
            plan_version_id: "spv_1".to_string(),
            node_id: "spn_1".to_string(),
            objective_index: 0,
            style: Some(LessonStyle::Guided),
            knowledge_authority_json: Some("{\"kind\":\"model-only\"}".to_string()),
            source_revision_snapshot: Some(String::new()),
            prompt_text: Some("Explain the trade-off.".to_string()),
        }
    }

    #[tokio::test]
    async fn test_create_restart_and_idempotent_duplicate_delivery() {
        let pool = create_test_db().await;
        let repo = StudyPlanLessonRepository::new(pool);

        let created = repo.create_lesson(create_input()).await.unwrap();
        assert_eq!(created.revision, 1);
        assert_eq!(created.hint_count, 0);
        assert_eq!(created.style, LessonStyle::Guided);

        // Reopen the same key returns the existing lesson (Start is idempotent).
        let reopened = repo.create_lesson(create_input()).await.unwrap();
        assert_eq!(reopened.id, created.id);
        assert_eq!(reopened.revision, 1);

        // First checkpoint: learner answered partway and revealed two hints.
        let saved = repo
            .save_checkpoint(SaveStudyPlanLessonCheckpointInput {
                lesson_id: created.id.clone(),
                expected_revision: 1,
                turn_request_id: Some("turn_1".to_string()),
                prompt_text: Some("Explain the trade-off.".to_string()),
                answer_draft: Some("The trade-off is between…".to_string()),
                hint_count: Some(2),
                turn_count: Some(1),
                turn_state_json: Some("{\"probes\":1}".to_string()),
                style: None,
            })
            .await
            .unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.hint_count, 2);
        assert_eq!(saved.last_turn_request_id.as_deref(), Some("turn_1"));

        // Duplicate delivery of the same request + payload is a no-op.
        let duplicate = repo
            .save_checkpoint(SaveStudyPlanLessonCheckpointInput {
                lesson_id: created.id.clone(),
                expected_revision: 2,
                turn_request_id: Some("turn_1".to_string()),
                prompt_text: Some("Explain the trade-off.".to_string()),
                answer_draft: Some("The trade-off is between…".to_string()),
                hint_count: Some(2),
                turn_count: Some(1),
                turn_state_json: Some("{\"probes\":1}".to_string()),
                style: None,
            })
            .await
            .unwrap();
        assert_eq!(duplicate.revision, 2);

        // Stale expected revision is rejected.
        let stale = repo
            .save_checkpoint(SaveStudyPlanLessonCheckpointInput {
                lesson_id: created.id.clone(),
                expected_revision: 1,
                turn_request_id: Some("turn_2".to_string()),
                prompt_text: None,
                answer_draft: Some("different".to_string()),
                hint_count: None,
                turn_count: None,
                turn_state_json: None,
                style: None,
            })
            .await
            .unwrap_err();
        assert_eq!(stale.code, StudyErrorCode::StaleRevision);

        // Restart restores last committed state (draft answer + hints).
        let restored = repo.get_lesson(&created.id).await.unwrap().unwrap();
        assert_eq!(restored.answer_draft, "The trade-off is between…");
        assert_eq!(restored.hint_count, 2);
        assert_eq!(restored.turn_count, 1);
    }

    #[tokio::test]
    async fn test_style_switch_and_list_for_node() {
        let pool = create_test_db().await;
        let repo = StudyPlanLessonRepository::new(pool);
        let created = repo.create_lesson(create_input()).await.unwrap();

        let switched = repo
            .save_checkpoint(SaveStudyPlanLessonCheckpointInput {
                lesson_id: created.id.clone(),
                expected_revision: 1,
                turn_request_id: Some("turn_s".to_string()),
                prompt_text: None,
                answer_draft: None,
                hint_count: None,
                turn_count: None,
                turn_state_json: None,
                style: Some(LessonStyle::Challenge),
            })
            .await
            .unwrap();
        assert_eq!(switched.style, LessonStyle::Challenge);
        assert_eq!(switched.turn_count, 0); // historical turns unchanged

        let listed = repo
            .list_lessons_for_node("spv_1", "spn_1")
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
    }
}
