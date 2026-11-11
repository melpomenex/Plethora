//! Exam Grading Repository for Rubric Settlements, History, and Manual Overrides.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, §10, §11, §12
//! - openspec/changes/implement-rubric-based-exam-grading/ (C5-T03)

use crate::models::exam_session::ExamGrade;
use crate::models::rubric_grade::{
    GradeSettlementOutcome, RecordManualGradeInput, RecordRubricGradeInput,
};
use crate::models::study_source::{FieldIssue, StudyCommandError};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

#[derive(Clone)]
pub struct ExamGradingRepository {
    pool: Pool<Sqlite>,
}

impl ExamGradingRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Internal atomic grade settlement transaction.
    /// Manages grade insertion, current-flag flipping, attempt score aggregation,
    /// CAS checking, and optional generation job step completion.
    pub async fn record_rubric_grade(
        &self,
        input: RecordRubricGradeInput,
    ) -> Result<GradeSettlementOutcome, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        // 1. Fetch attempt and verify CAS
        let attempt_row = sqlx::query(
            "SELECT id, status, revision, question_revision_ids_json, maximum_points
             FROM exam_attempts WHERE id = ?1",
        )
        .bind(&input.attempt_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch attempt: {}", e))
        })?;

        let attempt_row = match attempt_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Attempt '{}' not found",
                    input.attempt_id
                )))
            }
        };

        let current_revision: i64 = attempt_row.get("revision");
        if current_revision != input.expected_attempt_revision {
            return Err(StudyCommandError::stale_revision(format!(
                "Attempt revision mismatch: expected {}, got {}",
                input.expected_attempt_revision, current_revision
            )));
        }

        let attempt_status: String = attempt_row.get("status");
        if attempt_status == "in-progress" || attempt_status == "cancelled" {
            return Err(StudyCommandError::invalid_state(format!(
                "Cannot grade attempt with status '{}'",
                attempt_status
            )));
        }

        let q_revision_ids_json: String = attempt_row.get("question_revision_ids_json");
        let question_revision_ids: Vec<String> = serde_json::from_str(&q_revision_ids_json)
            .map_err(|e| {
                StudyCommandError::internal_error(format!(
                    "Failed to parse question revision ids: {}",
                    e
                ))
            })?;
        let attempt_maximum_points: f64 = attempt_row
            .try_get("maximum_points")
            .or_else(|_| {
                attempt_row
                    .try_get::<i64, _>("maximum_points")
                    .map(|i| i as f64)
            })
            .unwrap_or(0.0);

        // 2. Verify submission exists
        let sub_exists = sqlx::query(
            "SELECT id FROM exam_response_submissions
             WHERE id = ?1 AND attempt_id = ?2 AND question_revision_id = ?3",
        )
        .bind(&input.response_submission_id)
        .bind(&input.attempt_id)
        .bind(&input.question_revision_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to verify submission: {}", e))
        })?;

        if sub_exists.is_none() {
            return Err(StudyCommandError::not_found(format!(
                "Submission '{}' not found for attempt '{}' and question '{}'",
                input.response_submission_id, input.attempt_id, input.question_revision_id
            )));
        }

        // 3. Inspect existing current grade for this submission
        let existing_current_row = sqlx::query(
            "SELECT id, origin, state FROM exam_grades
             WHERE response_submission_id = ?1 AND is_current = 1",
        )
        .bind(&input.response_submission_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch existing grade: {}", e))
        })?;

        let mut is_current = true;
        let mut supersedes_id: Option<String> = None;

        if let Some(existing) = existing_current_row {
            let existing_id: String = existing.get("id");
            let existing_origin: String = existing.get("origin");

            // CRITICAL CONTRACT: Manual current cannot be automatically displaced by an AI grade
            if existing_origin == "manual" && input.origin == "ai" {
                // Keep the manual grade authoritative; incoming AI grade is historical only
                is_current = false;
                supersedes_id = None;
            } else {
                // Incoming grade supersedes existing current grade
                supersedes_id = Some(existing_id.clone());
                if is_current {
                    sqlx::query("UPDATE exam_grades SET is_current = 0 WHERE id = ?1")
                        .bind(&existing_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| {
                            StudyCommandError::storage_failed(format!(
                                "Failed to supersede existing grade: {}",
                                e
                            ))
                        })?;
                }
            }
        }

        // 4. Insert new grade record
        let new_grade_id = format!("grd_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO exam_grades (
                id, response_submission_id, question_revision_id, origin, state,
                points, max_points, assessment_json, criteria_json,
                provenance_json, manual_reason, supersedes_grade_id, is_current, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )
        .bind(&new_grade_id)
        .bind(&input.response_submission_id)
        .bind(&input.question_revision_id)
        .bind(&input.origin)
        .bind(&input.state)
        .bind(input.points)
        .bind(input.max_points)
        .bind(&input.assessment_json)
        .bind(&input.criteria_json)
        .bind(&input.provenance_json)
        .bind(&input.manual_reason)
        .bind(&supersedes_id)
        .bind(if is_current { 1 } else { 0 })
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to insert exam grade: {}", e))
        })?;

        // 5. Recalculate Attempt Status and Official Points
        // Fetch all current grades for this attempt
        let current_grades = sqlx::query(
            "SELECT eg.question_revision_id, eg.state, eg.points
             FROM exam_grades eg
             JOIN exam_response_submissions ers ON eg.response_submission_id = ers.id
             WHERE ers.attempt_id = ?1 AND eg.is_current = 1",
        )
        .bind(&input.attempt_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch current grades: {}", e))
        })?;

        let mut grade_map = std::collections::HashMap::new();
        for row in current_grades {
            let q_id: String = row.get("question_revision_id");
            let state: String = row.get("state");
            let pts: Option<f64> = row
                .try_get("points")
                .or_else(|_| {
                    row.try_get::<Option<i64>, _>("points")
                        .map(|opt| opt.map(|i| i as f64))
                })
                .unwrap_or(None);
            grade_map.insert(q_id, (state, pts));
        }

        let mut all_final = true;
        let mut any_failed = false;
        let mut total_awarded = 0.0;

        for req_q_id in &question_revision_ids {
            match grade_map.get(req_q_id) {
                Some((state, pts)) => {
                    if state == "failed" {
                        any_failed = true;
                        all_final = false;
                    } else if state == "final" {
                        if let Some(p) = pts {
                            total_awarded += p;
                        } else {
                            all_final = false;
                        }
                    } else {
                        // "needs-review" or other non-final state
                        all_final = false;
                    }
                }
                None => {
                    // Question has no grade yet
                    all_final = false;
                }
            }
        }

        let next_status = if any_failed {
            "grading-failed"
        } else if all_final {
            "complete"
        } else {
            "partially-graded"
        };

        let final_awarded_points = if all_final { Some(total_awarded) } else { None };
        let new_attempt_revision = current_revision + 1;
        let completed_at = if all_final { Some(now.clone()) } else { None };

        sqlx::query(
            "UPDATE exam_attempts SET
                status = ?1,
                revision = ?2,
                awarded_points = ?3,
                completed_at = COALESCE(completed_at, ?4),
                updated_at = ?5
             WHERE id = ?6",
        )
        .bind(next_status)
        .bind(new_attempt_revision)
        .bind(final_awarded_points)
        .bind(completed_at)
        .bind(&now)
        .bind(&input.attempt_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update exam attempt: {}", e))
        })?;

        // 6. Optional Job Step settlement
        if let (Some(job_id), Some(step_key)) = (&input.job_id, &input.step_key) {
            let lease_owner = input.lease_owner.as_deref().unwrap_or("");
            sqlx::query(
                "UPDATE study_generation_steps SET
                    status = 'completed',
                    output_ref_id = ?1,
                    completed_at = ?2
                 WHERE job_id = ?3 AND step_key = ?4",
            )
            .bind(&new_grade_id)
            .bind(&now)
            .bind(job_id)
            .bind(step_key)
            .execute(&mut *tx)
            .await
            .ok();

            // Check if all steps in the job are complete
            let (pending_count,): (i64,) = sqlx::query_as(
                "SELECT count(*) FROM study_generation_steps
                 WHERE job_id = ?1 AND status != 'completed'",
            )
            .bind(job_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or((0,));

            if pending_count == 0 {
                sqlx::query(
                    "UPDATE study_generation_jobs SET
                        status = 'completed',
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?1
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(job_id)
                .execute(&mut *tx)
                .await
                .ok();
            }
        }

        // 7. Atomic evidence settlement for final current grades
        if input.state == "final" {
            crate::database::LearningEvidenceRepository::record_evidence_for_grade_tx(
                &mut tx,
                &new_grade_id,
            )
            .await?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit grade transaction: {}", e))
        })?;

        let created_grade = ExamGrade {
            id: new_grade_id,
            response_submission_id: input.response_submission_id,
            question_revision_id: input.question_revision_id,
            origin: input.origin,
            state: input.state,
            points: input.points,
            max_points: input.max_points,
            assessment_json: input.assessment_json,
            criteria_json: input.criteria_json,
            provenance_json: input.provenance_json,
            manual_reason: input.manual_reason,
            supersedes_grade_id: supersedes_id,
            is_current,
            created_at: now,
        };

        Ok(GradeSettlementOutcome {
            grade: created_grade,
            attempt_status: next_status.to_string(),
            attempt_revision: new_attempt_revision,
            awarded_points: final_awarded_points,
            maximum_points: attempt_maximum_points,
            is_complete: all_final,
        })
    }

    /// Authoritative manual grade recording.
    /// Validates every criterion against the committed rubric, recomputes full-precision
    /// points, and records the manual grade superseding prior current grades.
    pub async fn record_manual_grade(
        &self,
        input: RecordManualGradeInput,
    ) -> Result<GradeSettlementOutcome, StudyCommandError> {
        let trimmed_reason = input.manual_reason.trim();
        if trimmed_reason.is_empty() {
            return Err(StudyCommandError::invalid_input(
                "exam_grading.error.empty_manual_reason",
                vec![FieldIssue {
                    path: "manualReason".to_string(),
                    code: "empty_manual_reason".to_string(),
                    message_key: "exam_grading.error.empty_manual_reason".to_string(),
                }],
            ));
        }

        // Fetch question rubric and max points
        let q_row = sqlx::query(
            "SELECT max_points, rubric_json FROM assessment_question_revisions WHERE id = ?1",
        )
        .bind(&input.question_revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch question rubric: {}", e))
        })?;

        let q_row = match q_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Question revision '{}' not found",
                    input.question_revision_id
                )))
            }
        };

        let max_points: f64 = q_row
            .try_get("max_points")
            .or_else(|_| q_row.try_get::<i64, _>("max_points").map(|i| i as f64))
            .unwrap_or(0.0);
        let rubric_json: Option<String> = q_row.get("rubric_json");
        let rubric_json_str = match rubric_json {
            Some(s) => s,
            None => {
                return Err(StudyCommandError::invalid_input(
                    "exam_grading.error.missing_rubric",
                    vec![FieldIssue {
                        path: "rubric".to_string(),
                        code: "missing_rubric".to_string(),
                        message_key: "exam_grading.error.missing_rubric".to_string(),
                    }],
                ))
            }
        };

        let rubric_val: serde_json::Value =
            serde_json::from_str(&rubric_json_str).map_err(|e| {
                StudyCommandError::internal_error(format!("Failed to parse rubric JSON: {}", e))
            })?;

        let criteria_list = rubric_val
            .get("criteria")
            .and_then(|c| c.as_array())
            .ok_or_else(|| {
                StudyCommandError::internal_error("Rubric JSON missing criteria array".to_string())
            })?;

        let mut total_weight = 0.0;
        let mut weighted_levels = 0.0;
        let mut seen_ids = std::collections::HashSet::new();

        for crit in criteria_list {
            let crit_id = crit.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let weight = crit.get("weight").and_then(|v| v.as_f64()).unwrap_or(1.0);
            total_weight += weight;

            let manual_crit = input.criteria.iter().find(|m| m.criterion_id == crit_id);

            match manual_crit {
                Some(m) => {
                    if m.level < 0 || m.level > 4 {
                        return Err(StudyCommandError::invalid_input(
                            "exam_grading.error.invalid_level",
                            vec![FieldIssue {
                                path: format!("criteria[{}].level", crit_id),
                                code: "invalid_level".to_string(),
                                message_key: "exam_grading.error.invalid_level".to_string(),
                            }],
                        ));
                    }
                    seen_ids.insert(crit_id);
                    weighted_levels += weight * (m.level as f64 / 4.0);
                }
                None => {
                    return Err(StudyCommandError::invalid_input(
                        "exam_grading.error.omitted_criterion",
                        vec![FieldIssue {
                            path: format!("criteria[{}]", crit_id),
                            code: "omitted_criterion".to_string(),
                            message_key: "exam_grading.error.omitted_criterion".to_string(),
                        }],
                    ));
                }
            }
        }

        let calculated_points = if total_weight > 0.0 {
            (weighted_levels / total_weight) * max_points
        } else {
            0.0
        };

        let criteria_results: Vec<serde_json::Value> = input
            .criteria
            .iter()
            .map(|m| {
                serde_json::json!({
                    "criterionId": m.criterion_id,
                    "status": "manual",
                    "level": m.level,
                    "rationale": m.rationale
                })
            })
            .collect();

        let criteria_json = serde_json::to_string(&criteria_results).map_err(|e| {
            StudyCommandError::internal_error(format!("Failed to serialize manual criteria: {}", e))
        })?;

        self.record_rubric_grade(RecordRubricGradeInput {
            attempt_id: input.attempt_id,
            response_submission_id: input.response_submission_id,
            question_revision_id: input.question_revision_id,
            expected_attempt_revision: input.expected_attempt_revision,
            origin: "manual".to_string(),
            state: "final".to_string(),
            points: Some(calculated_points),
            max_points,
            outcome: Some(if calculated_points >= max_points * 0.75 {
                "correct".to_string()
            } else if calculated_points > 0.0 {
                "partial".to_string()
            } else {
                "incorrect".to_string()
            }),
            assessment_json: None,
            criteria_json,
            provenance_json: None,
            manual_reason: Some(trimmed_reason.to_string()),
            job_id: None,
            step_key: None,
            lease_owner: None,
            cancellation_epoch: None,
            input_hash: None,
        })
        .await
    }

    /// Fetches chronological grade history for a given response submission.
    pub async fn get_response_grade_history(
        &self,
        response_submission_id: &str,
    ) -> Result<Vec<ExamGrade>, StudyCommandError> {
        let rows = sqlx::query(
            "SELECT id, response_submission_id, question_revision_id, origin, state,
                    points, max_points, assessment_json, criteria_json, provenance_json,
                    manual_reason, supersedes_grade_id, is_current, created_at
             FROM exam_grades
             WHERE response_submission_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .bind(response_submission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query grade history: {}", e))
        })?;

        let mut history = Vec::with_capacity(rows.len());
        for row in rows {
            let is_cur: i64 = row.get("is_current");
            history.push(ExamGrade {
                id: row.get("id"),
                response_submission_id: row.get("response_submission_id"),
                question_revision_id: row.get("question_revision_id"),
                origin: row.get("origin"),
                state: row.get("state"),
                points: row
                    .try_get("points")
                    .or_else(|_| {
                        row.try_get::<Option<i64>, _>("points")
                            .map(|opt| opt.map(|i| i as f64))
                    })
                    .unwrap_or(None),
                max_points: row
                    .try_get("max_points")
                    .or_else(|_| row.try_get::<i64, _>("max_points").map(|i| i as f64))
                    .unwrap_or(0.0),
                assessment_json: row.get("assessment_json"),
                criteria_json: row.get("criteria_json"),
                provenance_json: row.get("provenance_json"),
                manual_reason: row.get("manual_reason"),
                supersedes_grade_id: row.get("supersedes_grade_id"),
                is_current: is_cur == 1,
                created_at: row.get("created_at"),
            });
        }

        Ok(history)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::models::rubric_grade::ManualCriterionGradeItem;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory db");
        run_migrations(&pool).await.expect("apply migrations");
        pool
    }

    async fn seed_test_attempt_and_submissions(
        pool: &Pool<Sqlite>,
    ) -> (String, String, String, String, String) {
        let _ = sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES ('doc_g', 'Doc', '/p.pdf', 'pdf', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z', 'text')"
        ).execute(pool).await;

        let _ = sqlx::query(
            "INSERT INTO study_plans (id, title, goal, depth, status, current_version, revision, created_at, updated_at)
             VALUES ('plan_g', 'Plan', 'Goal', 'survey', 'active', 0, 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(pool).await;

        let _ = sqlx::query(
            "INSERT INTO assessment_blueprints (id, plan_id, title, lifecycle, revision, created_at, updated_at)
             VALUES ('bp_g', 'plan_g', 'Exam', 'active', 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(pool).await;

        let _ = sqlx::query(
            "INSERT INTO assessment_blueprint_revisions (
                id, blueprint_id, revision, state, config_json, scoring_json,
                source_scope_json, quota_json, source_snapshot_hash, created_at, published_at
            ) VALUES ('bpr_g', 'bp_g', 1, 'ready', '{}', '{}', '{}', '{}', 'hash', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(pool).await;

        // Q1 (Short answer, 4 max points, rubric with 1 criterion)
        let rubric1 = serde_json::json!({
            "schemaVersion": 1,
            "expectedConcepts": ["ATP"],
            "gradingConstraints": [],
            "criteria": [
                {
                    "id": "crit_1",
                    "title": "ATP Synthesis",
                    "assessmentInstruction": "Evaluate ATP mechanism",
                    "weight": 100,
                    "grounding": "reasoning",
                    "sourceRefIds": [],
                    "keyFactIds": [],
                    "levels": { "0": "None", "1": "Vague", "2": "Fair", "3": "Good", "4": "Excellent" }
                }
            ]
        }).to_string();

        let _ = sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES ('q_g1', 'bp_g', 'fp_g1', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, rubric_json, max_points, difficulty, validation, committed_at, created_at
            ) VALUES ('aqr_g1', 'q_g1', 'bpr_g', 1, 'slot_0', 'fp_g1',
                      'short-answer', '{\"prompt\":\"Q1\"}', '{\"acceptedAnswers\":[\"ok\"]}', ?, 4, 3, 'valid', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).bind(&rubric1).execute(pool).await;

        // Q2 (Essay, 6 max points, rubric with 2 criteria)
        let rubric2 = serde_json::json!({
            "schemaVersion": 1,
            "expectedConcepts": ["Cell"],
            "gradingConstraints": [],
            "criteria": [
                {
                    "id": "crit_e1",
                    "title": "Structure",
                    "assessmentInstruction": "Evaluate Structure",
                    "weight": 50,
                    "grounding": "reasoning",
                    "sourceRefIds": [],
                    "keyFactIds": [],
                    "levels": { "0": "None", "1": "Vague", "2": "Fair", "3": "Good", "4": "Excellent" }
                },
                {
                    "id": "crit_e2",
                    "title": "Function",
                    "assessmentInstruction": "Evaluate Function",
                    "weight": 50,
                    "grounding": "reasoning",
                    "sourceRefIds": [],
                    "keyFactIds": [],
                    "levels": { "0": "None", "1": "Vague", "2": "Fair", "3": "Good", "4": "Excellent" }
                }
            ]
        }).to_string();

        let _ = sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES ('q_g2', 'bp_g', 'fp_g2', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await;

        let _ = sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, rubric_json, max_points, difficulty, validation, committed_at, created_at
            ) VALUES ('aqr_g2', 'q_g2', 'bpr_g', 1, 'slot_1', 'fp_g2',
                      'essay', '{\"prompt\":\"Q2\"}', '{\"expectedReasoning\":\"detail\"}', ?, 6, 4, 'valid', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).bind(&rubric2).execute(pool).await;

        // Attempt (status: 'submitted', revision: 1, max 10 points)
        let q_ids = serde_json::to_string(&vec!["aqr_g1", "aqr_g2"]).unwrap();
        let _ = sqlx::query(
            "INSERT INTO exam_attempts (
                id, blueprint_revision_id, client_start_key, mode, status,
                question_revision_ids_json, revision, started_at, submitted_at, maximum_points, created_at, updated_at
            ) VALUES ('att_g', 'bpr_g', 'key_start_g', 'exam', 'submitted',
                      ?, 1, '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z', 10, '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z')"
        ).bind(&q_ids).execute(pool).await;

        // Responses
        let _ = sqlx::query(
            "INSERT INTO exam_responses (id, attempt_id, question_revision_id, draft_json, mark, revision, last_client_mutation_id, updated_at)
             VALUES ('resp_g1', 'att_g', 'aqr_g1', '{\"text\":\"Ans 1\"}', 'answered', 1, 'mut_1', '2026-11-10T12:05:00Z')"
        ).execute(pool).await;

        let _ = sqlx::query(
            "INSERT INTO exam_responses (id, attempt_id, question_revision_id, draft_json, mark, revision, last_client_mutation_id, updated_at)
             VALUES ('resp_g2', 'att_g', 'aqr_g2', '{\"text\":\"Ans 2\"}', 'answered', 1, 'mut_2', '2026-11-10T12:10:00Z')"
        ).execute(pool).await;

        // Submissions
        let _ = sqlx::query(
            "INSERT INTO exam_response_submissions (id, response_id, attempt_id, question_revision_id, ordinal, kind, response_json, mark, hint_level, created_at)
             VALUES ('subm_g1', 'resp_g1', 'att_g', 'aqr_g1', 1, 'exam-final', '{\"text\":\"Ans 1\"}', 'answered', 0, '2026-11-10T12:30:00Z')"
        ).execute(pool).await;

        let _ = sqlx::query(
            "INSERT INTO exam_response_submissions (id, response_id, attempt_id, question_revision_id, ordinal, kind, response_json, mark, hint_level, created_at)
             VALUES ('subm_g2', 'resp_g2', 'att_g', 'aqr_g2', 1, 'exam-final', '{\"text\":\"Ans 2\"}', 'answered', 0, '2026-11-10T12:30:00Z')"
        ).execute(pool).await;

        (
            "att_g".to_string(),
            "subm_g1".to_string(),
            "aqr_g1".to_string(),
            "subm_g2".to_string(),
            "aqr_g2".to_string(),
        )
    }

    #[tokio::test]
    async fn test_record_rubric_grade_and_attempt_status_progression() {
        let pool = test_pool().await;
        let repo = ExamGradingRepository::new(pool);
        let (att_id, subm1, aqr1, subm2, aqr2) =
            seed_test_attempt_and_submissions(repo.pool()).await;

        // 1. Grade first question (Q1) with level 4 -> 4.0 points (full credit)
        let outcome1 = repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: att_id.clone(),
                response_submission_id: subm1.clone(),
                question_revision_id: aqr1.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("First grade succeeds");

        assert_eq!(outcome1.grade.points, Some(4.0));
        assert!(outcome1.grade.is_current);
        assert_eq!(outcome1.attempt_status, "partially-graded");
        assert_eq!(outcome1.attempt_revision, 2);
        assert_eq!(outcome1.awarded_points, None); // Still null because Q2 is unresolved!
        assert!(!outcome1.is_complete);

        // 2. Grade second question (Q2) with level 2 -> 3.0 points
        let outcome2 = repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: att_id.clone(),
                response_submission_id: subm2.clone(),
                question_revision_id: aqr2.clone(),
                expected_attempt_revision: 2,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(3.0),
                max_points: 6.0,
                outcome: Some("partial".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("Second grade succeeds");

        assert_eq!(outcome2.grade.points, Some(3.0));
        assert_eq!(outcome2.attempt_status, "complete");
        assert_eq!(outcome2.attempt_revision, 3);
        assert_eq!(outcome2.awarded_points, Some(7.0)); // 4.0 + 3.0 = 7.0!
        assert!(outcome2.is_complete);
    }

    #[tokio::test]
    async fn test_manual_grade_overrides_and_protects_from_ai_displacement() {
        let pool = test_pool().await;
        let repo = ExamGradingRepository::new(pool);
        let (att_id, subm1, aqr1, _, _) = seed_test_attempt_and_submissions(repo.pool()).await;

        // 1. Initial AI grade (2.0 points)
        let ai_outcome = repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: att_id.clone(),
                response_submission_id: subm1.clone(),
                question_revision_id: aqr1.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(2.0),
                max_points: 4.0,
                outcome: Some("partial".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .unwrap();

        assert_eq!(ai_outcome.grade.origin, "ai");
        assert!(ai_outcome.grade.is_current);

        // 2. Teacher records authoritative Manual grade with reason
        let manual_outcome = repo
            .record_manual_grade(RecordManualGradeInput {
                attempt_id: att_id.clone(),
                response_submission_id: subm1.clone(),
                question_revision_id: aqr1.clone(),
                expected_attempt_revision: 2,
                criteria: vec![ManualCriterionGradeItem {
                    criterion_id: "crit_1".to_string(),
                    level: 4, // 100% of 4 points = 4.0
                    rationale: Some("Student used valid alternate terminology".to_string()),
                }],
                manual_reason: "Approved valid alternate biological phrasing".to_string(),
            })
            .await
            .expect("Manual grade succeeds");

        assert_eq!(manual_outcome.grade.origin, "manual");
        assert!(manual_outcome.grade.is_current);
        assert_eq!(manual_outcome.grade.points, Some(4.0));
        assert_eq!(
            manual_outcome.grade.supersedes_grade_id,
            Some(ai_outcome.grade.id.clone())
        );

        // Check history: previous AI grade is now is_current = false
        let history = repo.get_response_grade_history(&subm1).await.unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, ai_outcome.grade.id);
        assert!(!history[0].is_current);
        assert_eq!(history[1].id, manual_outcome.grade.id);
        assert!(history[1].is_current);

        // 3. Late arriving AI callback tries to record an AI grade
        let late_ai_outcome = repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: att_id.clone(),
                response_submission_id: subm1.clone(),
                question_revision_id: aqr1.clone(),
                expected_attempt_revision: 3,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(1.0),
                max_points: 4.0,
                outcome: Some("partial".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("Late AI grade accepted into history");

        // Late AI grade MUST NOT displace the current manual grade!
        assert_eq!(late_ai_outcome.grade.origin, "ai");
        assert!(
            !late_ai_outcome.grade.is_current,
            "Late AI grade must NOT be current when a manual grade exists"
        );

        // Verify the manual grade is STILL current in the DB
        let current_check = repo.get_response_grade_history(&subm1).await.unwrap();
        let current_grade = current_check.iter().find(|g| g.is_current).unwrap();
        assert_eq!(current_grade.id, manual_outcome.grade.id);
        assert_eq!(current_grade.origin, "manual");
        assert_eq!(current_grade.points, Some(4.0));
    }

    #[tokio::test]
    async fn test_cas_mismatch_and_stale_revision() {
        let pool = test_pool().await;
        let repo = ExamGradingRepository::new(pool);
        let (att_id, subm1, aqr1, _, _) = seed_test_attempt_and_submissions(repo.pool()).await;

        let res = repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: att_id,
                response_submission_id: subm1,
                question_revision_id: aqr1,
                expected_attempt_revision: 999, // Mismatch (actual is 1)
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await;

        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_manual_grade_empty_reason_rejection() {
        let pool = test_pool().await;
        let repo = ExamGradingRepository::new(pool);
        let (att_id, subm1, aqr1, _, _) = seed_test_attempt_and_submissions(repo.pool()).await;

        let res = repo
            .record_manual_grade(RecordManualGradeInput {
                attempt_id: att_id,
                response_submission_id: subm1,
                question_revision_id: aqr1,
                expected_attempt_revision: 1,
                criteria: vec![ManualCriterionGradeItem {
                    criterion_id: "crit_1".to_string(),
                    level: 4,
                    rationale: None,
                }],
                manual_reason: "   ".to_string(), // Blank reason!
            })
            .await;

        assert!(res.is_err(), "Empty manual reason must be rejected");
    }
}
