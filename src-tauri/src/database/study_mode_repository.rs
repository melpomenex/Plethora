use crate::error::{PlethoraError, Result};
use crate::models::study_mode::{
    CreateStudyFormativeQuestionInput, RecordStudyEfficacyEventInput, SaveStudyModeArtifactInput,
    StudyFormativeQuestionClientView, StudyFormativeSubmissionResult, StudyLearnerPreference,
    StudyModeArtifact, StudyModeScopeKind, StudyModeSession, SubmitStudyFormativeAnswerInput,
    UpsertStudyLearnerPreferenceInput, UpsertStudyModeSessionInput,
};
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct StudyModeRepository;

impl StudyModeRepository {
    pub async fn upsert_session(
        pool: &SqlitePool,
        input: UpsertStudyModeSessionInput,
    ) -> Result<StudyModeSession> {
        if StudyModeScopeKind::from_str(&input.scope_kind).is_none() {
            return Err(PlethoraError::Validation(format!(
                "Invalid scope_kind: {}",
                input.scope_kind
            )));
        }
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let authority = input
            .knowledge_authority
            .unwrap_or_else(|| "source-only".to_string());
        let active_view = input.active_view.unwrap_or_else(|| "learn".to_string());

        sqlx::query(
            r#"
            INSERT INTO study_mode_sessions (
                id, scope_kind, scope_key, document_id, study_plan_id, plan_version_id,
                topic_id, segment_id, source_revision, knowledge_authority,
                active_view, last_locator_json, status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?13)
            ON CONFLICT(id) DO UPDATE SET
                scope_key = COALESCE(excluded.scope_key, study_mode_sessions.scope_key),
                source_revision = excluded.source_revision,
                knowledge_authority = excluded.knowledge_authority,
                active_view = excluded.active_view,
                last_locator_json = COALESCE(excluded.last_locator_json, study_mode_sessions.last_locator_json),
                status = 'active',
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(&input.scope_kind)
        .bind(&input.scope_key)
        .bind(&input.document_id)
        .bind(&input.study_plan_id)
        .bind(&input.plan_version_id)
        .bind(&input.topic_id)
        .bind(&input.segment_id)
        .bind(&input.source_revision)
        .bind(&authority)
        .bind(&active_view)
        .bind(&input.last_locator_json)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::get_session(pool, &id).await
    }

    pub async fn get_session(pool: &SqlitePool, id: &str) -> Result<StudyModeSession> {
        let row = sqlx::query(
            r#"
            SELECT id, scope_kind, scope_key, document_id, study_plan_id, plan_version_id,
                   topic_id, segment_id, source_revision, knowledge_authority,
                   active_view, last_locator_json, status, created_at, updated_at
            FROM study_mode_sessions
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("StudyModeSession {} not found", id)))?;

        Ok(StudyModeSession {
            id: row.get("id"),
            scope_kind: row.get("scope_kind"),
            scope_key: row.get("scope_key"),
            document_id: row.get("document_id"),
            study_plan_id: row.get("study_plan_id"),
            plan_version_id: row.get("plan_version_id"),
            topic_id: row.get("topic_id"),
            segment_id: row.get("segment_id"),
            source_revision: row.get("source_revision"),
            knowledge_authority: row.get("knowledge_authority"),
            active_view: row.get("active_view"),
            last_locator_json: row.get("last_locator_json"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn find_session_by_scope(
        pool: &SqlitePool,
        scope_kind: &str,
        scope_key: Option<&str>,
        document_id: Option<&str>,
        study_plan_id: Option<&str>,
        topic_id: Option<&str>,
        segment_id: Option<&str>,
    ) -> Result<Option<StudyModeSession>> {
        if let Some(sk) = scope_key.filter(|s| !s.trim().is_empty()) {
            let row = sqlx::query(
                r#"
                SELECT id, scope_kind, scope_key, document_id, study_plan_id, plan_version_id,
                       topic_id, segment_id, source_revision, knowledge_authority,
                       active_view, last_locator_json, status, created_at, updated_at
                FROM study_mode_sessions
                WHERE scope_key = ?1
                ORDER BY updated_at DESC
                LIMIT 1
                "#,
            )
            .bind(sk)
            .fetch_optional(pool)
            .await?;

            if let Some(row) = row {
                return Ok(Some(StudyModeSession {
                    id: row.get("id"),
                    scope_kind: row.get("scope_kind"),
                    scope_key: row.get("scope_key"),
                    document_id: row.get("document_id"),
                    study_plan_id: row.get("study_plan_id"),
                    plan_version_id: row.get("plan_version_id"),
                    topic_id: row.get("topic_id"),
                    segment_id: row.get("segment_id"),
                    source_revision: row.get("source_revision"),
                    knowledge_authority: row.get("knowledge_authority"),
                    active_view: row.get("active_view"),
                    last_locator_json: row.get("last_locator_json"),
                    status: row.get("status"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }));
            }
        }

        let row = sqlx::query(
            r#"
            SELECT id, scope_kind, scope_key, document_id, study_plan_id, plan_version_id,
                   topic_id, segment_id, source_revision, knowledge_authority,
                   active_view, last_locator_json, status, created_at, updated_at
            FROM study_mode_sessions
            WHERE scope_kind = ?1
              AND COALESCE(document_id, '') = COALESCE(?2, '')
              AND COALESCE(study_plan_id, '') = COALESCE(?3, '')
              AND COALESCE(topic_id, '') = COALESCE(?4, '')
              AND COALESCE(segment_id, '') = COALESCE(?5, '')
              AND scope_key IS NULL
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(scope_kind)
        .bind(document_id)
        .bind(study_plan_id)
        .bind(topic_id)
        .bind(segment_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|row| StudyModeSession {
            id: row.get("id"),
            scope_kind: row.get("scope_kind"),
            scope_key: row.get("scope_key"),
            document_id: row.get("document_id"),
            study_plan_id: row.get("study_plan_id"),
            plan_version_id: row.get("plan_version_id"),
            topic_id: row.get("topic_id"),
            segment_id: row.get("segment_id"),
            source_revision: row.get("source_revision"),
            knowledge_authority: row.get("knowledge_authority"),
            active_view: row.get("active_view"),
            last_locator_json: row.get("last_locator_json"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    }

    pub async fn save_artifact(
        pool: &SqlitePool,
        input: SaveStudyModeArtifactInput,
    ) -> Result<StudyModeArtifact> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let schema_version = input.schema_version.unwrap_or(1);
        let source_ids_json = serde_json::to_string(&input.source_ids)?;
        let anchors_json = serde_json::to_string(&input.anchors)?;
        let segment_ids_json = serde_json::to_string(&input.segment_ids)?;
        let concept_ids_json = serde_json::to_string(&input.concept_ids)?;
        let objective_ids_json = serde_json::to_string(&input.objective_ids)?;
        let quality_eval_json = input
            .quality_eval
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let payload_json = serde_json::to_string(&input.payload)?;
        let pref_fp = input.preference_fingerprint.unwrap_or_default();
        let task_version = input.task_version.unwrap_or_else(|| "1".to_string());
        let prompt_version = input.prompt_version.unwrap_or_else(|| "1".to_string());
        let is_locked = if input.is_locked.unwrap_or(false) { 1 } else { 0 };

        sqlx::query(
            r#"
            INSERT INTO study_mode_artifacts (
                id, session_id, artifact_type, schema_version, scope_key,
                source_ids_json, source_revision, anchors_json, segment_ids_json,
                concept_ids_json, objective_ids_json, plan_id, plan_version_id,
                preference_fingerprint, task_id, task_version, prompt_version,
                provider_id, model_id, knowledge_authority, validation_status,
                quality_eval_json, payload_json, is_stale, is_locked, dismissed,
                created_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21,
                ?22, ?23, 0, ?24, 0,
                ?25, ?25
            )
            ON CONFLICT(id) DO UPDATE SET
                source_revision = excluded.source_revision,
                anchors_json = excluded.anchors_json,
                validation_status = excluded.validation_status,
                quality_eval_json = excluded.quality_eval_json,
                payload_json = excluded.payload_json,
                is_stale = 0,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(&input.session_id)
        .bind(&input.artifact_type)
        .bind(schema_version)
        .bind(&input.scope_key)
        .bind(&source_ids_json)
        .bind(&input.source_revision)
        .bind(&anchors_json)
        .bind(&segment_ids_json)
        .bind(&concept_ids_json)
        .bind(&objective_ids_json)
        .bind(&input.plan_id)
        .bind(&input.plan_version_id)
        .bind(&pref_fp)
        .bind(&input.task_id)
        .bind(&task_version)
        .bind(&prompt_version)
        .bind(&input.provider_id)
        .bind(&input.model_id)
        .bind(&input.knowledge_authority)
        .bind(&input.validation_status)
        .bind(&quality_eval_json)
        .bind(&payload_json)
        .bind(is_locked)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::get_artifact(pool, &id).await
    }

    pub async fn get_artifact(pool: &SqlitePool, id: &str) -> Result<StudyModeArtifact> {
        let row = sqlx::query(
            r#"
            SELECT id, session_id, artifact_type, schema_version, scope_key,
                   source_ids_json, source_revision, anchors_json, segment_ids_json,
                   concept_ids_json, objective_ids_json, plan_id, plan_version_id,
                   preference_fingerprint, task_id, task_version, prompt_version,
                   provider_id, model_id, knowledge_authority, validation_status,
                   quality_eval_json, payload_json, is_stale, is_locked, dismissed,
                   created_at, updated_at
            FROM study_mode_artifacts
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("StudyModeArtifact {} not found", id)))?;

        Self::map_artifact_row(&row)
    }

    pub async fn list_artifacts_for_scope(
        pool: &SqlitePool,
        scope_key: &str,
        include_dismissed: bool,
    ) -> Result<Vec<StudyModeArtifact>> {
        let query = if include_dismissed {
            r#"
            SELECT id, session_id, artifact_type, schema_version, scope_key,
                   source_ids_json, source_revision, anchors_json, segment_ids_json,
                   concept_ids_json, objective_ids_json, plan_id, plan_version_id,
                   preference_fingerprint, task_id, task_version, prompt_version,
                   provider_id, model_id, knowledge_authority, validation_status,
                   quality_eval_json, payload_json, is_stale, is_locked, dismissed,
                   created_at, updated_at
            FROM study_mode_artifacts
            WHERE scope_key = ?1
            ORDER BY created_at DESC
            "#
        } else {
            r#"
            SELECT id, session_id, artifact_type, schema_version, scope_key,
                   source_ids_json, source_revision, anchors_json, segment_ids_json,
                   concept_ids_json, objective_ids_json, plan_id, plan_version_id,
                   preference_fingerprint, task_id, task_version, prompt_version,
                   provider_id, model_id, knowledge_authority, validation_status,
                   quality_eval_json, payload_json, is_stale, is_locked, dismissed,
                   created_at, updated_at
            FROM study_mode_artifacts
            WHERE scope_key = ?1 AND dismissed = 0
            ORDER BY created_at DESC
            "#
        };
        let rows = sqlx::query(query).bind(scope_key).fetch_all(pool).await?;
        rows.iter().map(Self::map_artifact_row).collect()
    }

    pub async fn mark_scope_artifacts_stale(
        pool: &SqlitePool,
        scope_key: &str,
        current_revision: &str,
    ) -> Result<u64> {
        let now = Utc::now().to_rfc3339();
        let res = sqlx::query(
            r#"
            UPDATE study_mode_artifacts
            SET is_stale = 1, validation_status = 'stale', updated_at = ?1
            WHERE scope_key = ?2 AND source_revision != ?3 AND is_stale = 0
            "#,
        )
        .bind(&now)
        .bind(scope_key)
        .bind(current_revision)
        .execute(pool)
        .await?;
        Ok(res.rows_affected())
    }

    pub async fn dismiss_artifact(pool: &SqlitePool, artifact_id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE study_mode_artifacts SET dismissed = 1, updated_at = ?1 WHERE id = ?2")
            .bind(&now)
            .bind(artifact_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn restore_artifact(pool: &SqlitePool, artifact_id: &str) -> Result<StudyModeArtifact> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE study_mode_artifacts SET dismissed = 0, updated_at = ?1 WHERE id = ?2")
            .bind(&now)
            .bind(artifact_id)
            .execute(pool)
            .await?;
        Self::get_artifact(pool, artifact_id).await
    }

    pub async fn delete_artifact(pool: &SqlitePool, artifact_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM study_mode_artifacts WHERE id = ?1")
            .bind(artifact_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn delete_artifacts_for_scope(pool: &SqlitePool, scope_key: &str) -> Result<u64> {
        let res = sqlx::query("DELETE FROM study_mode_artifacts WHERE scope_key = ?1")
            .bind(scope_key)
            .execute(pool)
            .await?;
        Ok(res.rows_affected())
    }

    pub async fn upsert_learner_preference(
        pool: &SqlitePool,
        input: UpsertStudyLearnerPreferenceInput,
    ) -> Result<StudyLearnerPreference> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let subject_key = if input.subject_key.trim().is_empty() {
            "__global__".to_string()
        } else {
            input.subject_key.trim().to_lowercase()
        };
        let interests_json = serde_json::to_string(&input.interests.unwrap_or_default())?;
        let familiar_json = serde_json::to_string(&input.familiar_domains.unwrap_or_default())?;
        let explanation_detail = input
            .explanation_detail
            .unwrap_or_else(|| "balanced".to_string());
        let vocabulary_tolerance = input
            .vocabulary_tolerance
            .unwrap_or_else(|| "standard".to_string());
        let teaching_approach = input
            .teaching_approach
            .unwrap_or_else(|| "balanced".to_string());
        let example_preference = input
            .example_preference
            .unwrap_or_else(|| "everyday".to_string());
        let question_difficulty = input
            .question_difficulty
            .unwrap_or_else(|| "adaptive".to_string());

        sqlx::query(
            r#"
            INSERT INTO study_learner_preferences (
                id, subject_key, knowledge_level, interests_json, familiar_domains_json,
                explanation_detail, vocabulary_tolerance, explanation_language,
                teaching_approach, example_preference, question_difficulty, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(subject_key) DO UPDATE SET
                knowledge_level = excluded.knowledge_level,
                interests_json = excluded.interests_json,
                familiar_domains_json = excluded.familiar_domains_json,
                explanation_detail = excluded.explanation_detail,
                vocabulary_tolerance = excluded.vocabulary_tolerance,
                explanation_language = excluded.explanation_language,
                teaching_approach = excluded.teaching_approach,
                example_preference = excluded.example_preference,
                question_difficulty = excluded.question_difficulty,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(&subject_key)
        .bind(&input.knowledge_level)
        .bind(&interests_json)
        .bind(&familiar_json)
        .bind(&explanation_detail)
        .bind(&vocabulary_tolerance)
        .bind(&input.explanation_language)
        .bind(&teaching_approach)
        .bind(&example_preference)
        .bind(&question_difficulty)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::get_learner_preference(pool, &subject_key).await
    }

    pub async fn get_learner_preference(
        pool: &SqlitePool,
        subject_key: &str,
    ) -> Result<StudyLearnerPreference> {
        let key = subject_key.trim().to_lowercase();
        let row = sqlx::query(
            r#"
            SELECT id, subject_key, knowledge_level, interests_json, familiar_domains_json,
                   explanation_detail, vocabulary_tolerance, explanation_language,
                   teaching_approach, example_preference, question_difficulty, updated_at
            FROM study_learner_preferences
            WHERE subject_key = ?1
            "#,
        )
        .bind(&key)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            PlethoraError::NotFound(format!("StudyLearnerPreference {} not found", key))
        })?;

        Ok(StudyLearnerPreference {
            id: row.get("id"),
            subject_key: row.get("subject_key"),
            knowledge_level: row.get("knowledge_level"),
            interests: serde_json::from_str(row.get("interests_json")).unwrap_or_default(),
            familiar_domains: serde_json::from_str(row.get("familiar_domains_json"))
                .unwrap_or_default(),
            explanation_detail: row.get("explanation_detail"),
            vocabulary_tolerance: row.get("vocabulary_tolerance"),
            explanation_language: row.get("explanation_language"),
            teaching_approach: row.get("teaching_approach"),
            example_preference: row.get("example_preference"),
            question_difficulty: row.get("question_difficulty"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn list_learner_preferences(
        pool: &SqlitePool,
    ) -> Result<Vec<StudyLearnerPreference>> {
        let rows = sqlx::query(
            r#"
            SELECT id, subject_key, knowledge_level, interests_json, familiar_domains_json,
                   explanation_detail, vocabulary_tolerance, explanation_language,
                   teaching_approach, example_preference, question_difficulty, updated_at
            FROM study_learner_preferences
            ORDER BY subject_key ASC
            "#,
        )
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StudyLearnerPreference {
                id: row.get("id"),
                subject_key: row.get("subject_key"),
                knowledge_level: row.get("knowledge_level"),
                interests: serde_json::from_str(row.get("interests_json")).unwrap_or_default(),
                familiar_domains: serde_json::from_str(row.get("familiar_domains_json"))
                    .unwrap_or_default(),
                explanation_detail: row.get("explanation_detail"),
                vocabulary_tolerance: row.get("vocabulary_tolerance"),
                explanation_language: row.get("explanation_language"),
                teaching_approach: row.get("teaching_approach"),
                example_preference: row.get("example_preference"),
                question_difficulty: row.get("question_difficulty"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    pub async fn delete_learner_preference(pool: &SqlitePool, subject_key: &str) -> Result<()> {
        sqlx::query("DELETE FROM study_learner_preferences WHERE subject_key = ?1")
            .bind(subject_key.trim().to_lowercase())
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn create_formative_question(
        pool: &SqlitePool,
        input: CreateStudyFormativeQuestionInput,
    ) -> Result<StudyFormativeQuestionClientView> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let concept_ids_json = serde_json::to_string(&input.concept_ids)?;
        let objective_ids_json = serde_json::to_string(&input.objective_ids)?;
        let options_json = input
            .options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let answer_key_json = serde_json::to_string(&input.answer_key)?;
        let rubric_json = input
            .rubric
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let source_refs_json = serde_json::to_string(&input.source_refs)?;
        let provenance_json = serde_json::to_string(&input.provenance)?;
        let difficulty = input.difficulty.unwrap_or(2);

        sqlx::query(
            r#"
            INSERT INTO study_formative_questions (
                id, revision, scope_key, session_id, segment_id,
                concept_ids_json, objective_ids_json, question_kind, prompt,
                options_json, answer_key_json, rubric_json, difficulty,
                question_fingerprint, source_refs_json, knowledge_authority,
                provenance_json, created_at
            ) VALUES (
                ?1, 1, ?2, ?3, ?4,
                ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12,
                ?13, ?14, ?15,
                ?16, ?17
            )
            "#,
        )
        .bind(&id)
        .bind(&input.scope_key)
        .bind(&input.session_id)
        .bind(&input.segment_id)
        .bind(&concept_ids_json)
        .bind(&objective_ids_json)
        .bind(&input.question_kind)
        .bind(&input.prompt)
        .bind(&options_json)
        .bind(&answer_key_json)
        .bind(&rubric_json)
        .bind(difficulty)
        .bind(&input.question_fingerprint)
        .bind(&source_refs_json)
        .bind(&input.knowledge_authority)
        .bind(&provenance_json)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(StudyFormativeQuestionClientView {
            id,
            revision: 1,
            scope_key: input.scope_key,
            session_id: input.session_id,
            segment_id: input.segment_id,
            concept_ids: input.concept_ids,
            objective_ids: input.objective_ids,
            question_kind: input.question_kind,
            prompt: input.prompt,
            options: input.options,
            difficulty,
            question_fingerprint: input.question_fingerprint,
            source_refs: input.source_refs,
            knowledge_authority: input.knowledge_authority,
            created_at: now,
        })
    }

    pub async fn submit_formative_answer(
        pool: &SqlitePool,
        input: SubmitStudyFormativeAnswerInput,
    ) -> Result<StudyFormativeSubmissionResult> {
        if input.submission_key.trim().is_empty() {
            return Err(PlethoraError::Validation(
                "submission_key is required".to_string(),
            ));
        }

        // Idempotency check
        if let Some(existing) = sqlx::query(
            r#"
            SELECT id, submission_key, question_id, question_revision, outcome, score,
                   feedback, misconception_detected, grader_origin, evidence_recorded, created_at
            FROM study_formative_submissions
            WHERE submission_key = ?1
            "#,
        )
        .bind(&input.submission_key)
        .fetch_optional(pool)
        .await?
        {
            return Ok(StudyFormativeSubmissionResult {
                id: existing.get("id"),
                submission_key: existing.get("submission_key"),
                question_id: existing.get("question_id"),
                question_revision: existing.get("question_revision"),
                outcome: existing.get("outcome"),
                score: existing.get("score"),
                feedback: existing.get("feedback"),
                misconception_detected: existing.get("misconception_detected"),
                grader_origin: existing.get("grader_origin"),
                evidence_recorded: existing.get::<i64, _>("evidence_recorded") != 0,
                deduplicated: true,
                created_at: existing.get("created_at"),
            });
        }

        let q_row = sqlx::query(
            r#"
            SELECT revision, question_kind, answer_key_json, rubric_json,
                   concept_ids_json, question_fingerprint, knowledge_authority
            FROM study_formative_questions
            WHERE id = ?1
            "#,
        )
        .bind(&input.question_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            PlethoraError::NotFound(format!("Formative question {} not found", input.question_id))
        })?;

        let revision: i64 = q_row.get("revision");
        let question_kind: String = q_row.get("question_kind");
        let answer_key: serde_json::Value =
            serde_json::from_str(q_row.get("answer_key_json")).unwrap_or(serde_json::Value::Null);
        let rubric_opt: Option<serde_json::Value> = q_row
            .get::<Option<String>, _>("rubric_json")
            .and_then(|s| serde_json::from_str(&s).ok());
        let concept_ids: Vec<String> =
            serde_json::from_str(q_row.get("concept_ids_json")).unwrap_or_default();
        let question_fingerprint: String = q_row.get("question_fingerprint");
        let knowledge_authority: String = q_row.get("knowledge_authority");

        let (outcome, score, feedback, misconception, grader_origin) =
            if question_kind == "multiple_choice" {
                let correct_index = answer_key
                    .get("correctIndex")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| {
                        PlethoraError::Internal(
                            "Persisted multiple_choice question missing correctIndex".to_string(),
                        )
                    })?;
                let selected = input.selected_index.ok_or_else(|| {
                    PlethoraError::Validation(
                        "selected_index is required for multiple_choice".to_string(),
                    )
                })?;
                let explanation = answer_key
                    .get("explanation")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Review the cited source passage to verify this concept.");
                if selected == correct_index {
                    (
                        "understood".to_string(),
                        1.0,
                        explanation.to_string(),
                        None,
                        "deterministic".to_string(),
                    )
                } else {
                    let distractor_misconception = answer_key
                        .get("distractorMisconceptions")
                        .and_then(|m| m.get(selected.to_string()))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (
                        "needs_review".to_string(),
                        0.0,
                        format!("Incorrect selection. {}", explanation),
                        distractor_misconception,
                        "deterministic".to_string(),
                    )
                }
            } else if let Some(ai_score) = input.ai_rubric_score {
                let clamped = ai_score.clamp(0.0, 1.0);
                let out = if clamped >= 0.75 {
                    "understood"
                } else if clamped >= 0.4 {
                    "partial"
                } else {
                    "needs_review"
                };
                let fb = input
                    .ai_feedback
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "Evaluated against formative rubric.".to_string());
                (
                    out.to_string(),
                    clamped,
                    fb,
                    input.ai_misconception.clone(),
                    "ai".to_string(),
                )
            } else {
                // Deterministic rubric key-fact evaluation (never 8-word heuristic)
                let response = input.learner_response.as_deref().unwrap_or("").trim();
                let required_terms: Vec<String> = rubric_opt
                    .as_ref()
                    .and_then(|r| r.get("requiredKeyFacts"))
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_lowercase()))
                            .collect()
                    })
                    .unwrap_or_default();

                if response.is_empty() {
                    (
                        "needs_review".to_string(),
                        0.0,
                        "No answer was provided. Try explaining the core mechanism in your own words.".to_string(),
                        Some("empty_response".to_string()),
                        "deterministic".to_string(),
                    )
                } else if required_terms.is_empty() {
                    (
                        "partial".to_string(),
                        0.5,
                        "Recorded your response. Compare your explanation with the cited source passage to verify every qualification.".to_string(),
                        None,
                        "deterministic".to_string(),
                    )
                } else {
                    let lower = response.to_lowercase();
                    let matched = required_terms
                        .iter()
                        .filter(|term| lower.contains(term.as_str()))
                        .count();
                    let ratio = matched as f64 / required_terms.len() as f64;
                    if ratio >= 0.75 {
                        (
                            "understood".to_string(),
                            ratio,
                            format!(
                                "Your answer covers {} of {} key rubric elements.",
                                matched,
                                required_terms.len()
                            ),
                            None,
                            "deterministic".to_string(),
                        )
                    } else if ratio > 0.0 {
                        (
                            "partial".to_string(),
                            ratio,
                            format!(
                                "Partially correct ({} of {} key elements). Revisit the source passage for the missing qualifications.",
                                matched,
                                required_terms.len()
                            ),
                            None,
                            "deterministic".to_string(),
                        )
                    } else {
                        (
                            "needs_review".to_string(),
                            0.0,
                            "Your answer did not address the required rubric concepts. Revisit the source passage and try again.".to_string(),
                            Some("missing_core_concepts".to_string()),
                            "deterministic".to_string(),
                        )
                    }
                }
            };

        let now = Utc::now().to_rfc3339();
        let submission_id = Uuid::new_v4().to_string();
        let mut evidence_recorded = false;

        let mut tx = pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO study_formative_submissions (
                id, submission_key, question_id, question_revision, session_id,
                selected_index, learner_response, outcome, score, feedback,
                misconception_detected, grader_origin, evidence_recorded, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13)
            "#,
        )
        .bind(&submission_id)
        .bind(&input.submission_key)
        .bind(&input.question_id)
        .bind(revision)
        .bind(&input.session_id)
        .bind(input.selected_index)
        .bind(&input.learner_response)
        .bind(&outcome)
        .bind(score)
        .bind(&feedback)
        .bind(&misconception)
        .bind(&grader_origin)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        // Record into learning_evidence when requested and not model-only
        if input.record_evidence.unwrap_or(false)
            && knowledge_authority != "model-only"
            && !concept_ids.is_empty()
        {
            let group_id = format!(
                "formative:{}:{}",
                input.session_id.as_deref().unwrap_or(&input.question_id),
                now.get(0..10).unwrap_or("day")
            );
            let evidence_outcome = match outcome.as_str() {
                "understood" => "correct",
                "partial" => "partial",
                _ => {
                    if misconception.is_some() {
                        "misconception"
                    } else {
                        "incorrect"
                    }
                }
            };
            let hint_level = if input.used_hint.unwrap_or(false) { 1_i64 } else { 0_i64 };
            for cid in &concept_ids {
                let ev_id = Uuid::new_v4().to_string();
                let res = sqlx::query(
                    r#"
                    INSERT OR IGNORE INTO learning_evidence (
                        id, concept_id, concept_label, plan_id, node_id,
                        source_kind, source_id, grade_id, evidence_group_id,
                        question_fingerprint, observed_score, outcome, misconception,
                        learner_confidence, hint_level, grader_origin, occurred_at,
                        policy_version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, NULL, NULL,
                        'practice-check', ?4, NULL, ?5,
                        ?6, ?7, ?8, ?9,
                        ?10, ?11, ?12, ?13,
                        'evidence-v1', ?13, ?13
                    )
                    "#,
                )
                .bind(&ev_id)
                .bind(cid)
                .bind(cid)
                .bind(&submission_id)
                .bind(&group_id)
                .bind(&question_fingerprint)
                .bind(score)
                .bind(evidence_outcome)
                .bind(&misconception)
                .bind(input.confidence)
                .bind(hint_level)
                .bind(&grader_origin)
                .bind(&now)
                .execute(&mut *tx)
                .await;
                if let Ok(done) = res {
                    if done.rows_affected() > 0 {
                        evidence_recorded = true;
                    }
                }
            }
            if evidence_recorded {
                sqlx::query(
                    "UPDATE study_formative_submissions SET evidence_recorded = 1 WHERE id = ?1",
                )
                .bind(&submission_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;

        Ok(StudyFormativeSubmissionResult {
            id: submission_id,
            submission_key: input.submission_key,
            question_id: input.question_id,
            question_revision: revision,
            outcome,
            score,
            feedback,
            misconception_detected: misconception,
            grader_origin,
            evidence_recorded,
            deduplicated: false,
            created_at: now,
        })
    }

    pub async fn record_efficacy_event(
        pool: &SqlitePool,
        input: RecordStudyEfficacyEventInput,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let metadata_json = input
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?
            .unwrap_or_else(|| "{}".to_string());

        sqlx::query(
            r#"
            INSERT INTO study_efficacy_events (
                id, session_id, metric_kind, concept_id, score, latency_ms, cost_usd, metadata_json, recorded_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(&id)
        .bind(&input.session_id)
        .bind(&input.metric_kind)
        .bind(&input.concept_id)
        .bind(input.score)
        .bind(input.latency_ms)
        .bind(input.cost_usd)
        .bind(&metadata_json)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(id)
    }

    fn map_artifact_row(row: &sqlx::sqlite::SqliteRow) -> Result<StudyModeArtifact> {
        Ok(StudyModeArtifact {
            id: row.get("id"),
            session_id: row.get("session_id"),
            artifact_type: row.get("artifact_type"),
            schema_version: row.get("schema_version"),
            scope_key: row.get("scope_key"),
            source_ids: serde_json::from_str(row.get("source_ids_json")).unwrap_or_default(),
            source_revision: row.get("source_revision"),
            anchors: serde_json::from_str(row.get("anchors_json")).unwrap_or_default(),
            segment_ids: serde_json::from_str(row.get("segment_ids_json")).unwrap_or_default(),
            concept_ids: serde_json::from_str(row.get("concept_ids_json")).unwrap_or_default(),
            objective_ids: serde_json::from_str(row.get("objective_ids_json")).unwrap_or_default(),
            plan_id: row.get("plan_id"),
            plan_version_id: row.get("plan_version_id"),
            preference_fingerprint: row.get("preference_fingerprint"),
            task_id: row.get("task_id"),
            task_version: row.get("task_version"),
            prompt_version: row.get("prompt_version"),
            provider_id: row.get("provider_id"),
            model_id: row.get("model_id"),
            knowledge_authority: row.get("knowledge_authority"),
            validation_status: row.get("validation_status"),
            quality_eval: row
                .get::<Option<String>, _>("quality_eval_json")
                .and_then(|s| serde_json::from_str(&s).ok()),
            payload: serde_json::from_str(row.get("payload_json"))
                .unwrap_or(serde_json::Value::Null),
            is_stale: row.get::<i64, _>("is_stale") != 0,
            is_locked: row.get::<i64, _>("is_locked") != 0,
            dismissed: row.get::<i64, _>("dismissed") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn create_test_db() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn authoritative_mc_grading_ignores_client_tampering_and_is_idempotent() {
        let pool = create_test_db().await;

        let q = StudyModeRepository::create_formative_question(
            &pool,
            CreateStudyFormativeQuestionInput {
                id: None,
                scope_key: "doc:doc-1".to_string(),
                session_id: None,
                segment_id: None,
                concept_ids: vec!["concept-1".to_string()],
                objective_ids: vec!["obj-1".to_string()],
                question_kind: "multiple_choice".to_string(),
                prompt: "What does ATP synthase produce?".to_string(),
                options: Some(vec![
                    "Glucose".to_string(),
                    "ATP".to_string(),
                    "Oxygen".to_string(),
                ]),
                answer_key: json!({
                    "correctIndex": 1,
                    "explanation": "ATP synthase synthesizes ATP from ADP and Pi."
                }),
                rubric: None,
                difficulty: Some(2),
                question_fingerprint: "fp-atp-1".to_string(),
                source_refs: vec![],
                knowledge_authority: "source-only".to_string(),
                provenance: json!({}),
            },
        )
        .await
        .unwrap();

        // Client submits wrong index 0
        let wrong = StudyModeRepository::submit_formative_answer(
            &pool,
            SubmitStudyFormativeAnswerInput {
                submission_key: "sub-1".to_string(),
                question_id: q.id.clone(),
                session_id: None,
                selected_index: Some(0),
                learner_response: None,
                ai_rubric_score: None,
                ai_feedback: None,
                ai_misconception: None,
                confidence: Some(0.8),
                used_hint: Some(false),
                record_evidence: Some(true),
            },
        )
        .await
        .unwrap();
        assert_eq!(wrong.outcome, "needs_review");
        assert_eq!(wrong.score, 0.0);
        assert!(!wrong.deduplicated);
        assert!(wrong.evidence_recorded, "formative submission must record learning_evidence");

        let evidence_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_evidence WHERE source_kind = 'practice-check' AND source_id = ?1",
        )
        .bind(&wrong.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(evidence_count, 1);

        // Verify FSRS learning_items was not mutated
        let fsrs_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fsrs_count, 0);

        // Duplicate submission_key returns deduplicated result
        let dup = StudyModeRepository::submit_formative_answer(
            &pool,
            SubmitStudyFormativeAnswerInput {
                submission_key: "sub-1".to_string(),
                question_id: q.id.clone(),
                session_id: None,
                selected_index: Some(1),
                learner_response: None,
                ai_rubric_score: None,
                ai_feedback: None,
                ai_misconception: None,
                confidence: None,
                used_hint: None,
                record_evidence: Some(true),
            },
        )
        .await
        .unwrap();
        assert!(dup.deduplicated);
        assert_eq!(dup.id, wrong.id);
        assert_eq!(dup.outcome, "needs_review");
    }

    #[tokio::test]
    async fn artifact_staleness_and_preferences_round_trip() {
        let pool = create_test_db().await;

        let pref = StudyModeRepository::upsert_learner_preference(
            &pool,
            UpsertStudyLearnerPreferenceInput {
                subject_key: "Economics".to_string(),
                knowledge_level: Some("beginner".to_string()),
                interests: Some(vec!["cooking".to_string()]),
                familiar_domains: Some(vec!["computer science".to_string()]),
                explanation_detail: Some("detailed".to_string()),
                vocabulary_tolerance: None,
                explanation_language: None,
                teaching_approach: None,
                example_preference: None,
                question_difficulty: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(pref.subject_key, "economics");
        assert_eq!(pref.knowledge_level.as_deref(), Some("beginner"));

        let art = StudyModeRepository::save_artifact(
            &pool,
            SaveStudyModeArtifactInput {
                id: None,
                session_id: None,
                artifact_type: "explanation".to_string(),
                schema_version: Some(1),
                scope_key: "doc:doc-econ".to_string(),
                source_ids: vec!["doc-econ".to_string()],
                source_revision: "rev-1".to_string(),
                anchors: vec![],
                segment_ids: vec![],
                concept_ids: vec![],
                objective_ids: vec![],
                plan_id: None,
                plan_version_id: None,
                preference_fingerprint: None,
                task_id: "study-mode-generate-component".to_string(),
                task_version: None,
                prompt_version: None,
                provider_id: Some("local".to_string()),
                model_id: Some("test".to_string()),
                knowledge_authority: "source-only".to_string(),
                validation_status: "verified".to_string(),
                quality_eval: None,
                payload: json!({ "summary": "Supply and demand" }),
                is_locked: None,
            },
        )
        .await
        .unwrap();
        assert!(!art.is_stale);

        let staled = StudyModeRepository::mark_scope_artifacts_stale(&pool, "doc:doc-econ", "rev-2")
            .await
            .unwrap();
        assert_eq!(staled, 1);
        let reloaded = StudyModeRepository::get_artifact(&pool, &art.id)
            .await
            .unwrap();
        assert!(reloaded.is_stale);
        assert_eq!(reloaded.validation_status, "stale");
    }

    #[tokio::test]
    async fn sessions_isolate_distinct_scope_keys_on_same_document() {
        let pool = create_test_db().await;

        let s1 = StudyModeRepository::upsert_session(
            &pool,
            UpsertStudyModeSessionInput {
                id: None,
                scope_kind: "standalone_document".to_string(),
                scope_key: Some("doc:book-1|scope:ch1".to_string()),
                document_id: None,
                study_plan_id: None,
                plan_version_id: None,
                topic_id: None,
                segment_id: None,
                source_revision: "rev-1".to_string(),
                knowledge_authority: Some("source-only".to_string()),
                active_view: Some("learn".to_string()),
                last_locator_json: None,
            },
        )
        .await
        .unwrap();

        let s2 = StudyModeRepository::upsert_session(
            &pool,
            UpsertStudyModeSessionInput {
                id: None,
                scope_kind: "standalone_document".to_string(),
                scope_key: Some("doc:book-1|scope:ch2".to_string()),
                document_id: None,
                study_plan_id: None,
                plan_version_id: None,
                topic_id: None,
                segment_id: None,
                source_revision: "rev-1".to_string(),
                knowledge_authority: Some("source-only".to_string()),
                active_view: Some("practice".to_string()),
                last_locator_json: None,
            },
        )
        .await
        .unwrap();

        assert_ne!(s1.id, s2.id);

        let found1 = StudyModeRepository::find_session_by_scope(
            &pool,
            "standalone_document",
            Some("doc:book-1|scope:ch1"),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(found1.id, s1.id);
        assert_eq!(found1.active_view, "learn");

        let found2 = StudyModeRepository::find_session_by_scope(
            &pool,
            "standalone_document",
            Some("doc:book-1|scope:ch2"),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(found2.id, s2.id);
        assert_eq!(found2.active_view, "practice");
    }
}
