/**
 * SQLite Repository for Exam Sessions, Responses, Submissions, and Grades.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§5–7, §11, §12
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §6
 * - openspec/changes/implement-resumable-examination-sessions/
 */
use chrono::Utc;
use sqlx::{FromRow, Pool, Sqlite};
use uuid::Uuid;

use crate::models::exam_session::*;
use crate::models::study_source::StudyCommandError;

#[derive(FromRow)]
struct AttemptDbRow {
    id: String,
    blueprint_revision_id: String,
    client_start_key: String,
    mode: String,
    status: String,
    question_revision_ids_json: String,
    revision: i64,
    started_at: String,
    deadline_at: Option<String>,
    submitted_at: Option<String>,
    completed_at: Option<String>,
    submission_reason: Option<String>,
    submission_key: Option<String>,
    awarded_points: Option<f64>,
    maximum_points: f64,
    created_at: String,
    updated_at: String,
}

#[derive(FromRow)]
struct ResponseDbRow {
    id: String,
    attempt_id: String,
    question_revision_id: String,
    draft_json: String,
    mark: String,
    revision: i64,
    last_client_mutation_id: String,
    updated_at: String,
}

#[derive(FromRow)]
struct SubmissionDbRow {
    id: String,
    response_id: String,
    attempt_id: String,
    question_revision_id: String,
    ordinal: i64,
    kind: String,
    response_json: String,
    mark: String,
    hint_level: i64,
    created_at: String,
}

#[derive(FromRow)]
struct GradeDbRow {
    id: String,
    response_submission_id: String,
    question_revision_id: String,
    origin: String,
    state: String,
    points: Option<f64>,
    max_points: f64,
    assessment_json: Option<String>,
    criteria_json: String,
    provenance_json: Option<String>,
    manual_reason: Option<String>,
    supersedes_grade_id: Option<String>,
    is_current: i64,
    created_at: String,
}

#[derive(FromRow)]
struct AttemptSummaryDbRow {
    id: String,
    blueprint_revision_id: String,
    blueprint_id: String,
    blueprint_title: String,
    mode: String,
    status: String,
    started_at: String,
    deadline_at: Option<String>,
    completed_at: Option<String>,
    awarded_points: Option<f64>,
    maximum_points: f64,
    question_revision_ids_json: String,
}

pub struct ExamSessionRepository;

impl ExamSessionRepository {
    /// Starts a new exam attempt for a Ready blueprint revision.
    /// If an attempt already exists with the given client_start_key for this blueprint revision,
    /// returns the existing attempt idempotently.
    pub async fn start_exam_attempt(
        pool: &Pool<Sqlite>,
        input: StartAttemptInput,
    ) -> Result<AttemptDetail, StudyCommandError> {
        // 1. Idempotency check: see if an attempt already exists for (blueprint_revision_id, client_start_key)
        let existing_attempt_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM exam_attempts WHERE blueprint_revision_id = ? AND client_start_key = ?",
        )
        .bind(&input.blueprint_revision_id)
        .bind(&input.client_start_key)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query existing attempt: {}", e))
        })?;

        if let Some(id) = existing_attempt_id {
            return Self::get_exam_attempt(pool, &id).await;
        }

        // 2. Fetch blueprint revision details & state
        let blueprint_row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT state, config_json, blueprint_id FROM assessment_blueprint_revisions WHERE id = ?",
        )
        .bind(&input.blueprint_revision_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to query blueprint revision: {}", e)))?;

        let (state, config_json, _blueprint_id) = match blueprint_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.revision_not_found",
                ))
            }
        };

        if state != "ready" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.blueprint_not_ready",
            ));
        }

        // Parse config to inspect mode and time limit
        let config_val: serde_json::Value = serde_json::from_str(&config_json).map_err(|e| {
            StudyCommandError::internal_error(format!("Malformed config JSON: {}", e))
        })?;
        let mode = config_val["mode"].as_str().unwrap_or("exam").to_string();
        let time_limit_seconds = config_val["timeLimitSeconds"].as_i64();

        // 3. Fetch all valid question revisions for this blueprint revision ordered by slot_key
        let questions: Vec<(String, i64, String, String)> = sqlx::query_as(
            "SELECT id, max_points, slot_key, kind
             FROM assessment_question_revisions
             WHERE blueprint_revision_id = ? AND validation = 'valid'
             ORDER BY slot_key ASC",
        )
        .bind(&input.blueprint_revision_id)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query question revisions: {}", e))
        })?;

        if questions.is_empty() {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.no_valid_questions",
            ));
        }

        let mut maximum_points: f64 = 0.0;
        let mut question_revision_ids: Vec<String> = Vec::with_capacity(questions.len());
        for q in &questions {
            maximum_points += q.1 as f64;
            question_revision_ids.push(q.0.clone());
        }

        let now = Utc::now();
        let started_at = now.to_rfc3339();
        let deadline_at = if mode == "exam" {
            time_limit_seconds.and_then(|secs| {
                if secs > 0 {
                    Some((now + chrono::Duration::seconds(secs)).to_rfc3339())
                } else {
                    None
                }
            })
        } else {
            None
        };

        let attempt_id = format!("att_{}", Uuid::new_v4().simple());
        let question_revision_ids_json =
            serde_json::to_string(&question_revision_ids).map_err(|e| {
                StudyCommandError::internal_error(format!(
                    "Failed to serialize question ids: {}",
                    e
                ))
            })?;

        // 4. Atomic transaction: create attempt and ordered response slots
        let mut tx = pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        sqlx::query(
            "INSERT INTO exam_attempts (
                id, blueprint_revision_id, client_start_key, mode, status,
                question_revision_ids_json, revision, started_at, deadline_at,
                maximum_points, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'in-progress', ?, 1, ?, ?, ?, ?, ?)",
        )
        .bind(&attempt_id)
        .bind(&input.blueprint_revision_id)
        .bind(&input.client_start_key)
        .bind(&mode)
        .bind(&question_revision_ids_json)
        .bind(&started_at)
        .bind(&deadline_at)
        .bind(maximum_points)
        .bind(&started_at)
        .bind(&started_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to insert attempt: {}", e))
        })?;

        for (q_id, _max_pts, _slot, kind) in &questions {
            let response_id = format!("resp_{}", Uuid::new_v4().simple());
            let mutation_id = format!("mut_{}", Uuid::new_v4().simple());
            let default_draft = match kind.as_str() {
                "single-select" => r#"{"kind":"single-select","optionId":null}"#,
                "multi-select" => r#"{"kind":"multi-select","optionIds":[]}"#,
                "cloze" => r#"{"kind":"cloze","answers":{}}"#,
                "short-answer" => r#"{"kind":"short-answer","text":""}"#,
                "essay" => r#"{"kind":"essay","text":""}"#,
                _ => r#"{"kind":"unsupported"}"#,
            };

            sqlx::query(
                "INSERT INTO exam_responses (
                    id, attempt_id, question_revision_id, draft_json, mark,
                    revision, last_client_mutation_id, updated_at
                ) VALUES (?, ?, ?, ?, 'unanswered', 1, ?, ?)",
            )
            .bind(&response_id)
            .bind(&attempt_id)
            .bind(q_id)
            .bind(default_draft)
            .bind(&mutation_id)
            .bind(&started_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!(
                    "Failed to insert initial response: {}",
                    e
                ))
            })?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit attempt creation: {}", e))
        })?;

        Self::get_exam_attempt(pool, &attempt_id).await
    }

    /// Fetches full attempt details including responses, submissions, and current grades.
    pub async fn get_exam_attempt(
        pool: &Pool<Sqlite>,
        attempt_id: &str,
    ) -> Result<AttemptDetail, StudyCommandError> {
        let attempt_row: Option<AttemptDbRow> = sqlx::query_as(
            "SELECT id, blueprint_revision_id, client_start_key, mode, status,
                    question_revision_ids_json, revision, started_at, deadline_at,
                    submitted_at, completed_at, submission_reason, submission_key,
                    awarded_points, maximum_points, created_at, updated_at
             FROM exam_attempts WHERE id = ?",
        )
        .bind(attempt_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query attempt: {}", e))
        })?;

        let r = match attempt_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.attempt_not_found",
                ))
            }
        };

        let question_revision_ids: Vec<String> =
            serde_json::from_str(&r.question_revision_ids_json).unwrap_or_default();
        let attempt = ExamAttempt {
            id: r.id,
            blueprint_revision_id: r.blueprint_revision_id,
            client_start_key: r.client_start_key,
            mode: r.mode,
            status: r.status,
            question_revision_ids,
            revision: r.revision,
            started_at: r.started_at,
            deadline_at: r.deadline_at,
            submitted_at: r.submitted_at,
            completed_at: r.completed_at,
            submission_reason: r.submission_reason,
            submission_key: r.submission_key,
            awarded_points: r.awarded_points,
            maximum_points: r.maximum_points,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };

        // Query responses
        let response_rows: Vec<ResponseDbRow> = sqlx::query_as(
            "SELECT id, attempt_id, question_revision_id, draft_json, mark,
                    revision, last_client_mutation_id, updated_at
             FROM exam_responses WHERE attempt_id = ?",
        )
        .bind(attempt_id)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query responses: {}", e))
        })?;

        let responses = response_rows
            .into_iter()
            .map(|row| ExamResponse {
                id: row.id,
                attempt_id: row.attempt_id,
                question_revision_id: row.question_revision_id,
                draft_json: row.draft_json,
                mark: row.mark,
                revision: row.revision,
                last_client_mutation_id: row.last_client_mutation_id,
                updated_at: row.updated_at,
            })
            .collect();

        // Query submissions ordered by ordinal
        let sub_rows: Vec<SubmissionDbRow> = sqlx::query_as(
            "SELECT id, response_id, attempt_id, question_revision_id, ordinal,
                    kind, response_json, mark, hint_level, created_at
             FROM exam_response_submissions WHERE attempt_id = ?
             ORDER BY ordinal ASC",
        )
        .bind(attempt_id)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query submissions: {}", e))
        })?;

        let submissions = sub_rows
            .into_iter()
            .map(|row| ResponseSubmission {
                id: row.id,
                response_id: row.response_id,
                attempt_id: row.attempt_id,
                question_revision_id: row.question_revision_id,
                ordinal: row.ordinal,
                kind: row.kind,
                response_json: row.response_json,
                mark: row.mark,
                hint_level: row.hint_level,
                created_at: row.created_at,
            })
            .collect();

        // Query current grades
        let grade_rows: Vec<GradeDbRow> = sqlx::query_as(
            "SELECT g.id, g.response_submission_id, g.question_revision_id, g.origin, g.state,
                    g.points, g.max_points, g.assessment_json, g.criteria_json, g.provenance_json,
                    g.manual_reason, g.supersedes_grade_id, g.is_current, g.created_at
             FROM exam_grades g
             JOIN exam_response_submissions s ON g.response_submission_id = s.id
             WHERE s.attempt_id = ? AND g.is_current = 1",
        )
        .bind(attempt_id)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query current grades: {}", e))
        })?;

        let current_grades = grade_rows
            .into_iter()
            .map(|row| ExamGrade {
                id: row.id,
                response_submission_id: row.response_submission_id,
                question_revision_id: row.question_revision_id,
                origin: row.origin,
                state: row.state,
                points: row.points,
                max_points: row.max_points,
                assessment_json: row.assessment_json,
                criteria_json: row.criteria_json,
                provenance_json: row.provenance_json,
                manual_reason: row.manual_reason,
                supersedes_grade_id: row.supersedes_grade_id,
                is_current: row.is_current == 1,
                created_at: row.created_at,
            })
            .collect();

        Ok(AttemptDetail {
            attempt,
            responses,
            submissions,
            current_grades,
        })
    }

    /// Lists attempt summaries matching optional filters.
    pub async fn list_exam_attempts(
        pool: &Pool<Sqlite>,
        filter: AttemptHistoryFilter,
    ) -> Result<Vec<AttemptSummary>, StudyCommandError> {
        let mut query = String::from(
            "SELECT a.id, a.blueprint_revision_id, b.id as blueprint_id, b.title as blueprint_title,
                    a.mode, a.status, a.started_at, a.deadline_at, a.completed_at,
                    a.awarded_points, a.maximum_points, a.question_revision_ids_json
             FROM exam_attempts a
             JOIN assessment_blueprint_revisions r ON a.blueprint_revision_id = r.id
             JOIN assessment_blueprints b ON r.blueprint_id = b.id
             WHERE 1=1",
        );

        if filter.blueprint_revision_id.is_some() {
            query.push_str(" AND a.blueprint_revision_id = ?");
        }
        if filter.blueprint_id.is_some() {
            query.push_str(" AND b.id = ?");
        }
        if filter.mode.is_some() {
            query.push_str(" AND a.mode = ?");
        }
        if filter.status.is_some() {
            query.push_str(" AND a.status = ?");
        }
        query.push_str(" ORDER BY a.started_at DESC");

        let mut q = sqlx::query_as::<Sqlite, AttemptSummaryDbRow>(&query);

        if let Some(ref val) = filter.blueprint_revision_id {
            q = q.bind(val);
        }
        if let Some(ref val) = filter.blueprint_id {
            q = q.bind(val);
        }
        if let Some(ref val) = filter.mode {
            q = q.bind(val);
        }
        if let Some(ref val) = filter.status {
            q = q.bind(val);
        }

        let rows = q.fetch_all(pool).await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to list attempts: {}", e))
        })?;

        let summaries = rows
            .into_iter()
            .map(|r| {
                let ids: Vec<String> =
                    serde_json::from_str(&r.question_revision_ids_json).unwrap_or_default();
                AttemptSummary {
                    id: r.id,
                    blueprint_revision_id: r.blueprint_revision_id,
                    blueprint_id: r.blueprint_id,
                    blueprint_title: r.blueprint_title,
                    mode: r.mode,
                    status: r.status,
                    started_at: r.started_at,
                    deadline_at: r.deadline_at,
                    completed_at: r.completed_at,
                    awarded_points: r.awarded_points,
                    maximum_points: r.maximum_points,
                    question_count: ids.len() as i64,
                }
            })
            .collect();

        Ok(summaries)
    }

    /// Saves a learner draft response with CAS revision check and client mutation id deduplication.
    pub async fn save_exam_response(
        pool: &Pool<Sqlite>,
        input: SaveResponseInput,
    ) -> Result<ExamResponse, StudyCommandError> {
        // 1. Verify attempt status is in-progress
        let attempt_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM exam_attempts WHERE id = ?")
                .bind(&input.attempt_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| {
                    StudyCommandError::storage_failed(format!(
                        "Failed to query attempt status: {}",
                        e
                    ))
                })?;

        match attempt_status {
            Some(s) if s == "in-progress" => {}
            Some(_) => {
                return Err(StudyCommandError::invalid_state(
                    "study.assessment.error.attempt_not_in_progress",
                ))
            }
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.attempt_not_found",
                ))
            }
        }

        // 2. Fetch existing response
        let resp_row: Option<(String, String, String, String, String, i64, String, String)> =
            sqlx::query_as(
                "SELECT id, attempt_id, question_revision_id, draft_json, mark,
                        revision, last_client_mutation_id, updated_at
                 FROM exam_responses WHERE id = ? AND attempt_id = ?",
            )
            .bind(&input.response_id)
            .bind(&input.attempt_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to query response: {}", e))
            })?;

        let existing = match resp_row {
            Some(r) => r,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.response_not_found",
                ))
            }
        };

        let existing_draft = existing.3;
        let existing_mark = existing.4;
        let existing_revision = existing.5;
        let existing_mutation_id = existing.6;

        // 3. Client mutation ID check
        if existing_mutation_id == input.last_client_mutation_id {
            if existing_draft == input.draft_json && existing_mark == input.mark {
                // Idempotent exact replay: return existing without bumping revision
                return Ok(ExamResponse {
                    id: existing.0,
                    attempt_id: existing.1,
                    question_revision_id: existing.2,
                    draft_json: existing_draft,
                    mark: existing_mark,
                    revision: existing_revision,
                    last_client_mutation_id: existing_mutation_id,
                    updated_at: existing.7,
                });
            } else {
                return Err(StudyCommandError::invalid_input(
                    "study.assessment.error.mutation_id_reused_with_different_payload",
                    vec![],
                ));
            }
        }

        // 4. CAS revision check
        if existing_revision != input.expected_response_revision {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_response_revision",
            ));
        }

        let now = Utc::now().to_rfc3339();
        let new_revision = existing_revision + 1;

        let result = sqlx::query(
            "UPDATE exam_responses
             SET draft_json = ?, mark = ?, revision = ?, last_client_mutation_id = ?, updated_at = ?
             WHERE id = ? AND revision = ?",
        )
        .bind(&input.draft_json)
        .bind(&input.mark)
        .bind(new_revision)
        .bind(&input.last_client_mutation_id)
        .bind(&now)
        .bind(&input.response_id)
        .bind(existing_revision)
        .execute(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update response: {}", e))
        })?;

        if result.rows_affected() == 0 {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_response_revision",
            ));
        }

        Ok(ExamResponse {
            id: input.response_id,
            attempt_id: input.attempt_id,
            question_revision_id: existing.2,
            draft_json: input.draft_json,
            mark: input.mark,
            revision: new_revision,
            last_client_mutation_id: input.last_client_mutation_id,
            updated_at: now,
        })
    }

    /// Submits an examination attempt, recording final submissions and objective grades.
    pub async fn submit_exam_attempt(
        pool: &Pool<Sqlite>,
        input: SubmitAttemptInput,
    ) -> Result<AttemptDetail, StudyCommandError> {
        // 1. Fetch current attempt row
        let attempt_row: Option<(String, i64, Option<String>, f64, String)> = sqlx::query_as(
            "SELECT status, revision, submission_key, maximum_points, question_revision_ids_json
             FROM exam_attempts WHERE id = ?",
        )
        .bind(&input.attempt_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query attempt: {}", e))
        })?;

        let (status, revision, existing_sub_key, maximum_points, q_ids_json) = match attempt_row {
            Some(r) => r,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.attempt_not_found",
                ))
            }
        };

        // 2. Check if already submitted
        if status != "in-progress" {
            if existing_sub_key.as_deref() == Some(&input.submission_key) {
                // Exact key replay: return current attempt state
                return Self::get_exam_attempt(pool, &input.attempt_id).await;
            } else {
                // Duplicate submit with new key: return current state without error (no-op)
                return Self::get_exam_attempt(pool, &input.attempt_id).await;
            }
        }

        // 3. CAS revision check
        if revision != input.expected_attempt_revision {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_attempt_revision",
            ));
        }

        // 4. Validate submission reason
        if !["user", "timer", "timer-recovered"].contains(&input.submission_reason.as_str()) {
            return Err(StudyCommandError::invalid_input(
                "study.assessment.error.invalid_submission_reason",
                vec![],
            ));
        }

        let question_revision_ids: Vec<String> =
            serde_json::from_str(&q_ids_json).unwrap_or_default();
        let total_questions = question_revision_ids.len();

        let mut tx = pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        // 5. Query all responses
        let responses: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT id, question_revision_id, draft_json, mark
             FROM exam_responses WHERE attempt_id = ?",
        )
        .bind(&input.attempt_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to query responses for submit: {}",
                e
            ))
        })?;

        let now = Utc::now().to_rfc3339();

        let grade_map: std::collections::HashMap<&str, &ObjectiveGradeOutput> = input
            .objective_grades
            .iter()
            .map(|g| (g.question_revision_id.as_str(), g))
            .collect();

        let mut final_count = 0;
        let mut total_final_points = 0.0;
        let mut has_failed = false;

        for (resp_id, q_rev_id, draft_json, mark) in &responses {
            let sub_id = format!("sub_{}", Uuid::new_v4().simple());
            sqlx::query(
                "INSERT INTO exam_response_submissions (
                    id, response_id, attempt_id, question_revision_id, ordinal,
                    kind, response_json, mark, hint_level, created_at
                ) VALUES (?, ?, ?, ?, 1, 'exam-final', ?, ?, 0, ?)",
            )
            .bind(&sub_id)
            .bind(resp_id)
            .bind(&input.attempt_id)
            .bind(q_rev_id)
            .bind(draft_json)
            .bind(mark)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!(
                    "Failed to insert final submission: {}",
                    e
                ))
            })?;

            if let Some(grade) = grade_map.get(q_rev_id.as_str()) {
                if grade.state == "failed" {
                    has_failed = true;
                }
                if grade.state == "final" && grade.points.is_some() {
                    final_count += 1;
                    total_final_points += grade.points.unwrap();
                }

                let grade_id = format!("grd_{}", Uuid::new_v4().simple());
                sqlx::query(
                    "INSERT INTO exam_grades (
                        id, response_submission_id, question_revision_id, origin, state,
                        points, max_points, criteria_json, is_current, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?)",
                )
                .bind(&grade_id)
                .bind(&sub_id)
                .bind(q_rev_id)
                .bind(&grade.origin)
                .bind(&grade.state)
                .bind(grade.points)
                .bind(grade.max_points)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    StudyCommandError::storage_failed(format!("Failed to insert grade: {}", e))
                })?;

                if grade.state == "final" {
                    crate::database::LearningEvidenceRepository::record_evidence_for_grade_tx(
                        &mut tx,
                        &grade_id,
                    )
                    .await?;
                }
            }
        }

        // 6. Derive final attempt status
        let is_fully_final = total_questions > 0 && final_count == total_questions;
        let (new_status, awarded_points, completed_at) = if is_fully_final {
            ("complete", Some(total_final_points), Some(now.clone()))
        } else if has_failed {
            ("grading-failed", None, None)
        } else if final_count > 0 {
            ("partially-graded", None, None)
        } else {
            ("submitted", None, None)
        };

        // Safety check points bound
        if let Some(pts) = awarded_points {
            if pts < 0.0 || pts > maximum_points {
                return Err(StudyCommandError::invalid_input(
                    "study.assessment.error.awarded_points_out_of_bounds",
                    vec![],
                ));
            }
        }

        let new_attempt_revision = revision + 1;
        sqlx::query(
            "UPDATE exam_attempts
             SET status = ?, revision = ?, submitted_at = ?, completed_at = ?,
                 submission_reason = ?, submission_key = ?, awarded_points = ?, updated_at = ?
             WHERE id = ? AND revision = ?",
        )
        .bind(new_status)
        .bind(new_attempt_revision)
        .bind(&now)
        .bind(&completed_at)
        .bind(&input.submission_reason)
        .bind(&input.submission_key)
        .bind(awarded_points)
        .bind(&now)
        .bind(&input.attempt_id)
        .bind(revision)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update attempt: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit attempt submission: {}", e))
        })?;

        Self::get_exam_attempt(pool, &input.attempt_id).await
    }

    /// Checks a practice response and persists a new practice-check submission round.
    pub async fn check_practice_response(
        pool: &Pool<Sqlite>,
        input: CheckPracticeInput,
    ) -> Result<PracticeCheckResult, StudyCommandError> {
        // 1. Fetch attempt and verify mode is practice and status is in-progress
        let attempt_row: Option<(String, String, i64)> =
            sqlx::query_as("SELECT mode, status, revision FROM exam_attempts WHERE id = ?")
                .bind(&input.attempt_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| {
                    StudyCommandError::storage_failed(format!("Failed to query attempt: {}", e))
                })?;

        let (mode, status, attempt_revision) = match attempt_row {
            Some(r) => r,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.attempt_not_found",
                ))
            }
        };

        if mode != "practice" || status != "in-progress" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.practice_check_not_allowed",
            ));
        }

        if attempt_revision != input.expected_attempt_revision {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_attempt_revision",
            ));
        }

        // 2. Fetch response
        let resp_row: Option<(String, String)> = sqlx::query_as(
            "SELECT id, question_revision_id FROM exam_responses WHERE id = ? AND attempt_id = ?",
        )
        .bind(&input.response_id)
        .bind(&input.attempt_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query response: {}", e))
        })?;

        let (resp_id, q_rev_id) = match resp_row {
            Some(r) => r,
            None => {
                return Err(StudyCommandError::not_found(
                    "study.assessment.error.response_not_found",
                ))
            }
        };

        let now = Utc::now().to_rfc3339();
        let mut tx = pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        // 3. Update response draft with current check values
        sqlx::query(
            "UPDATE exam_responses
             SET draft_json = ?, mark = ?, revision = revision + 1, last_client_mutation_id = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.draft_json)
        .bind(&input.mark)
        .bind(&input.client_mutation_id)
        .bind(&now)
        .bind(&resp_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to flush response draft: {}", e)))?;

        // 4. Compute next ordinal for this response
        let next_ordinal: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM exam_response_submissions WHERE response_id = ?",
        )
        .bind(&resp_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to get next ordinal: {}", e)))?;

        let sub_id = format!("sub_{}", Uuid::new_v4().simple());
        sqlx::query(
            "INSERT INTO exam_response_submissions (
                id, response_id, attempt_id, question_revision_id, ordinal,
                kind, response_json, mark, hint_level, created_at
            ) VALUES (?, ?, ?, ?, ?, 'practice-check', ?, ?, ?, ?)",
        )
        .bind(&sub_id)
        .bind(&resp_id)
        .bind(&input.attempt_id)
        .bind(&q_rev_id)
        .bind(next_ordinal)
        .bind(&input.draft_json)
        .bind(&input.mark)
        .bind(input.hint_level)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to insert practice check submission: {}",
                e
            ))
        })?;

        let submission = ResponseSubmission {
            id: sub_id.clone(),
            response_id: resp_id,
            attempt_id: input.attempt_id.clone(),
            question_revision_id: q_rev_id.clone(),
            ordinal: next_ordinal,
            kind: "practice-check".to_string(),
            response_json: input.draft_json,
            mark: input.mark,
            hint_level: input.hint_level,
            created_at: now.clone(),
        };

        // 5. If objective grade provided, record it
        let mut grade_res: Option<ExamGrade> = None;
        if let Some(ref og) = input.objective_grade {
            // Unset prior is_current for this response's submissions
            sqlx::query(
                "UPDATE exam_grades
                 SET is_current = 0
                 WHERE response_submission_id IN (
                     SELECT id FROM exam_response_submissions WHERE response_id = ?
                 )",
            )
            .bind(&input.response_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to reset is_current: {}", e))
            })?;

            let grade_id = format!("grd_{}", Uuid::new_v4().simple());
            sqlx::query(
                "INSERT INTO exam_grades (
                    id, response_submission_id, question_revision_id, origin, state,
                    points, max_points, criteria_json, is_current, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?)",
            )
            .bind(&grade_id)
            .bind(&sub_id)
            .bind(&q_rev_id)
            .bind(&og.origin)
            .bind(&og.state)
            .bind(og.points)
            .bind(og.max_points)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to insert practice grade: {}", e))
            })?;

            if og.state == "final" {
                crate::database::LearningEvidenceRepository::record_evidence_for_grade_tx(
                    &mut tx,
                    &grade_id,
                )
                .await?;
            }

            grade_res = Some(ExamGrade {
                id: grade_id,
                response_submission_id: sub_id,
                question_revision_id: q_rev_id,
                origin: og.origin.clone(),
                state: og.state.clone(),
                points: og.points,
                max_points: og.max_points,
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                supersedes_grade_id: None,
                is_current: true,
                created_at: now.clone(),
            });
        }

        // 6. Bump attempt revision
        let new_attempt_revision = attempt_revision + 1;
        sqlx::query("UPDATE exam_attempts SET revision = ?, updated_at = ? WHERE id = ?")
            .bind(new_attempt_revision)
            .bind(&now)
            .bind(&input.attempt_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to bump attempt revision: {}", e))
            })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit practice check: {}", e))
        })?;

        Ok(PracticeCheckResult {
            submission,
            grade: grade_res,
            attempt_revision: new_attempt_revision,
        })
    }

    /// Cancels an in-progress attempt, retaining its response history in read-only status.
    pub async fn cancel_exam_attempt(
        pool: &Pool<Sqlite>,
        attempt_id: &str,
        expected_revision: i64,
    ) -> Result<AttemptDetail, StudyCommandError> {
        let (status, revision): (String, i64) =
            sqlx::query_as("SELECT status, revision FROM exam_attempts WHERE id = ?")
                .bind(attempt_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| {
                    StudyCommandError::storage_failed(format!("Failed to query attempt: {}", e))
                })?
                .ok_or_else(|| {
                    StudyCommandError::not_found("study.assessment.error.attempt_not_found")
                })?;

        if status != "in-progress" {
            return Err(StudyCommandError::invalid_state(
                "study.assessment.error.attempt_not_in_progress",
            ));
        }

        if revision != expected_revision {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_attempt_revision",
            ));
        }

        let now = Utc::now().to_rfc3339();
        let new_revision = revision + 1;

        let result = sqlx::query(
            "UPDATE exam_attempts
             SET status = 'cancelled', revision = ?, updated_at = ?
             WHERE id = ? AND revision = ?",
        )
        .bind(new_revision)
        .bind(&now)
        .bind(attempt_id)
        .bind(revision)
        .execute(pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to cancel attempt: {}", e))
        })?;

        if result.rows_affected() == 0 {
            return Err(StudyCommandError::stale_revision(
                "study.assessment.error.stale_attempt_revision",
            ));
        }

        Self::get_exam_attempt(pool, attempt_id).await
    }

    /// Deletes an exam attempt and cascades deletion to all responses, submissions, and grades.
    pub async fn delete_exam_history(
        pool: &Pool<Sqlite>,
        attempt_id: &str,
    ) -> Result<(), StudyCommandError> {
        let affected_concepts: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT le.concept_id FROM learning_evidence le
             JOIN exam_grades g ON g.id = le.grade_id
             JOIN exam_response_submissions s ON s.id = g.response_submission_id
             WHERE s.attempt_id = ?1",
        )
        .bind(attempt_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let mut tx = pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin delete transaction: {}", e))
        })?;

        let result = sqlx::query("DELETE FROM exam_attempts WHERE id = ?")
            .bind(attempt_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to delete exam attempt: {}", e))
            })?;

        if result.rows_affected() == 0 {
            return Err(StudyCommandError::not_found(
                "study.assessment.error.attempt_not_found",
            ));
        }

        if !affected_concepts.is_empty() {
            crate::database::LearningEvidenceRepository::recompute_concepts_tx(
                &mut tx,
                &affected_concepts,
                None,
            )
            .await?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit delete transaction: {}", e))
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory db");
        run_migrations(&pool).await.expect("apply migrations");
        pool
    }

    async fn seed_test_blueprint(
        pool: &Pool<Sqlite>,
        bp_id: &str,
        rev_id: &str,
        state: &str,
        mode: &str,
        time_limit: Option<i64>,
    ) {
        // Base document
        let _ = sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES ('doc_test', 'Test Document', '/path/test.pdf', 'pdf', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z', 'Test content')"
        ).execute(pool).await;

        // Base plan
        let _ = sqlx::query(
            "INSERT INTO study_plans (id, title, goal, depth, status, current_version, revision, created_at, updated_at)
             VALUES ('plan_test', 'Study Plan', 'Goal', 'survey', 'active', 0, 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(pool).await;

        // Blueprint
        let _ = sqlx::query(
            "INSERT INTO assessment_blueprints (id, plan_id, title, lifecycle, revision, created_at, updated_at)
             VALUES (?, 'plan_test', 'Test Exam', 'active', 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).bind(bp_id).execute(pool).await;

        let config_json = serde_json::json!({
            "mode": mode,
            "timeLimitSeconds": time_limit,
            "requestedCount": 2,
        })
        .to_string();

        let published_at = if state == "ready" {
            Some("2026-11-10T12:00:00Z")
        } else {
            None
        };

        // Blueprint revision
        sqlx::query(
            "INSERT INTO assessment_blueprint_revisions (
                id, blueprint_id, revision, state, config_json, scoring_json,
                source_scope_json, quota_json, source_snapshot_hash, created_at, published_at
            ) VALUES (?, ?, 1, ?, ?, '{}', '{}', '{}', 'sha256:snap', '2026-11-10T12:00:00Z', ?)",
        )
        .bind(rev_id)
        .bind(bp_id)
        .bind(state)
        .bind(config_json)
        .bind(published_at)
        .execute(pool)
        .await
        .unwrap();

        // Question 1 (single-select, 2 points)
        let q1_id = format!("{}_q1", bp_id);
        let aqr1_id = format!("{}_aqr1", rev_id);
        let _ = sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES (?, ?, 'fp_q1', '2026-11-10T12:00:00Z')",
        )
        .bind(&q1_id)
        .bind(bp_id)
        .execute(pool)
        .await;

        sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, max_points, difficulty, validation, committed_at, created_at
            ) VALUES (?, ?, ?, 1, 'slot_0', 'fp_q1',
                      'single-select', '{\"prompt\":\"Q1\"}', '{\"correctOptionId\":\"opt_a\"}', 2, 2, 'valid', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).bind(&aqr1_id).bind(&q1_id).bind(rev_id).execute(pool).await.unwrap();

        // Question 2 (short-answer, 4 points)
        let q2_id = format!("{}_q2", bp_id);
        let aqr2_id = format!("{}_aqr2", rev_id);
        let _ = sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES (?, ?, 'fp_q2', '2026-11-10T12:00:00Z')",
        )
        .bind(&q2_id)
        .bind(bp_id)
        .execute(pool)
        .await;

        sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, max_points, difficulty, validation, committed_at, created_at
            ) VALUES (?, ?, ?, 1, 'slot_1', 'fp_q2',
                      'short-answer', '{\"prompt\":\"Q2\"}', '{\"acceptedAnswers\":[\"ok\"]}', 4, 3, 'valid', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).bind(&aqr2_id).bind(&q2_id).bind(rev_id).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn test_start_attempt_lifecycle_and_idempotency() {
        let pool = test_pool().await;
        seed_test_blueprint(&pool, "bp_1", "bpr_ready_1", "ready", "exam", Some(1800)).await;

        // 1. Starting attempt on non-ready revision fails
        seed_test_blueprint(&pool, "bp_2", "bpr_draft_2", "draft", "exam", None).await;
        let fail_res = ExamSessionRepository::start_exam_attempt(
            &pool,
            StartAttemptInput {
                blueprint_revision_id: "bpr_draft_2".to_string(),
                client_start_key: "key_fail".to_string(),
            },
        )
        .await;
        assert!(
            fail_res.is_err(),
            "Starting attempt on non-ready blueprint must fail"
        );

        // 2. Starting attempt on ready revision succeeds
        let start_input = StartAttemptInput {
            blueprint_revision_id: "bpr_ready_1".to_string(),
            client_start_key: "start_key_1".to_string(),
        };
        let detail = ExamSessionRepository::start_exam_attempt(&pool, start_input.clone())
            .await
            .expect("Starting attempt on ready revision succeeds");

        assert_eq!(detail.attempt.status, "in-progress");
        assert_eq!(detail.attempt.mode, "exam");
        assert_eq!(detail.attempt.maximum_points, 6.0); // 2 + 4
        assert_eq!(
            detail.attempt.question_revision_ids,
            vec!["bpr_ready_1_aqr1", "bpr_ready_1_aqr2"]
        );
        assert!(detail.attempt.deadline_at.is_some());
        assert_eq!(detail.responses.len(), 2);
        assert_eq!(detail.responses[0].mark, "unanswered");
        assert_eq!(detail.responses[1].mark, "unanswered");

        // 3. Exact replay of client_start_key returns same attempt idempotently
        let replay_detail = ExamSessionRepository::start_exam_attempt(&pool, start_input)
            .await
            .expect("Replay returns existing attempt");
        assert_eq!(replay_detail.attempt.id, detail.attempt.id);
    }

    #[tokio::test]
    async fn test_save_response_cas_and_mutation_id_dedup() {
        let pool = test_pool().await;
        seed_test_blueprint(&pool, "bp_save", "bpr_save_1", "ready", "exam", None).await;

        let detail = ExamSessionRepository::start_exam_attempt(
            &pool,
            StartAttemptInput {
                blueprint_revision_id: "bpr_save_1".to_string(),
                client_start_key: "start_save_key".to_string(),
            },
        )
        .await
        .unwrap();

        let resp_1 = &detail.responses[0];

        // 1. Save new response with CAS expected revision
        let save_res = ExamSessionRepository::save_exam_response(
            &pool,
            SaveResponseInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_response_revision: 1,
                last_client_mutation_id: "mut_save_1".to_string(),
                draft_json: r#"{"kind":"single-select","optionId":"opt_a"}"#.to_string(),
                mark: "answered".to_string(),
            },
        )
        .await
        .expect("Valid save succeeds");

        assert_eq!(save_res.revision, 2);
        assert_eq!(save_res.mark, "answered");

        // 2. Idempotent replay with same mutation id & same payload returns unchanged
        let replay_save = ExamSessionRepository::save_exam_response(
            &pool,
            SaveResponseInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_response_revision: 2,
                last_client_mutation_id: "mut_save_1".to_string(),
                draft_json: r#"{"kind":"single-select","optionId":"opt_a"}"#.to_string(),
                mark: "answered".to_string(),
            },
        )
        .await
        .expect("Replay save succeeds");

        assert_eq!(replay_save.revision, 2);

        // 3. Same mutation id with different payload returns invalid_input
        let conflict_save = ExamSessionRepository::save_exam_response(
            &pool,
            SaveResponseInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_response_revision: 2,
                last_client_mutation_id: "mut_save_1".to_string(),
                draft_json: r#"{"kind":"single-select","optionId":"opt_b"}"#.to_string(),
                mark: "answered".to_string(),
            },
        )
        .await;
        assert!(
            conflict_save.is_err(),
            "Reused mutation ID with different payload must fail"
        );

        // 4. Stale revision returns stale_revision error
        let stale_save = ExamSessionRepository::save_exam_response(
            &pool,
            SaveResponseInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_response_revision: 1, // expected 2
                last_client_mutation_id: "mut_save_2".to_string(),
                draft_json: r#"{"kind":"single-select","optionId":"opt_b"}"#.to_string(),
                mark: "answered".to_string(),
            },
        )
        .await;
        assert!(stale_save.is_err(), "Stale revision must fail");
    }

    #[tokio::test]
    async fn test_submit_exam_attempt_deterministic_scoring_and_idempotency() {
        let pool = test_pool().await;
        seed_test_blueprint(&pool, "bp_sub", "bpr_sub_1", "ready", "exam", None).await;

        let detail = ExamSessionRepository::start_exam_attempt(
            &pool,
            StartAttemptInput {
                blueprint_revision_id: "bpr_sub_1".to_string(),
                client_start_key: "start_sub_key".to_string(),
            },
        )
        .await
        .unwrap();

        // 1. Submit with all final grades -> status complete
        let sub_input = SubmitAttemptInput {
            attempt_id: detail.attempt.id.clone(),
            expected_attempt_revision: 1,
            submission_key: "sub_key_1".to_string(),
            submission_reason: "user".to_string(),
            objective_grades: vec![
                ObjectiveGradeOutput {
                    question_revision_id: detail.attempt.question_revision_ids[0].clone(),
                    origin: "deterministic".to_string(),
                    state: "final".to_string(),
                    points: Some(2.0),
                    max_points: 2.0,
                    outcome: "correct".to_string(),
                    details: None,
                },
                ObjectiveGradeOutput {
                    question_revision_id: detail.attempt.question_revision_ids[1].clone(),
                    origin: "deterministic".to_string(),
                    state: "final".to_string(),
                    points: Some(4.0),
                    max_points: 4.0,
                    outcome: "correct".to_string(),
                    details: None,
                },
            ],
        };

        let completed = ExamSessionRepository::submit_exam_attempt(&pool, sub_input.clone())
            .await
            .expect("Submit succeeds");

        assert_eq!(completed.attempt.status, "complete");
        assert_eq!(completed.attempt.awarded_points, Some(6.0));
        assert!(completed.attempt.completed_at.is_some());
        assert_eq!(completed.submissions.len(), 2);
        assert_eq!(completed.current_grades.len(), 2);

        // 2. Same submission key replay returns completed attempt idempotently
        let replay = ExamSessionRepository::submit_exam_attempt(&pool, sub_input)
            .await
            .expect("Replay submit succeeds");
        assert_eq!(replay.attempt.id, detail.attempt.id);
        assert_eq!(replay.attempt.status, "complete");

        // 3. Duplicate submit with new key on already submitted attempt no-ops
        let dup_key_input = SubmitAttemptInput {
            attempt_id: detail.attempt.id.clone(),
            expected_attempt_revision: 2,
            submission_key: "new_sub_key_2".to_string(),
            submission_reason: "user".to_string(),
            objective_grades: vec![],
        };
        let noop_res = ExamSessionRepository::submit_exam_attempt(&pool, dup_key_input)
            .await
            .expect("Duplicate submit on submitted attempt returns current state");
        assert_eq!(noop_res.attempt.status, "complete");
    }

    #[tokio::test]
    async fn test_check_practice_response_multiple_ordinals() {
        let pool = test_pool().await;
        seed_test_blueprint(&pool, "bp_prac", "bpr_prac_1", "ready", "practice", None).await;

        let detail = ExamSessionRepository::start_exam_attempt(
            &pool,
            StartAttemptInput {
                blueprint_revision_id: "bpr_prac_1".to_string(),
                client_start_key: "start_prac_key".to_string(),
            },
        )
        .await
        .unwrap();

        let resp_1 = &detail.responses[0];

        // 1. First practice check creates ordinal 1 submission
        let check_1 = ExamSessionRepository::check_practice_response(
            &pool,
            CheckPracticeInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_attempt_revision: 1,
                client_mutation_id: "mut_prac_1".to_string(),
                hint_level: 1,
                draft_json: r#"{"kind":"single-select","optionId":"opt_b"}"#.to_string(),
                mark: "answered".to_string(),
                objective_grade: Some(ObjectiveGradeOutput {
                    question_revision_id: resp_1.question_revision_id.clone(),
                    origin: "deterministic".to_string(),
                    state: "final".to_string(),
                    points: Some(0.0),
                    max_points: 2.0,
                    outcome: "incorrect".to_string(),
                    details: None,
                }),
            },
        )
        .await
        .expect("Practice check 1 succeeds");

        assert_eq!(check_1.submission.ordinal, 1);
        assert_eq!(check_1.submission.hint_level, 1);
        assert!(check_1.grade.is_some());
        assert_eq!(check_1.attempt_revision, 2);

        // 2. Second practice check on same response creates ordinal 2 submission
        let check_2 = ExamSessionRepository::check_practice_response(
            &pool,
            CheckPracticeInput {
                attempt_id: detail.attempt.id.clone(),
                response_id: resp_1.id.clone(),
                expected_attempt_revision: 2,
                client_mutation_id: "mut_prac_2".to_string(),
                hint_level: 2,
                draft_json: r#"{"kind":"single-select","optionId":"opt_a"}"#.to_string(),
                mark: "answered".to_string(),
                objective_grade: Some(ObjectiveGradeOutput {
                    question_revision_id: resp_1.question_revision_id.clone(),
                    origin: "deterministic".to_string(),
                    state: "final".to_string(),
                    points: Some(2.0),
                    max_points: 2.0,
                    outcome: "correct".to_string(),
                    details: None,
                }),
            },
        )
        .await
        .expect("Practice check 2 succeeds");

        assert_eq!(check_2.submission.ordinal, 2);
        assert_eq!(check_2.submission.hint_level, 2);
        assert_eq!(check_2.attempt_revision, 3);

        // 3. Verify get_exam_attempt has both submissions and only the latest grade as is_current
        let reloaded = ExamSessionRepository::get_exam_attempt(&pool, &detail.attempt.id)
            .await
            .unwrap();
        assert_eq!(reloaded.submissions.len(), 2);
        assert_eq!(reloaded.current_grades.len(), 1);
        assert_eq!(reloaded.current_grades[0].points, Some(2.0));
    }

    #[tokio::test]
    async fn test_cancel_exam_attempt_and_delete_history() {
        let pool = test_pool().await;
        seed_test_blueprint(&pool, "bp_del", "bpr_del_1", "ready", "exam", None).await;

        let detail = ExamSessionRepository::start_exam_attempt(
            &pool,
            StartAttemptInput {
                blueprint_revision_id: "bpr_del_1".to_string(),
                client_start_key: "start_del_key".to_string(),
            },
        )
        .await
        .unwrap();

        // 1. Cancel in-progress attempt
        let cancelled = ExamSessionRepository::cancel_exam_attempt(&pool, &detail.attempt.id, 1)
            .await
            .expect("Cancel attempt succeeds");
        assert_eq!(cancelled.attempt.status, "cancelled");

        // 2. Second cancel fails invalid_state
        let cancel_again =
            ExamSessionRepository::cancel_exam_attempt(&pool, &detail.attempt.id, 2).await;
        assert!(
            cancel_again.is_err(),
            "Cancelling already cancelled attempt must fail"
        );

        // 3. Delete exam history cascades cleanly
        ExamSessionRepository::delete_exam_history(&pool, &detail.attempt.id)
            .await
            .expect("Deleting attempt succeeds");

        let fetch = ExamSessionRepository::get_exam_attempt(&pool, &detail.attempt.id).await;
        assert!(fetch.is_err(), "Attempt must no longer exist after delete");
    }
}
