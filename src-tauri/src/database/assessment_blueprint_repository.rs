//! Assessment blueprint repository: draft management, question persistence, and publication invariants.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§4–6, §11, §12
//! - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §5
//! - openspec/changes/generate-study-plan-examinations/ (C3-T04)

use crate::models::assessment_blueprint::{
    AssessmentBlueprint, AssessmentMode, AssessmentQuestionRevision, BlueprintDetail,
    BlueprintLifecycle, BlueprintRevision, BlueprintState, BlueprintSummary, CreateBlueprintInput,
    QuestionKind, QuestionSourceLink, QuestionTargetInput, QuestionTargetLink,
    SaveBlueprintDraftInput, SaveQuestionDraftInput,
};
use crate::models::study_source::{FieldIssue, StudyCommandError, StudyErrorCode};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

pub const MAX_BLUEPRINT_TITLE_CHARS: usize = 160;
pub const DIAGNOSTIC_MIN_COUNT: i64 = 4;
pub const DIAGNOSTIC_MAX_COUNT: i64 = 12;

/// C7-T01 narrow validation: diagnostic counts 4-12, essay rejected, timer null;
/// practice timer null. Enforced on create/save/publish even without UI.
fn validate_mode_config(config: &serde_json::Value) -> Result<(), StudyCommandError> {
    let mode = config
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("exam");
    let invalid = |path: &str, code: &str| {
        StudyCommandError::invalid_input(
            "study.assessment.error.invalid_config",
            vec![FieldIssue {
                path: path.to_string(),
                code: code.to_string(),
                message_key: "study.assessment.error.invalid_config".to_string(),
            }],
        )
    };
    if mode == "diagnostic" {
        let count = config
            .get("requestedCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(6);
        if !(DIAGNOSTIC_MIN_COUNT..=DIAGNOSTIC_MAX_COUNT).contains(&count) {
            return Err(invalid("requestedCount", "invalid_count"));
        }
        if let Some(weights) = config.get("typeWeights").and_then(|v| v.as_object()) {
            for (kind, w) in weights {
                let weight = w.as_i64().unwrap_or(0);
                if weight > 0 && kind == "essay" {
                    return Err(invalid("typeWeights.essay", "essay_rejected"));
                }
            }
        }
        if let Some(t) = config.get("timeLimitSeconds") {
            if !t.is_null() {
                return Err(invalid("timeLimitSeconds", "timer_rejected"));
            }
        }
    }
    if mode == "practice" {
        if let Some(t) = config.get("timeLimitSeconds") {
            if !t.is_null() {
                return Err(invalid("timeLimitSeconds", "timer_rejected"));
            }
        }
    }
    Ok(())
}

fn storage_err(msg: &str, err: impl std::fmt::Display) -> StudyCommandError {
    StudyCommandError::storage_failed(format!("{}: {}", msg, err))
}

fn stale_rev_err(expected: i64, actual: i64) -> StudyCommandError {
    let mut err = StudyCommandError::stale_revision("study.assessment.error.stale_revision");
    let mut details = crate::models::study_source::StudyCommandErrorDetails::default();
    details.expected_revision = Some(expected);
    details.actual_revision = Some(actual);
    err.details = Some(details);
    err
}

fn quota_shortfall_err(requested: i64, accepted: i64) -> StudyCommandError {
    let mut err = StudyCommandError::quota_shortfall("study.assessment.error.quota_shortfall");
    let mut details = crate::models::study_source::StudyCommandErrorDetails::default();
    details.requested = Some(requested as i32);
    details.valid = Some(accepted as i32);
    err.details = Some(details);
    err
}

#[derive(Clone)]
pub struct AssessmentBlueprintRepository {
    pool: Pool<Sqlite>,
}

impl AssessmentBlueprintRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Creates a new Assessment Blueprint with an initial Draft revision atomically.
    pub async fn create_assessment_blueprint(
        &self,
        input: CreateBlueprintInput,
    ) -> Result<BlueprintDetail, StudyCommandError> {
        let title = input.title.trim();
        if title.is_empty() || title.len() > MAX_BLUEPRINT_TITLE_CHARS {
            return Err(StudyCommandError::invalid_input(
                "study.assessment.error.invalid_title_length",
                vec![FieldIssue {
                    path: "title".to_string(),
                    code: "invalid_length".to_string(),
                    message_key: "study.assessment.error.invalid_title_length".to_string(),
                }],
            ));
        }

        let blueprint_id = format!("ab_{}", Uuid::new_v4().simple());
        let revision_id = format!("abr_{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| storage_err("Failed to begin transaction", e))?;

        // 1. Insert blueprint
        sqlx::query(
            "INSERT INTO assessment_blueprints (
                id, plan_id, title, current_revision_id, lifecycle, revision, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, 'active', 1, ?, ?)",
        )
        .bind(&blueprint_id)
        .bind(&input.plan_id)
        .bind(title)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to insert blueprint", e))?;

        // Extract requested count from config
        validate_mode_config(&input.config)?;
        let requested_count = input
            .config
            .get("requestedCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(10);

        let initial_quota = serde_json::json!({
            "requested": requested_count,
            "accepted": 0,
            "slots": [],
            "deficits": [],
            "shortfallAccepted": false,
            "duplicateQuestionFingerprints": [],
            "validationIssues": []
        });

        let default_scoring = serde_json::json!({
            "schemaVersion": 1,
            "singleSelect": "exact-option",
            "multiSelect": "exact-set-all-or-nothing",
            "cloze": "equal-per-blank",
            "shortAnswer": "accepted-exact-then-rubric",
            "essay": "analytic-rubric",
            "unanswered": "zero",
            "skipped": "zero",
            "negativeMarking": false
        });

        // 2. Insert draft revision
        sqlx::query(
            "INSERT INTO assessment_blueprint_revisions (
                id, blueprint_id, revision, state, plan_version_id, config_json, scoring_json,
                source_scope_json, quota_json, generation_job_id, source_snapshot_hash, created_at
            ) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(&revision_id)
        .bind(&blueprint_id)
        .bind(&input.plan_version_id)
        .bind(serde_json::to_string(&input.config).unwrap_or_else(|_| "{}".to_string()))
        .bind(serde_json::to_string(&default_scoring).unwrap())
        .bind(serde_json::to_string(&input.source_scope).unwrap_or_else(|_| "{}".to_string()))
        .bind(serde_json::to_string(&initial_quota).unwrap())
        .bind(&input.source_snapshot_hash)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to insert revision", e))?;

        tx.commit()
            .await
            .map_err(|e| storage_err("Failed to commit blueprint", e))?;

        self.get_assessment_blueprint_revision(&revision_id).await
    }

    /// Fetches a BlueprintDetail by revision ID.
    pub async fn get_assessment_blueprint_revision(
        &self,
        revision_id: &str,
    ) -> Result<BlueprintDetail, StudyCommandError> {
        let rev_row = sqlx::query(
            "SELECT r.id, r.blueprint_id, r.revision, r.state, r.plan_version_id, r.config_json,
                    r.scoring_json, r.source_scope_json, r.quota_json, r.generation_job_id,
                    r.source_snapshot_hash, r.created_at, r.published_at,
                    b.id as bp_id, b.plan_id as bp_plan_id, b.title as bp_title,
                    b.current_revision_id as bp_current_revision_id, b.lifecycle as bp_lifecycle,
                    b.revision as bp_revision, b.created_at as bp_created_at, b.updated_at as bp_updated_at
             FROM assessment_blueprint_revisions r
             JOIN assessment_blueprints b ON r.blueprint_id = b.id
             WHERE r.id = ?",
        )
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query blueprint revision", e))?
        .ok_or_else(|| StudyCommandError::not_found("study.assessment.error.revision_not_found"))?;

        let blueprint = AssessmentBlueprint {
            id: rev_row.get("bp_id"),
            plan_id: rev_row.get("bp_plan_id"),
            title: rev_row.get("bp_title"),
            current_revision_id: rev_row.get("bp_current_revision_id"),
            lifecycle: rev_row
                .get::<String, _>("bp_lifecycle")
                .parse()
                .unwrap_or(BlueprintLifecycle::Active),
            revision: rev_row.get("bp_revision"),
            created_at: rev_row.get("bp_created_at"),
            updated_at: rev_row.get("bp_updated_at"),
        };

        let revision = BlueprintRevision {
            id: rev_row.get("id"),
            blueprint_id: rev_row.get("blueprint_id"),
            revision: rev_row.get("revision"),
            state: rev_row
                .get::<String, _>("state")
                .parse()
                .unwrap_or(BlueprintState::Draft),
            plan_version_id: rev_row.get("plan_version_id"),
            config: serde_json::from_str(&rev_row.get::<String, _>("config_json"))
                .unwrap_or(serde_json::Value::Null),
            scoring: serde_json::from_str(&rev_row.get::<String, _>("scoring_json"))
                .unwrap_or(serde_json::Value::Null),
            source_scope: serde_json::from_str(&rev_row.get::<String, _>("source_scope_json"))
                .unwrap_or(serde_json::Value::Null),
            quota: serde_json::from_str(&rev_row.get::<String, _>("quota_json"))
                .unwrap_or(serde_json::Value::Null),
            generation_job_id: rev_row.get("generation_job_id"),
            source_snapshot_hash: rev_row.get("source_snapshot_hash"),
            created_at: rev_row.get("created_at"),
            published_at: rev_row.get("published_at"),
        };

        // Query question revisions for this blueprint revision
        let q_rows = sqlx::query(
            "SELECT id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                    kind, payload_json, answer_key_json, rubric_json, max_points, difficulty,
                    validation, validation_issues_json, committed_at, provider_json, created_at
             FROM assessment_question_revisions
             WHERE blueprint_revision_id = ?
             ORDER BY slot_key ASC",
        )
        .bind(revision_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query question revisions", e))?;

        let mut questions: Vec<AssessmentQuestionRevision> = Vec::with_capacity(q_rows.len());

        for qr in q_rows {
            let qr_id: String = qr.get("id");

            let source_rows = sqlx::query(
                "SELECT source_ref_id, ordinal, role
                 FROM assessment_question_sources
                 WHERE question_revision_id = ?
                 ORDER BY ordinal ASC",
            )
            .bind(&qr_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| storage_err("Failed to query question sources", e))?;

            let sources = source_rows
                .into_iter()
                .map(|r| QuestionSourceLink {
                    source_ref_id: r.get("source_ref_id"),
                    ordinal: r.get("ordinal"),
                    role: r.get("role"),
                })
                .collect();

            let target_rows = sqlx::query(
                "SELECT concept_id, concept_label, node_id, objective_text, ordinal
                 FROM assessment_question_targets
                 WHERE question_revision_id = ?
                 ORDER BY ordinal ASC",
            )
            .bind(&qr_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| storage_err("Failed to query question targets", e))?;

            let targets = target_rows
                .into_iter()
                .map(|r| QuestionTargetLink {
                    concept_id: r.get("concept_id"),
                    concept_label: r.get("concept_label"),
                    node_id: r.get("node_id"),
                    objective_text: r.get("objective_text"),
                    ordinal: r.get("ordinal"),
                })
                .collect();

            let payload: serde_json::Value =
                serde_json::from_str(&qr.get::<String, _>("payload_json"))
                    .unwrap_or(serde_json::Value::Null);
            let answer_key: serde_json::Value =
                serde_json::from_str(&qr.get::<String, _>("answer_key_json"))
                    .unwrap_or(serde_json::Value::Null);
            let rubric: Option<serde_json::Value> = qr
                .get::<Option<String>, _>("rubric_json")
                .and_then(|s| serde_json::from_str(&s).ok());
            let validation_issues: Vec<serde_json::Value> =
                serde_json::from_str(&qr.get::<String, _>("validation_issues_json"))
                    .unwrap_or_default();
            let provider: Option<serde_json::Value> = qr
                .get::<Option<String>, _>("provider_json")
                .and_then(|s| serde_json::from_str(&s).ok());

            questions.push(AssessmentQuestionRevision {
                id: qr_id,
                question_id: qr.get("question_id"),
                blueprint_revision_id: qr.get("blueprint_revision_id"),
                revision: qr.get("revision"),
                slot_key: qr.get("slot_key"),
                fingerprint: qr.get("fingerprint"),
                kind: qr
                    .get::<String, _>("kind")
                    .parse()
                    .unwrap_or(QuestionKind::SingleSelect),
                payload,
                answer_key,
                rubric,
                max_points: qr.get("max_points"),
                difficulty: qr.get("difficulty"),
                validation: qr.get("validation"),
                validation_issues,
                committed_at: qr.get("committed_at"),
                provider,
                created_at: qr.get("created_at"),
                sources,
                targets,
            });
        }

        Ok(BlueprintDetail {
            blueprint,
            revision,
            questions,
        })
    }

    /// Lists assessment blueprints, optionally filtered by plan_id.
    pub async fn list_assessment_blueprints(
        &self,
        plan_id: Option<&str>,
    ) -> Result<Vec<BlueprintSummary>, StudyCommandError> {
        let query = if let Some(p_id) = plan_id {
            sqlx::query(
                "SELECT b.id, b.plan_id, b.title, b.lifecycle, b.current_revision_id, b.revision,
                        COALESCE(r.state, 'draft') as state,
                        COALESCE(r.config_json, '{}') as config_json,
                        b.updated_at,
                        (SELECT COUNT(*) FROM assessment_question_revisions qr WHERE qr.blueprint_revision_id = COALESCE(b.current_revision_id, r.id)) as q_count
                 FROM assessment_blueprints b
                 LEFT JOIN assessment_blueprint_revisions r ON r.blueprint_id = b.id AND r.state IN ('draft','needs-review','ready')
                 WHERE b.plan_id = ?
                 ORDER BY b.updated_at DESC",
            )
            .bind(p_id)
        } else {
            sqlx::query(
                "SELECT b.id, b.plan_id, b.title, b.lifecycle, b.current_revision_id, b.revision,
                        COALESCE(r.state, 'draft') as state,
                        COALESCE(r.config_json, '{}') as config_json,
                        b.updated_at,
                        (SELECT COUNT(*) FROM assessment_question_revisions qr WHERE qr.blueprint_revision_id = COALESCE(b.current_revision_id, r.id)) as q_count
                 FROM assessment_blueprints b
                 LEFT JOIN assessment_blueprint_revisions r ON r.blueprint_id = b.id AND r.state IN ('draft','needs-review','ready')
                 ORDER BY b.updated_at DESC",
            )
        };

        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| storage_err("Failed to list blueprints", e))?;

        let mut summaries = Vec::with_capacity(rows.len());
        for row in rows {
            let config: serde_json::Value =
                serde_json::from_str(&row.get::<String, _>("config_json"))
                    .unwrap_or(serde_json::Value::Null);

            let mode: AssessmentMode = config
                .get("mode")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(AssessmentMode::Exam);

            summaries.push(BlueprintSummary {
                id: row.get("id"),
                plan_id: row.get("plan_id"),
                title: row.get("title"),
                lifecycle: row
                    .get::<String, _>("lifecycle")
                    .parse()
                    .unwrap_or(BlueprintLifecycle::Active),
                current_revision_id: row.get("current_revision_id"),
                current_revision: row.get("revision"),
                state: row
                    .get::<String, _>("state")
                    .parse()
                    .unwrap_or(BlueprintState::Draft),
                mode,
                question_count: row.get("q_count"),
                updated_at: row.get("updated_at"),
            });
        }

        Ok(summaries)
    }

    /// Saves modifications to a draft blueprint revision (config, title, sources).
    /// Resets shortfall_accepted to false.
    pub async fn save_assessment_blueprint_draft(
        &self,
        input: SaveBlueprintDraftInput,
    ) -> Result<BlueprintDetail, StudyCommandError> {
        let rev_row = sqlx::query(
            "SELECT r.id, r.blueprint_id, r.state, r.quota_json, b.revision
             FROM assessment_blueprint_revisions r
             JOIN assessment_blueprints b ON r.blueprint_id = b.id
             WHERE r.id = ?",
        )
        .bind(&input.revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query revision for save", e))?
        .ok_or_else(|| StudyCommandError::not_found("study.assessment.error.revision_not_found"))?;

        let state_str: String = rev_row.get("state");
        if state_str == "ready" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.cannot_modify_ready_revision",
            ));
        }

        let bp_revision: i64 = rev_row.get("revision");
        if bp_revision != input.expected_revision {
            return Err(stale_rev_err(input.expected_revision, bp_revision));
        }

        let blueprint_id: String = rev_row.get("blueprint_id");
        let now = Utc::now().to_rfc3339();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| storage_err("Failed to begin transaction", e))?;

        // Reset shortfallAccepted to false
        let mut quota_val: serde_json::Value =
            serde_json::from_str(&rev_row.get::<String, _>("quota_json"))
                .unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = quota_val.as_object_mut() {
            obj.insert(
                "shortfallAccepted".to_string(),
                serde_json::Value::Bool(false),
            );
        }

        // Update blueprint title if provided
        if let Some(title) = &input.title {
            let trimmed = title.trim();
            if trimmed.is_empty() || trimmed.len() > MAX_BLUEPRINT_TITLE_CHARS {
                return Err(StudyCommandError::invalid_input(
                    "study.assessment.error.invalid_title_length",
                    vec![],
                ));
            }
            sqlx::query("UPDATE assessment_blueprints SET title = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
                .bind(trimmed)
                .bind(&now)
                .bind(&blueprint_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| storage_err("Failed to update blueprint title", e))?;
        } else {
            sqlx::query("UPDATE assessment_blueprints SET updated_at = ?, revision = revision + 1 WHERE id = ?")
                .bind(&now)
                .bind(&blueprint_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| storage_err("Failed to bump blueprint revision", e))?;
        }

        // Update revision fields
        if let Some(config) = &input.config {
            validate_mode_config(config)?;
            sqlx::query("UPDATE assessment_blueprint_revisions SET config_json = ?, quota_json = ? WHERE id = ?")
                .bind(serde_json::to_string(config).unwrap())
                .bind(serde_json::to_string(&quota_val).unwrap())
                .bind(&input.revision_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| storage_err("Failed to update config", e))?;
        }

        if let Some(scope) = &input.source_scope {
            sqlx::query(
                "UPDATE assessment_blueprint_revisions SET source_scope_json = ? WHERE id = ?",
            )
            .bind(serde_json::to_string(scope).unwrap())
            .bind(&input.revision_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to update source scope", e))?;
        }

        if let Some(hash) = &input.source_snapshot_hash {
            sqlx::query(
                "UPDATE assessment_blueprint_revisions SET source_snapshot_hash = ? WHERE id = ?",
            )
            .bind(hash)
            .bind(&input.revision_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to update source snapshot hash", e))?;
        }

        tx.commit()
            .await
            .map_err(|e| storage_err("Failed to commit draft save", e))?;

        self.get_assessment_blueprint_revision(&input.revision_id)
            .await
    }

    /// Upserts an uncommitted question draft into a blueprint revision.
    pub async fn upsert_assessment_question_draft(
        &self,
        input: SaveQuestionDraftInput,
    ) -> Result<AssessmentQuestionRevision, StudyCommandError> {
        let rev_row = sqlx::query(
            "SELECT r.id, r.blueprint_id, r.state, r.quota_json
             FROM assessment_blueprint_revisions r
             WHERE r.id = ?",
        )
        .bind(&input.blueprint_revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to check revision state", e))?
        .ok_or_else(|| StudyCommandError::not_found("study.assessment.error.revision_not_found"))?;

        let state_str: String = rev_row.get("state");
        if state_str == "ready" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.cannot_modify_ready_revision",
            ));
        }

        let blueprint_id: String = rev_row.get("blueprint_id");
        let question_id = input
            .question_id
            .unwrap_or_else(|| format!("aq_{}", Uuid::new_v4().simple()));
        let aqr_id = format!("aqr_{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| storage_err("Failed to begin transaction", e))?;

        // 1. Ensure assessment_questions row exists
        sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(blueprint_id, semantic_fingerprint) DO UPDATE SET archived_at = NULL",
        )
        .bind(&question_id)
        .bind(&blueprint_id)
        .bind(&input.fingerprint)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to upsert question identity", e))?;

        // 2. Delete existing question revision for this slot or question if replacing
        sqlx::query(
            "DELETE FROM assessment_question_revisions
             WHERE blueprint_revision_id = ? AND (slot_key = ? OR question_id = ?)",
        )
        .bind(&input.blueprint_revision_id)
        .bind(&input.slot_key)
        .bind(&question_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to clear previous slot revision", e))?;

        // 3. Insert question revision
        sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, rubric_json, max_points, difficulty,
                validation, validation_issues_json, committed_at, provider_json, created_at
            ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(&aqr_id)
        .bind(&question_id)
        .bind(&input.blueprint_revision_id)
        .bind(&input.slot_key)
        .bind(&input.fingerprint)
        .bind(input.kind.to_string())
        .bind(&input.payload_json)
        .bind(&input.answer_key_json)
        .bind(&input.rubric_json)
        .bind(input.max_points)
        .bind(input.difficulty)
        .bind(&input.validation)
        .bind(
            input
                .validation_issues_json
                .unwrap_or_else(|| "[]".to_string()),
        )
        .bind(&input.provider_json)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to insert question revision", e))?;

        // 4. Insert sources (up to 4)
        for (idx, s_id) in input.source_ref_ids.iter().take(4).enumerate() {
            sqlx::query(
                "INSERT INTO assessment_question_sources (
                    question_revision_id, source_ref_id, ordinal, role
                ) VALUES (?, ?, ?, ?)",
            )
            .bind(&aqr_id)
            .bind(s_id)
            .bind(idx as i64)
            .bind(if idx == 0 { "primary" } else { "supporting" })
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to attach question source", e))?;
        }

        // 5. Insert targets (up to 6)
        for (idx, target) in input.targets.iter().take(6).enumerate() {
            sqlx::query(
                "INSERT INTO assessment_question_targets (
                    question_revision_id, concept_id, concept_label, node_id, objective_text, ordinal
                ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&aqr_id)
            .bind(&target.concept_id)
            .bind(&target.concept_label)
            .bind(&target.node_id)
            .bind(&target.objective_text)
            .bind(idx as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to attach question target", e))?;
        }

        // 6. Reset shortfallAccepted = false in revision quota
        let mut quota_val: serde_json::Value =
            serde_json::from_str(&rev_row.get::<String, _>("quota_json"))
                .unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = quota_val.as_object_mut() {
            obj.insert(
                "shortfallAccepted".to_string(),
                serde_json::Value::Bool(false),
            );
        }

        sqlx::query("UPDATE assessment_blueprint_revisions SET quota_json = ? WHERE id = ?")
            .bind(serde_json::to_string(&quota_val).unwrap())
            .bind(&input.blueprint_revision_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to reset quota shortfall flag", e))?;

        tx.commit()
            .await
            .map_err(|e| storage_err("Failed to commit question draft", e))?;

        let detail = self
            .get_assessment_blueprint_revision(&input.blueprint_revision_id)
            .await?;
        let q = detail
            .questions
            .into_iter()
            .find(|item| item.id == aqr_id)
            .ok_or_else(|| {
                StudyCommandError::internal_error(
                    "Inserted question revision not found after commit",
                )
            })?;

        Ok(q)
    }

    /// Publishes an Assessment Blueprint revision to Ready state.
    /// Commits all question revisions and marks them immutable.
    pub async fn publish_assessment_blueprint(
        &self,
        revision_id: &str,
        expected_revision: i64,
        shortfall_accepted: bool,
    ) -> Result<BlueprintDetail, StudyCommandError> {
        let rev_row = sqlx::query(
            "SELECT r.id, r.blueprint_id, r.state, r.config_json, r.quota_json, b.revision
             FROM assessment_blueprint_revisions r
             JOIN assessment_blueprints b ON r.blueprint_id = b.id
             WHERE r.id = ?",
        )
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query revision for publication", e))?
        .ok_or_else(|| StudyCommandError::not_found("study.assessment.error.revision_not_found"))?;

        let bp_revision: i64 = rev_row.get("revision");
        if bp_revision != expected_revision {
            return Err(stale_rev_err(expected_revision, bp_revision));
        }

        let state_str: String = rev_row.get("state");
        if state_str == "ready" {
            // Already published and ready
            return self.get_assessment_blueprint_revision(revision_id).await;
        }

        let blueprint_id: String = rev_row.get("blueprint_id");

        // 1. Check all question revisions for this blueprint revision
        let q_rows = sqlx::query(
            "SELECT id, validation
             FROM assessment_question_revisions
             WHERE blueprint_revision_id = ?",
        )
        .bind(revision_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query questions for publication", e))?;

        // Every question in paper must be valid
        for q in &q_rows {
            let val: String = q.get("validation");
            if val != "valid" {
                return Err(StudyCommandError::invalid_state(
                    "study.assessment.error.invalid_question_in_paper",
                ));
            }
        }

        let accepted_count = q_rows.len() as i64;
        if accepted_count == 0 {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.empty_paper",
            ));
        }
        let config: serde_json::Value =
            serde_json::from_str(&rev_row.get::<String, _>("config_json"))
                .unwrap_or(serde_json::Value::Null);
        validate_mode_config(&config)?;
        let requested_count = config
            .get("requestedCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(accepted_count);

        if accepted_count < requested_count && !shortfall_accepted {
            return Err(quota_shortfall_err(requested_count, accepted_count));
        }

        let now = Utc::now().to_rfc3339();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| storage_err("Failed to begin publication transaction", e))?;

        // 2. Mark all question revisions committed (triggers will prevent future updates)
        sqlx::query(
            "UPDATE assessment_question_revisions
             SET committed_at = ?
             WHERE blueprint_revision_id = ?",
        )
        .bind(&now)
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to commit question revisions", e))?;

        // 3. Update quota JSON with shortfallAccepted
        let mut quota_val: serde_json::Value =
            serde_json::from_str(&rev_row.get::<String, _>("quota_json"))
                .unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = quota_val.as_object_mut() {
            obj.insert(
                "shortfallAccepted".to_string(),
                serde_json::Value::Bool(shortfall_accepted),
            );
            obj.insert(
                "accepted".to_string(),
                serde_json::Value::Number(accepted_count.into()),
            );
        }

        // 4. Update revision state to ready
        sqlx::query(
            "UPDATE assessment_blueprint_revisions
             SET state = 'ready', published_at = ?, quota_json = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(serde_json::to_string(&quota_val).unwrap())
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to publish revision", e))?;

        // 5. Update blueprint current_revision_id and bump revision
        sqlx::query(
            "UPDATE assessment_blueprints
             SET current_revision_id = ?, revision = revision + 1, updated_at = ?
             WHERE id = ?",
        )
        .bind(revision_id)
        .bind(&now)
        .bind(&blueprint_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to update blueprint head", e))?;

        tx.commit()
            .await
            .map_err(|e| storage_err("Failed to commit publication", e))?;

        self.get_assessment_blueprint_revision(revision_id).await
    }

    /// Discards an uncommitted draft revision.
    pub async fn discard_assessment_blueprint_draft(
        &self,
        revision_id: &str,
        expected_revision: i64,
    ) -> Result<(), StudyCommandError> {
        let rev_row = sqlx::query(
            "SELECT r.id, r.blueprint_id, r.state, b.revision
             FROM assessment_blueprint_revisions r
             JOIN assessment_blueprints b ON r.blueprint_id = b.id
             WHERE r.id = ?",
        )
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage_err("Failed to query revision for discard", e))?
        .ok_or_else(|| StudyCommandError::not_found("study.assessment.error.revision_not_found"))?;

        let state_str: String = rev_row.get("state");
        if state_str == "ready" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.cannot_discard_ready_revision",
            ));
        }

        let bp_revision: i64 = rev_row.get("revision");
        if bp_revision != expected_revision {
            return Err(stale_rev_err(expected_revision, bp_revision));
        }

        let blueprint_id: String = rev_row.get("blueprint_id");

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| storage_err("Failed to begin transaction", e))?;

        // Delete draft revision
        sqlx::query("DELETE FROM assessment_blueprint_revisions WHERE id = ?")
            .bind(revision_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| storage_err("Failed to delete draft revision", e))?;

        // Check if blueprint has other revisions
        let (rem_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM assessment_blueprint_revisions WHERE blueprint_id = ?",
        )
        .bind(&blueprint_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| storage_err("Failed to check remaining revisions", e))?;

        if rem_count == 0 {
            // Delete blueprint as well if it had no published revisions
            sqlx::query("DELETE FROM assessment_blueprints WHERE id = ?")
                .bind(&blueprint_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| storage_err("Failed to clean up blueprint", e))?;
        } else {
            sqlx::query("UPDATE assessment_blueprints SET revision = revision + 1, updated_at = ? WHERE id = ?")
                .bind(Utc::now().to_rfc3339())
                .bind(&blueprint_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| storage_err("Failed to bump blueprint revision", e))?;
        }

        tx.commit()
            .await
            .map_err(|e| storage_err("Failed to commit draft discard", e))?;

        Ok(())
    }

    /// Archives an Assessment Blueprint.
    pub async fn archive_assessment_blueprint(
        &self,
        blueprint_id: &str,
        expected_revision: i64,
    ) -> Result<(), StudyCommandError> {
        let (cur_rev,): (i64,) =
            sqlx::query_as("SELECT revision FROM assessment_blueprints WHERE id = ?")
                .bind(blueprint_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| storage_err("Failed to query blueprint", e))?
                .ok_or_else(|| {
                    StudyCommandError::not_found("study.assessment.error.blueprint_not_found")
                })?;

        if cur_rev != expected_revision {
            return Err(stale_rev_err(expected_revision, cur_rev));
        }

        sqlx::query("UPDATE assessment_blueprints SET lifecycle = 'archived', revision = revision + 1, updated_at = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(blueprint_id)
            .execute(&self.pool)
            .await
            .map_err(|e| storage_err("Failed to archive blueprint", e))?;

        Ok(())
    }

    /// Deletes an unused Assessment Blueprint (hard delete if no attempts exist).
    pub async fn delete_unused_assessment_blueprint(
        &self,
        blueprint_id: &str,
        expected_revision: i64,
    ) -> Result<(), StudyCommandError> {
        let (cur_rev,): (i64,) =
            sqlx::query_as("SELECT revision FROM assessment_blueprints WHERE id = ?")
                .bind(blueprint_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| storage_err("Failed to query blueprint", e))?
                .ok_or_else(|| {
                    StudyCommandError::not_found("study.assessment.error.blueprint_not_found")
                })?;

        if cur_rev != expected_revision {
            return Err(stale_rev_err(expected_revision, cur_rev));
        }

        // Check if exam_attempts table exists and has any attempts for revisions of this blueprint
        let (attempts_exist,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='exam_attempts'",
        )
        .fetch_one(&self.pool)
        .await
        .unwrap_or((0,));

        if attempts_exist > 0 {
            let (attempt_count,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM exam_attempts a
                 JOIN assessment_blueprint_revisions r ON a.blueprint_revision_id = r.id
                 WHERE r.blueprint_id = ?",
            )
            .bind(blueprint_id)
            .fetch_one(&self.pool)
            .await
            .unwrap_or((0,));

            if attempt_count > 0 {
                return Err(StudyCommandError::invalid_state(
                    "study.assessment.error.blueprint_has_attempts_archive_instead",
                ));
            }
        }

        sqlx::query("DELETE FROM assessment_blueprints WHERE id = ?")
            .bind(blueprint_id)
            .execute(&self.pool)
            .await
            .map_err(|e| storage_err("Failed to delete unused blueprint", e))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::models::assessment_blueprint::QuestionKind;

    async fn create_test_pool() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create memory db");
        run_migrations(&pool).await.expect("apply migrations");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn test_create_and_get_assessment_blueprint() {
        let pool = create_test_pool().await;
        let repo = AssessmentBlueprintRepository::new(pool);

        let input = CreateBlueprintInput {
            plan_id: None,
            title: "Exam 101".to_string(),
            plan_version_id: None,
            config: serde_json::json!({
                "mode": "exam",
                "requestedCount": 10,
            }),
            source_scope: serde_json::json!({
                "selected": { "documentIds": ["d1"] }
            }),
            source_snapshot_hash: "sha256:snapshot1".to_string(),
        };

        let detail = repo
            .create_assessment_blueprint(input)
            .await
            .expect("create blueprint");

        assert!(detail.blueprint.id.starts_with("ab_"));
        assert!(detail.revision.id.starts_with("abr_"));
        assert_eq!(detail.blueprint.title, "Exam 101");
        assert_eq!(detail.blueprint.revision, 1);
        assert_eq!(detail.revision.state, BlueprintState::Draft);
        assert_eq!(detail.questions.len(), 0);

        let error = repo
            .publish_assessment_blueprint(&detail.revision.id, detail.blueprint.revision, true)
            .await
            .expect_err("an empty paper cannot be published");
        assert_eq!(error.message_key, "study.assessment.error.empty_paper");

        // Fetch back
        let fetched = repo
            .get_assessment_blueprint_revision(&detail.revision.id)
            .await
            .expect("get revision");
        assert_eq!(fetched.blueprint.id, detail.blueprint.id);
        assert_eq!(fetched.revision.id, detail.revision.id);
    }

    #[tokio::test]
    async fn test_save_draft_and_cas_invariants() {
        let pool = create_test_pool().await;
        let repo = AssessmentBlueprintRepository::new(pool);

        let detail = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Draft BP".to_string(),
                plan_version_id: None,
                config: serde_json::json!({ "requestedCount": 5 }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:snap".to_string(),
            })
            .await
            .unwrap();

        // 1. Mismatched expected_revision should return StaleRevision
        let stale_res = repo
            .save_assessment_blueprint_draft(SaveBlueprintDraftInput {
                revision_id: detail.revision.id.clone(),
                expected_revision: 999, // Stale!
                title: Some("New Title".to_string()),
                config: None,
                source_scope: None,
                source_snapshot_hash: None,
            })
            .await;
        assert!(stale_res.is_err());
        assert_eq!(stale_res.unwrap_err().code, StudyErrorCode::StaleRevision);

        // 2. Correct expected_revision updates draft and increments blueprint revision
        let updated = repo
            .save_assessment_blueprint_draft(SaveBlueprintDraftInput {
                revision_id: detail.revision.id.clone(),
                expected_revision: 1,
                title: Some("Renamed BP".to_string()),
                config: Some(serde_json::json!({ "requestedCount": 8 })),
                source_scope: None,
                source_snapshot_hash: None,
            })
            .await
            .expect("save draft");

        assert_eq!(updated.blueprint.title, "Renamed BP");
        assert_eq!(updated.blueprint.revision, 2);
    }

    #[tokio::test]
    async fn test_upsert_question_and_publication_shortfall_rules() {
        let pool = create_test_pool().await;
        let repo = AssessmentBlueprintRepository::new(pool.clone());

        // Seed a document and study source ref for question links
        sqlx::query(
            "INSERT INTO documents (
                id, title, file_path, file_type, date_added, date_modified
            ) VALUES (
                'doc_raft', 'Raft Paper', '/p', 'pdf', '2026-11-10T18:00:00Z', '2026-11-10T18:00:00Z'
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO study_source_refs (
                id, document_id, excerpt, excerpt_sha256, revision, revision_kind,
                document_title, source_type, captured_at
            ) VALUES (
                'ref_raft_1', 'doc_raft', 'Raft excerpt', 'sha256:e1', 'rev_1', 'content-hash',
                'Raft Paper', 'pdf', '2026-11-10T18:00:00Z'
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        let detail = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Raft Exam".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "exam",
                    "requestedCount": 2, // Requested 2 questions!
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:snap".to_string(),
            })
            .await
            .unwrap();

        // Add 1 valid question
        let q_input = SaveQuestionDraftInput {
            blueprint_revision_id: detail.revision.id.clone(),
            question_id: None,
            slot_key: "slot_0000".to_string(),
            fingerprint: "sha256:fp1".to_string(),
            kind: QuestionKind::SingleSelect,
            payload_json: "{\"prompt\":\"Q1\"}".to_string(),
            answer_key_json: "{\"correctOptionId\":\"opt_1\"}".to_string(),
            rubric_json: None,
            max_points: 1,
            difficulty: 2,
            validation: "valid".to_string(),
            validation_issues_json: None,
            provider_json: None,
            source_ref_ids: vec!["ref_raft_1".to_string()],
            targets: vec![QuestionTargetInput {
                concept_id: None,
                concept_label: "Raft".to_string(),
                node_id: None,
                objective_text: "Objective 1".to_string(),
            }],
        };

        let q1 = repo
            .upsert_assessment_question_draft(q_input)
            .await
            .expect("upsert question draft");

        assert!(q1.id.starts_with("aqr_"));
        assert!(q1.question_id.starts_with("aq_"));
        assert_eq!(q1.sources.len(), 1);
        assert_eq!(q1.targets.len(), 1);

        // Try to publish without accepting shortfall (1 accepted < 2 requested)
        let pub_fail = repo
            .publish_assessment_blueprint(&detail.revision.id, 1, false)
            .await;
        assert!(pub_fail.is_err());
        assert_eq!(pub_fail.unwrap_err().code, StudyErrorCode::QuotaShortfall);

        // Publish WITH shortfall_accepted = true -> Must succeed!
        let pub_ok = repo
            .publish_assessment_blueprint(&detail.revision.id, 1, true)
            .await
            .expect("publish with shortfall accepted");

        assert_eq!(pub_ok.revision.state, BlueprintState::Ready);
        assert!(pub_ok.revision.published_at.is_some());
        assert_eq!(
            pub_ok.blueprint.current_revision_id,
            Some(detail.revision.id.clone())
        );
        assert_eq!(pub_ok.blueprint.revision, 2);

        // All questions committed
        assert!(pub_ok.questions[0].committed_at.is_some());

        // Attempting to mutate draft on ready revision must return InvalidState
        let mutate_ready = repo
            .save_assessment_blueprint_draft(SaveBlueprintDraftInput {
                revision_id: detail.revision.id.clone(),
                expected_revision: 2,
                title: Some("Forbidden Mutation".to_string()),
                config: None,
                source_scope: None,
                source_snapshot_hash: None,
            })
            .await;
        assert!(mutate_ready.is_err());
        assert_eq!(mutate_ready.unwrap_err().code, StudyErrorCode::InvalidState);
    }

    #[tokio::test]
    async fn test_archive_and_delete_unused() {
        let pool = create_test_pool().await;
        let repo = AssessmentBlueprintRepository::new(pool);

        let detail = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "To Archive".to_string(),
                plan_version_id: None,
                config: serde_json::json!({}),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await
            .unwrap();

        // Archive
        repo.archive_assessment_blueprint(&detail.blueprint.id, 1)
            .await
            .expect("archive blueprint");

        let fetched = repo
            .get_assessment_blueprint_revision(&detail.revision.id)
            .await
            .unwrap();
        assert_eq!(fetched.blueprint.lifecycle, BlueprintLifecycle::Archived);
        assert_eq!(fetched.blueprint.revision, 2);

        // Delete unused
        repo.delete_unused_assessment_blueprint(&detail.blueprint.id, 2)
            .await
            .expect("delete unused");

        // Now fetching must return NotFound
        let missing = repo
            .get_assessment_blueprint_revision(&detail.revision.id)
            .await;
        assert!(missing.is_err());
        assert_eq!(missing.unwrap_err().code, StudyErrorCode::NotFound);
    }

    #[tokio::test]
    async fn test_diagnostic_and_practice_config_validation() {
        let pool = create_test_pool().await;
        let repo = AssessmentBlueprintRepository::new(pool);

        // Diagnostic count below 4 rejected on create
        let bad_low = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Diag low".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "diagnostic",
                    "requestedCount": 3,
                    "typeWeights": { "single-select": 1 },
                    "timeLimitSeconds": null,
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await;
        assert!(bad_low.is_err());

        // Diagnostic essay weight rejected
        let bad_essay = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Diag essay".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "diagnostic",
                    "requestedCount": 6,
                    "typeWeights": { "essay": 1 },
                    "timeLimitSeconds": null,
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await;
        assert!(bad_essay.is_err());

        // Diagnostic timer rejected
        let bad_timer = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Diag timer".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "diagnostic",
                    "requestedCount": 6,
                    "typeWeights": { "single-select": 1 },
                    "timeLimitSeconds": 600,
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await;
        assert!(bad_timer.is_err());

        // Practice timer rejected
        let bad_practice = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Practice timer".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "practice",
                    "requestedCount": 1,
                    "timeLimitSeconds": 600,
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await;
        assert!(bad_practice.is_err());

        // Valid diagnostic accepted
        let good = repo
            .create_assessment_blueprint(CreateBlueprintInput {
                plan_id: None,
                title: "Diag ok".to_string(),
                plan_version_id: None,
                config: serde_json::json!({
                    "mode": "diagnostic",
                    "requestedCount": 6,
                    "typeWeights": { "single-select": 1 },
                    "timeLimitSeconds": null,
                }),
                source_scope: serde_json::json!({}),
                source_snapshot_hash: "sha256:s".to_string(),
            })
            .await
            .expect("valid diagnostic accepted");

        // Save with invalid diagnostic count rejected
        let bad_save = repo
            .save_assessment_blueprint_draft(SaveBlueprintDraftInput {
                revision_id: good.revision.id.clone(),
                expected_revision: 1,
                title: None,
                config: Some(serde_json::json!({
                    "mode": "diagnostic",
                    "requestedCount": 13,
                    "timeLimitSeconds": null,
                })),
                source_scope: None,
                source_snapshot_hash: None,
            })
            .await;
        assert!(bad_save.is_err());
    }
}
