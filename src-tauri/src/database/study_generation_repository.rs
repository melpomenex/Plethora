//! Study Generation Job repository with lease/CAS semantics and atomic step management.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10, §11, §12
//! - openspec/changes/generate-source-grounded-study-curricula/ (C2-T04)

use crate::models::study_generation::{
    CompleteStudyStepInput, CreateStudyStepInput, FailStudyStepInput, StartStudyJobInput,
    StudyGenerationJob, StudyGenerationStep, StudyJobKind, StudyJobProgress, StudyJobStatus,
    StudyStepStatus,
};
use crate::models::study_source::{FieldIssue, StudyCommandError, StudyErrorCode};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashSet;
use uuid::Uuid;

pub const LEASE_DURATION_SECONDS: i64 = 120;

#[derive(Clone)]
pub struct StudyGenerationRepository {
    pool: Pool<Sqlite>,
}

impl StudyGenerationRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Starts a durable generation job, creating all steps atomically.
    /// Supports exact replay on identical creation_key and duplicate active request acknowledgement.
    pub async fn start_study_generation_job(
        &self,
        input: StartStudyJobInput,
    ) -> Result<StudyGenerationJob, StudyCommandError> {
        if input.steps.is_empty() {
            return Err(StudyCommandError::invalid_input(
                "study_generation.error.empty_steps",
                vec![FieldIssue {
                    path: "steps".to_string(),
                    code: "empty_steps".to_string(),
                    message_key: "study_generation.error.empty_steps".to_string(),
                }],
            ));
        }

        // Validate step keys and ordinals
        let mut seen_keys = HashSet::new();
        let mut seen_ordinals = HashSet::new();
        for (i, step) in input.steps.iter().enumerate() {
            if step.step_key.trim().is_empty() {
                return Err(StudyCommandError::invalid_input(
                    "study_generation.error.empty_step_key",
                    vec![FieldIssue {
                        path: format!("steps[{}].stepKey", i),
                        code: "empty_step_key".to_string(),
                        message_key: "study_generation.error.empty_step_key".to_string(),
                    }],
                ));
            }
            if !seen_keys.insert(&step.step_key) {
                return Err(StudyCommandError::invalid_input(
                    "study_generation.error.duplicate_step_key",
                    vec![FieldIssue {
                        path: format!("steps[{}].stepKey", i),
                        code: "duplicate_step_key".to_string(),
                        message_key: "study_generation.error.duplicate_step_key".to_string(),
                    }],
                ));
            }
            if !seen_ordinals.insert(step.ordinal) {
                return Err(StudyCommandError::invalid_input(
                    "study_generation.error.duplicate_step_ordinal",
                    vec![FieldIssue {
                        path: format!("steps[{}].ordinal", i),
                        code: "duplicate_step_ordinal".to_string(),
                        message_key: "study_generation.error.duplicate_step_ordinal".to_string(),
                    }],
                ));
            }
        }

        // Validate target revision if target is a study plan version (curriculum)
        if input.kind == StudyJobKind::Curriculum {
            let version_row =
                sqlx::query("SELECT version, state FROM study_plan_versions WHERE id = ?1")
                    .bind(&input.target_id)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(|e| {
                        StudyCommandError::storage_failed(format!(
                            "Failed to query target draft: {}",
                            e
                        ))
                    })?;

            match version_row {
                Some(row) => {
                    let version: i64 = row.get("version");
                    let state: String = row.get("state");
                    if state != "draft" {
                        return Err(StudyCommandError::invalid_state(format!(
                            "Target plan version {} is in state '{}', must be draft",
                            input.target_id, state
                        )));
                    }
                    if version != input.target_revision {
                        return Err(StudyCommandError::stale_revision(format!(
                            "Target plan version revision mismatch: expected {}, got {}",
                            input.target_revision, version
                        )));
                    }
                }
                None => {
                    return Err(StudyCommandError::not_found(format!(
                        "Target study plan version '{}' not found",
                        input.target_id
                    )));
                }
            }
        }

        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        // 1. Check creation_key exact replay
        let existing_creation_key_row = sqlx::query(
            "SELECT id, kind, target_id, target_revision, request_hash FROM study_generation_jobs WHERE creation_key = ?1",
        )
        .bind(&input.creation_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to check creation key: {}", e)))?;

        if let Some(row) = existing_creation_key_row {
            let id: String = row.get("id");
            let kind: String = row.get("kind");
            let target_id: String = row.get("target_id");
            let target_revision: i64 = row.get("target_revision");
            let request_hash: String = row.get("request_hash");

            if kind == input.kind.to_string()
                && target_id == input.target_id
                && target_revision == input.target_revision
                && request_hash == input.request_hash
            {
                // Exact replay! Return existing job.
                tx.rollback().await.ok();
                return self.get_study_generation_job(&id).await;
            } else {
                tx.rollback().await.ok();
                return Err(StudyCommandError::invalid_input(
                    "study_generation.error.creation_key_conflict",
                    vec![FieldIssue {
                        path: "creationKey".to_string(),
                        code: "creation_key_conflict".to_string(),
                        message_key: "study_generation.error.creation_key_conflict".to_string(),
                    }],
                ));
            }
        }

        // 2. Check active same-request duplication
        let active_request_row = sqlx::query(
            "SELECT id FROM study_generation_jobs WHERE kind = ?1 AND target_id = ?2 AND request_hash = ?3 AND status IN ('queued', 'running', 'awaiting-review')",
        )
        .bind(input.kind.to_string())
        .bind(&input.target_id)
        .bind(&input.request_hash)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to check active requests: {}", e)))?;

        if let Some(row) = active_request_row {
            let id: String = row.get("id");
            tx.rollback().await.ok();
            return self.get_study_generation_job(&id).await;
        }

        // 3. Create fresh job and steps
        let now = Utc::now().to_rfc3339();
        let job_id = format!("job_{}", Uuid::new_v4().simple());
        let initial_progress = StudyJobProgress {
            execution: None,
            completed: 0,
            total: input.steps.len() as i64,
            label_key: "study_generation.progress.queued".to_string(),
        };

        let preflight_json = serde_json::to_string(&input.preflight).map_err(|e| {
            StudyCommandError::invalid_input(format!("Invalid preflight JSON: {}", e), vec![])
        })?;
        let progress_json = serde_json::to_string(&initial_progress).map_err(|e| {
            StudyCommandError::internal_error(format!("Failed to serialize progress: {}", e))
        })?;

        sqlx::query(
            "INSERT INTO study_generation_jobs (
                id, kind, target_id, target_revision, creation_key, request_hash, status,
                next_step_index, cancellation_epoch, attempt_count, preflight_json,
                progress_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', 0, 0, 0, ?7, ?8, ?9, ?9)",
        )
        .bind(&job_id)
        .bind(input.kind.to_string())
        .bind(&input.target_id)
        .bind(input.target_revision)
        .bind(&input.creation_key)
        .bind(&input.request_hash)
        .bind(&preflight_json)
        .bind(&progress_json)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to insert study generation job: {}",
                e
            ))
        })?;

        for step in &input.steps {
            sqlx::query(
                "INSERT INTO study_generation_steps (
                    job_id, step_key, ordinal, input_hash, status
                ) VALUES (?1, ?2, ?3, ?4, 'pending')",
            )
            .bind(&job_id)
            .bind(&step.step_key)
            .bind(step.ordinal)
            .bind(&step.input_hash)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to insert study step: {}", e))
            })?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit job creation: {}", e))
        })?;

        self.get_study_generation_job(&job_id).await
    }

    /// Claims the next eligible step for execution with a 120-second lease.
    pub async fn claim_study_job_step(
        &self,
        job_id: &str,
        step_key: &str,
        lease_owner: &str,
        cancellation_epoch: i64,
    ) -> Result<StudyGenerationStep, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let job_row = sqlx::query(
            "SELECT status, next_step_index, lease_owner, lease_expires_at, cancellation_epoch, attempt_count FROM study_generation_jobs WHERE id = ?1",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch job for claim: {}", e)))?;

        let job_row = match job_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Job '{}' not found",
                    job_id
                )))
            }
        };

        let current_epoch: i64 = job_row.get("cancellation_epoch");
        if current_epoch != cancellation_epoch {
            return Err(StudyCommandError::job_cancelled(format!(
                "Job cancellation epoch mismatch: expected {}, got {}",
                cancellation_epoch, current_epoch
            )));
        }

        let status_str: String = job_row.get("status");
        let status: StudyJobStatus = status_str
            .parse()
            .map_err(|e| StudyCommandError::internal_error(format!("Corrupt job status: {}", e)))?;

        if !status.is_active() && status != StudyJobStatus::Interrupted {
            return Err(StudyCommandError::invalid_state(format!(
                "Cannot claim step for job in status '{}'",
                status
            )));
        }

        let next_step_index: i64 = job_row.get("next_step_index");
        let current_lease_owner: Option<String> = job_row.get("lease_owner");
        let current_lease_expires_at: Option<String> = job_row.get("lease_expires_at");
        let attempt_count: i64 = job_row.get("attempt_count");

        let now_dt = Utc::now();
        let now = now_dt.to_rfc3339();

        // Check if leased by someone else and not expired
        if let Some(owner) = current_lease_owner {
            if let Some(exp) = current_lease_expires_at {
                if exp > now && owner != lease_owner {
                    return Err(StudyCommandError::job_lease_stale(format!(
                        "Job '{}' is currently leased by '{}' until {}",
                        job_id, owner, exp
                    )));
                }
            }
        }

        // Fetch step
        let step_row = sqlx::query(
            "SELECT ordinal, input_hash, status, output_ref_id, safe_error_json, completed_at FROM study_generation_steps WHERE job_id = ?1 AND step_key = ?2",
        )
        .bind(job_id)
        .bind(step_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch step: {}", e)))?;

        let step_row = match step_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Step '{}' not found for job '{}'",
                    step_key, job_id
                )))
            }
        };

        let ordinal: i64 = step_row.get("ordinal");
        if ordinal != next_step_index {
            return Err(StudyCommandError::order_conflict(format!(
                "Out-of-order step claim: expected step ordinal {}, got {}",
                next_step_index, ordinal
            )));
        }

        let step_status_str: String = step_row.get("status");
        let step_status: StudyStepStatus = step_status_str.parse().map_err(|e| {
            StudyCommandError::internal_error(format!("Corrupt step status: {}", e))
        })?;

        if step_status == StudyStepStatus::Completed {
            return Err(StudyCommandError::invalid_state(
                "Step is already completed",
            ));
        }

        // Lease for 120 seconds
        let expires_at_dt = now_dt + chrono::Duration::seconds(LEASE_DURATION_SECONDS);
        let expires_at = expires_at_dt.to_rfc3339();

        sqlx::query(
            "UPDATE study_generation_jobs SET
                status = 'running',
                lease_owner = ?1,
                lease_expires_at = ?2,
                attempt_count = ?3,
                updated_at = ?4
             WHERE id = ?5",
        )
        .bind(lease_owner)
        .bind(&expires_at)
        .bind(attempt_count + 1)
        .bind(&now)
        .bind(job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update job lease: {}", e))
        })?;

        sqlx::query(
            "UPDATE study_generation_steps SET
                status = 'running'
             WHERE job_id = ?1 AND step_key = ?2",
        )
        .bind(job_id)
        .bind(step_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update step status: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit claim transaction: {}", e))
        })?;

        let input_hash: String = step_row.get("input_hash");
        let output_ref_id: Option<String> = step_row.get("output_ref_id");
        let safe_error_json: Option<String> = step_row.get("safe_error_json");
        let safe_error = safe_error_json.and_then(|s| serde_json::from_str(&s).ok());
        let completed_at: Option<String> = step_row.get("completed_at");

        Ok(StudyGenerationStep {
            job_id: job_id.to_string(),
            step_key: step_key.to_string(),
            ordinal,
            input_hash,
            status: StudyStepStatus::Running,
            output_ref_id,
            safe_error,
            completed_at,
        })
    }

    /// Completes a step within a transaction, recording output reference and updating progress.
    /// Handles duplicate identical completion as an idempotent ack, and rejects changed input hash.
    pub async fn complete_study_job_step(
        &self,
        input: CompleteStudyStepInput,
    ) -> Result<StudyJobProgress, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let job_row = sqlx::query(
            "SELECT kind, status, cancellation_epoch, lease_owner, lease_expires_at, progress_json FROM study_generation_jobs WHERE id = ?1",
        )
        .bind(&input.job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch job for complete: {}", e)))?;

        let job_row = match job_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Job '{}' not found",
                    input.job_id
                )))
            }
        };

        let current_epoch: i64 = job_row.get("cancellation_epoch");
        if current_epoch != input.cancellation_epoch {
            return Err(StudyCommandError::job_cancelled(format!(
                "Job cancellation epoch mismatch: expected {}, got {}",
                input.cancellation_epoch, current_epoch
            )));
        }

        let lease_owner: Option<String> = job_row.get("lease_owner");
        let lease_expires_at: Option<String> = job_row.get("lease_expires_at");
        let progress_json: String = job_row.get("progress_json");
        let existing_progress: StudyJobProgress =
            serde_json::from_str(&progress_json).map_err(|e| {
                StudyCommandError::internal_error(format!("Failed to parse progress: {}", e))
            })?;

        let now = Utc::now().to_rfc3339();

        // Fetch step
        let step_row = sqlx::query(
            "SELECT status, input_hash FROM study_generation_steps WHERE job_id = ?1 AND step_key = ?2",
        )
        .bind(&input.job_id)
        .bind(&input.step_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch step: {}", e)))?;

        let step_row = match step_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Step '{}' not found for job '{}'",
                    input.step_key, input.job_id
                )))
            }
        };

        let step_status_str: String = step_row.get("status");
        let stored_input_hash: String = step_row.get("input_hash");

        // Duplicate ack or mismatch check: if already completed, handle without requiring active lease
        if step_status_str == "completed" {
            if stored_input_hash == input.input_hash {
                // Exact replay duplicate ack! Return progress
                tx.rollback().await.ok();
                return Ok(existing_progress);
            } else {
                tx.rollback().await.ok();
                return Err(StudyCommandError::invalid_input(
                    "study_generation.error.step_input_hash_mismatch",
                    vec![FieldIssue {
                        path: "inputHash".to_string(),
                        code: "input_hash_mismatch".to_string(),
                        message_key: "study_generation.error.step_input_hash_mismatch".to_string(),
                    }],
                ));
            }
        }

        // For non-completed steps, verify active lease
        if lease_owner.as_deref() != Some(&input.lease_owner) {
            return Err(StudyCommandError::job_lease_stale(format!(
                "Lease owner mismatch: job has '{:?}', caller is '{}'",
                lease_owner, input.lease_owner
            )));
        }

        if let Some(exp) = lease_expires_at {
            if exp < now {
                return Err(StudyCommandError::job_lease_stale(format!(
                    "Lease expired at {}",
                    exp
                )));
            }
        } else {
            return Err(StudyCommandError::job_lease_stale(
                "Job has no active lease",
            ));
        }

        if stored_input_hash != input.input_hash {
            tx.rollback().await.ok();
            return Err(StudyCommandError::invalid_input(
                "study_generation.error.step_input_hash_mismatch",
                vec![FieldIssue {
                    path: "inputHash".to_string(),
                    code: "input_hash_mismatch".to_string(),
                    message_key: "study_generation.error.step_input_hash_mismatch".to_string(),
                }],
            ));
        }

        // Update step
        sqlx::query(
            "UPDATE study_generation_steps SET
                status = 'completed',
                output_ref_id = ?1,
                completed_at = ?2
             WHERE job_id = ?3 AND step_key = ?4",
        )
        .bind(&input.output_ref_id)
        .bind(&now)
        .bind(&input.job_id)
        .bind(&input.step_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update step to completed: {}", e))
        })?;

        // Determine job status
        let target_status = if let Some(s) = input.status {
            s
        } else if input.next_step_index >= input.progress.total {
            let kind_str: String = job_row.get("kind");
            if kind_str == "curriculum" {
                StudyJobStatus::AwaitingReview
            } else {
                StudyJobStatus::Completed
            }
        } else {
            StudyJobStatus::Running
        };

        let progress_json = serde_json::to_string(&input.progress).map_err(|e| {
            StudyCommandError::internal_error(format!("Failed to serialize progress: {}", e))
        })?;

        sqlx::query(
            "UPDATE study_generation_jobs SET
                status = ?1,
                next_step_index = ?2,
                lease_owner = NULL,
                lease_expires_at = NULL,
                progress_json = ?3,
                updated_at = ?4
             WHERE id = ?5",
        )
        .bind(target_status.to_string())
        .bind(input.next_step_index)
        .bind(&progress_json)
        .bind(&now)
        .bind(&input.job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to update job on step complete: {}",
                e
            ))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit step completion: {}", e))
        })?;

        Ok(input.progress)
    }

    /// Marks a step failed and transitions the job to Failed status.
    pub async fn fail_study_job_step(
        &self,
        input: FailStudyStepInput,
    ) -> Result<StudyJobProgress, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let job_row = sqlx::query(
            "SELECT cancellation_epoch, lease_owner, progress_json FROM study_generation_jobs WHERE id = ?1",
        )
        .bind(&input.job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch job for fail: {}", e)))?;

        let job_row = match job_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Job '{}' not found",
                    input.job_id
                )))
            }
        };

        let current_epoch: i64 = job_row.get("cancellation_epoch");
        if current_epoch != input.cancellation_epoch {
            return Err(StudyCommandError::job_cancelled(format!(
                "Job cancellation epoch mismatch: expected {}, got {}",
                input.cancellation_epoch, current_epoch
            )));
        }

        let lease_owner: Option<String> = job_row.get("lease_owner");
        if lease_owner.as_deref() != Some(&input.lease_owner) {
            return Err(StudyCommandError::job_lease_stale(format!(
                "Lease owner mismatch: job has '{:?}', caller is '{}'",
                lease_owner, input.lease_owner
            )));
        }

        let now = Utc::now().to_rfc3339();
        let error_json = serde_json::to_string(&input.error).map_err(|e| {
            StudyCommandError::internal_error(format!("Failed to serialize error: {}", e))
        })?;

        sqlx::query(
            "UPDATE study_generation_steps SET
                status = 'failed',
                safe_error_json = ?1
             WHERE job_id = ?2 AND step_key = ?3",
        )
        .bind(&error_json)
        .bind(&input.job_id)
        .bind(&input.step_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update step to failed: {}", e))
        })?;

        sqlx::query(
            "UPDATE study_generation_jobs SET
                status = 'failed',
                last_error_json = ?1,
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = ?2
             WHERE id = ?3",
        )
        .bind(&error_json)
        .bind(&now)
        .bind(&input.job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fail job: {}", e)))?;

        let progress_json: String = job_row.get("progress_json");
        let progress: StudyJobProgress = serde_json::from_str(&progress_json).map_err(|e| {
            StudyCommandError::internal_error(format!("Failed to parse progress: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to commit failure transaction: {}",
                e
            ))
        })?;

        Ok(progress)
    }

    /// Cancels a study generation job using CAS on cancellation_epoch.
    /// Preserves completed checkpoints; resets running steps.
    pub async fn cancel_study_generation_job(
        &self,
        job_id: &str,
        cancellation_epoch: i64,
    ) -> Result<(), StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let job_row = sqlx::query(
            "SELECT status, cancellation_epoch FROM study_generation_jobs WHERE id = ?1",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch job for cancel: {}", e))
        })?;

        let job_row = match job_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Job '{}' not found",
                    job_id
                )))
            }
        };

        let current_status: String = job_row.get("status");
        if current_status == "cancelled" {
            // Already cancelled: idempotent Ok
            tx.rollback().await.ok();
            return Ok(());
        }

        if current_status == "completed" {
            return Err(StudyCommandError::invalid_state(
                "Cannot cancel a completed job",
            ));
        }

        let current_epoch: i64 = job_row.get("cancellation_epoch");
        if current_epoch != cancellation_epoch {
            return Err(StudyCommandError::stale_revision(format!(
                "Cancellation epoch mismatch: expected {}, got {}",
                cancellation_epoch, current_epoch
            )));
        }

        let now = Utc::now().to_rfc3339();

        let affected = sqlx::query(
            "UPDATE study_generation_jobs SET
                status = 'cancelled',
                cancellation_epoch = cancellation_epoch + 1,
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = ?1
             WHERE id = ?2 AND cancellation_epoch = ?3",
        )
        .bind(&now)
        .bind(job_id)
        .bind(cancellation_epoch)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to cancel job: {}", e)))?
        .rows_affected();

        if affected == 0 {
            return Err(StudyCommandError::stale_revision(
                "Concurrent cancellation modification detected",
            ));
        }

        // Reset any running step back to pending
        sqlx::query(
            "UPDATE study_generation_steps SET
                status = 'pending'
             WHERE job_id = ?1 AND status = 'running'",
        )
        .bind(job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to reset running steps: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit cancel: {}", e))
        })?;

        Ok(())
    }

    /// Resumes an interrupted or failed job with updated preflight parameters.
    pub async fn resume_study_generation_job(
        &self,
        job_id: &str,
        preflight: serde_json::Value,
    ) -> Result<StudyGenerationJob, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let job_row = sqlx::query(
            "SELECT status, cancellation_epoch FROM study_generation_jobs WHERE id = ?1",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch job for resume: {}", e))
        })?;

        let job_row = match job_row {
            Some(row) => row,
            None => {
                return Err(StudyCommandError::not_found(format!(
                    "Job '{}' not found",
                    job_id
                )))
            }
        };

        let status_str: String = job_row.get("status");
        if status_str != "interrupted" && status_str != "failed" {
            return Err(StudyCommandError::invalid_state(format!(
                "Cannot resume job in status '{}', must be interrupted or failed",
                status_str
            )));
        }

        let now = Utc::now().to_rfc3339();
        let preflight_json = serde_json::to_string(&preflight).map_err(|e| {
            StudyCommandError::invalid_input(format!("Invalid preflight JSON: {}", e), vec![])
        })?;

        // Reset any running or failed steps back to pending
        sqlx::query(
            "UPDATE study_generation_steps SET
                status = 'pending',
                safe_error_json = NULL
             WHERE job_id = ?1 AND status IN ('running', 'failed')",
        )
        .bind(job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to reset steps on resume: {}", e))
        })?;

        sqlx::query(
            "UPDATE study_generation_jobs SET
                status = 'queued',
                preflight_json = ?1,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_json = NULL,
                updated_at = ?2
             WHERE id = ?3",
        )
        .bind(&preflight_json)
        .bind(&now)
        .bind(job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update job on resume: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit resume: {}", e))
        })?;

        self.get_study_generation_job(job_id).await
    }

    /// Scans for running jobs with expired leases and marks them as interrupted without running inference.
    pub async fn recover_interrupted_study_jobs(
        &self,
    ) -> Result<Vec<StudyGenerationJob>, StudyCommandError> {
        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin transaction: {}", e))
        })?;

        let expired_rows = sqlx::query(
            "SELECT id FROM study_generation_jobs WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?1)",
        )
        .bind(&now)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to find expired jobs: {}", e)))?;

        let mut recovered_ids = Vec::new();
        for row in expired_rows {
            let id: String = row.get("id");
            recovered_ids.push(id);
        }

        for id in &recovered_ids {
            sqlx::query(
                "UPDATE study_generation_jobs SET
                    status = 'interrupted',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?1
                 WHERE id = ?2",
            )
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to interrupt job: {}", e))
            })?;

            sqlx::query(
                "UPDATE study_generation_steps SET
                    status = 'pending'
                 WHERE job_id = ?1 AND status = 'running'",
            )
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to reset step status: {}", e))
            })?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit recovery: {}", e))
        })?;

        let mut jobs = Vec::new();
        for id in recovered_ids {
            if let Ok(job) = self.get_study_generation_job(&id).await {
                jobs.push(job);
            }
        }

        Ok(jobs)
    }

    /// Lists study generation jobs, optionally filtered by target_id.
    pub async fn list_study_generation_jobs(
        &self,
        target_id: Option<&str>,
    ) -> Result<Vec<StudyGenerationJob>, StudyCommandError> {
        let rows = match target_id {
            Some(tid) => {
                sqlx::query(
                    "SELECT id, kind, target_id, target_revision, request_hash, creation_key,
                            status, next_step_index, lease_owner, lease_expires_at, cancellation_epoch,
                            attempt_count, preflight_json, progress_json, last_error_json,
                            created_at, updated_at
                     FROM study_generation_jobs
                     WHERE target_id = ?1
                     ORDER BY created_at DESC",
                )
                .bind(tid)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query(
                    "SELECT id, kind, target_id, target_revision, request_hash, creation_key,
                            status, next_step_index, lease_owner, lease_expires_at, cancellation_epoch,
                            attempt_count, preflight_json, progress_json, last_error_json,
                            created_at, updated_at
                     FROM study_generation_jobs
                     ORDER BY created_at DESC",
                )
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to list study jobs: {}", e)))?;

        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(self.row_to_job(row)?);
        }

        Ok(jobs)
    }

    /// Retrieves a single study generation job by ID.
    pub async fn get_study_generation_job(
        &self,
        job_id: &str,
    ) -> Result<StudyGenerationJob, StudyCommandError> {
        let row = sqlx::query(
            "SELECT id, kind, target_id, target_revision, request_hash, creation_key,
                    status, next_step_index, lease_owner, lease_expires_at, cancellation_epoch,
                    attempt_count, preflight_json, progress_json, last_error_json,
                    created_at, updated_at
             FROM study_generation_jobs
             WHERE id = ?1",
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch job: {}", e)))?;

        match row {
            Some(r) => self.row_to_job(r),
            None => Err(StudyCommandError::not_found(format!(
                "Job '{}' not found",
                job_id
            ))),
        }
    }

    /// Retrieves all steps for a study generation job, sorted by ordinal.
    pub async fn get_study_generation_steps(
        &self,
        job_id: &str,
    ) -> Result<Vec<StudyGenerationStep>, StudyCommandError> {
        let rows = sqlx::query(
            "SELECT job_id, step_key, ordinal, input_hash, status, output_ref_id, safe_error_json, completed_at
             FROM study_generation_steps
             WHERE job_id = ?1
             ORDER BY ordinal ASC",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(format!("Failed to fetch steps: {}", e)))?;

        let mut steps = Vec::new();
        for row in rows {
            let status_str: String = row.get("status");
            let status: StudyStepStatus = status_str.parse().map_err(|e| {
                StudyCommandError::internal_error(format!("Corrupt step status: {}", e))
            })?;
            let safe_error_json: Option<String> = row.get("safe_error_json");
            let safe_error = safe_error_json.and_then(|s| serde_json::from_str(&s).ok());

            steps.push(StudyGenerationStep {
                job_id: row.get("job_id"),
                step_key: row.get("step_key"),
                ordinal: row.get("ordinal"),
                input_hash: row.get("input_hash"),
                status,
                output_ref_id: row.get("output_ref_id"),
                safe_error,
                completed_at: row.get("completed_at"),
            });
        }

        Ok(steps)
    }

    fn row_to_job(
        &self,
        row: sqlx::sqlite::SqliteRow,
    ) -> Result<StudyGenerationJob, StudyCommandError> {
        let kind_str: String = row.get("kind");
        let kind: StudyJobKind = kind_str
            .parse()
            .map_err(|e| StudyCommandError::internal_error(format!("Corrupt job kind: {}", e)))?;

        let status_str: String = row.get("status");
        let status: StudyJobStatus = status_str
            .parse()
            .map_err(|e| StudyCommandError::internal_error(format!("Corrupt job status: {}", e)))?;

        let preflight_json: String = row.get("preflight_json");
        let preflight: serde_json::Value = serde_json::from_str(&preflight_json).map_err(|e| {
            StudyCommandError::internal_error(format!("Corrupt preflight JSON: {}", e))
        })?;

        let progress_json: String = row.get("progress_json");
        let progress: StudyJobProgress = serde_json::from_str(&progress_json).map_err(|e| {
            StudyCommandError::internal_error(format!("Corrupt progress JSON: {}", e))
        })?;

        let last_error_json: Option<String> = row.get("last_error_json");
        let last_error = last_error_json.and_then(|s| serde_json::from_str(&s).ok());

        Ok(StudyGenerationJob {
            id: row.get("id"),
            kind,
            target_id: row.get("target_id"),
            target_revision: row.get("target_revision"),
            request_hash: row.get("request_hash"),
            creation_key: row.get("creation_key"),
            status,
            next_step_index: row.get("next_step_index"),
            lease_owner: row.get("lease_owner"),
            lease_expires_at: row.get("lease_expires_at"),
            cancellation_epoch: row.get("cancellation_epoch"),
            attempt_count: row.get("attempt_count"),
            preflight,
            progress,
            last_error,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;

    async fn setup_test_repo() -> (StudyGenerationRepository, Pool<Sqlite>) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory db");
        run_migrations(&pool).await.expect("run migrations");

        // Insert a draft study plan and version for target verification
        sqlx::query(
            "INSERT INTO study_plans (id, title, goal, depth, status, created_at, updated_at)
             VALUES ('plan_1', 'Test Plan', 'Test Goal', 'foundational', 'active', '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO study_plan_versions (id, plan_id, version, state, source_scope_json, created_by, created_at)
             VALUES ('spv_draft_1', 'plan_1', 1, 'draft', '{}', 'user', '2026-11-10T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        (StudyGenerationRepository::new(pool.clone()), pool)
    }

    #[tokio::test]
    async fn test_job_lifecycle_happy_path() {
        let (repo, _) = setup_test_repo().await;

        let input = StartStudyJobInput {
            kind: StudyJobKind::Curriculum,
            target_id: "spv_draft_1".to_string(),
            target_revision: 1,
            creation_key: "ck_lifecycle_1".to_string(),
            request_hash: "req_hash_1".to_string(),
            preflight: serde_json::json!({"provider": "test-provider"}),
            steps: vec![
                CreateStudyStepInput {
                    step_key: "decompose:0".to_string(),
                    ordinal: 0,
                    input_hash: "hash_step_0".to_string(),
                },
                CreateStudyStepInput {
                    step_key: "prereq:1".to_string(),
                    ordinal: 1,
                    input_hash: "hash_step_1".to_string(),
                },
            ],
        };

        let job = repo.start_study_generation_job(input).await.unwrap();
        assert_eq!(job.status, StudyJobStatus::Queued);
        assert_eq!(job.next_step_index, 0);

        // Claim step 0
        let step0 = repo
            .claim_study_job_step(&job.id, "decompose:0", "worker-1", 0)
            .await
            .unwrap();
        assert_eq!(step0.status, StudyStepStatus::Running);

        // Complete step 0
        let p0 = repo
            .complete_study_job_step(CompleteStudyStepInput {
                job_id: job.id.clone(),
                step_key: "decompose:0".to_string(),
                lease_owner: "worker-1".to_string(),
                cancellation_epoch: 0,
                input_hash: "hash_step_0".to_string(),
                output_ref_id: Some("out_0".to_string()),
                next_step_index: 1,
                progress: StudyJobProgress {
                    execution: None,
                    completed: 1,
                    total: 2,
                    label_key: "step 1 done".to_string(),
                },
                status: None,
            })
            .await
            .unwrap();
        assert_eq!(p0.completed, 1);

        // Claim step 1
        let step1 = repo
            .claim_study_job_step(&job.id, "prereq:1", "worker-1", 0)
            .await
            .unwrap();
        assert_eq!(step1.status, StudyStepStatus::Running);

        // Complete step 1
        let p1 = repo
            .complete_study_job_step(CompleteStudyStepInput {
                job_id: job.id.clone(),
                step_key: "prereq:1".to_string(),
                lease_owner: "worker-1".to_string(),
                cancellation_epoch: 0,
                input_hash: "hash_step_1".to_string(),
                output_ref_id: Some("out_1".to_string()),
                next_step_index: 2,
                progress: StudyJobProgress {
                    execution: None,
                    completed: 2,
                    total: 2,
                    label_key: "curriculum ready".to_string(),
                },
                status: Some(StudyJobStatus::AwaitingReview),
            })
            .await
            .unwrap();
        assert_eq!(p1.completed, 2);

        let final_job = repo.get_study_generation_job(&job.id).await.unwrap();
        assert_eq!(final_job.status, StudyJobStatus::AwaitingReview);
        assert_eq!(final_job.next_step_index, 2);
    }

    #[tokio::test]
    async fn test_creation_key_replay_and_active_duplication() {
        let (repo, _) = setup_test_repo().await;

        let input1 = StartStudyJobInput {
            kind: StudyJobKind::Curriculum,
            target_id: "spv_draft_1".to_string(),
            target_revision: 1,
            creation_key: "ck_unique_1".to_string(),
            request_hash: "req_unique_hash".to_string(),
            preflight: serde_json::json!({}),
            steps: vec![CreateStudyStepInput {
                step_key: "step_0".to_string(),
                ordinal: 0,
                input_hash: "h0".to_string(),
            }],
        };

        let job1 = repo
            .start_study_generation_job(input1.clone())
            .await
            .unwrap();

        // Exact replay with same creation key -> returns job1
        let replay = repo
            .start_study_generation_job(input1.clone())
            .await
            .unwrap();
        assert_eq!(replay.id, job1.id);

        // Conflict: same creation key with different request_hash -> returns error
        let mut conflict_input = input1.clone();
        conflict_input.request_hash = "different_hash".to_string();
        let err = repo.start_study_generation_job(conflict_input).await;
        assert!(err.is_err());
        assert_eq!(err.unwrap_err().code, StudyErrorCode::InvalidInput);

        // Active request deduplication: different creation key, same request_hash -> returns job1
        let mut dup_active_input = input1;
        dup_active_input.creation_key = "ck_unique_2".to_string();
        let dup_job = repo
            .start_study_generation_job(dup_active_input)
            .await
            .unwrap();
        assert_eq!(dup_job.id, job1.id);
    }

    #[tokio::test]
    async fn test_claim_lease_and_order_protection() {
        let (repo, _) = setup_test_repo().await;

        let job = repo
            .start_study_generation_job(StartStudyJobInput {
                kind: StudyJobKind::Curriculum,
                target_id: "spv_draft_1".to_string(),
                target_revision: 1,
                creation_key: "ck_claim_test".to_string(),
                request_hash: "req_claim_test".to_string(),
                preflight: serde_json::json!({}),
                steps: vec![
                    CreateStudyStepInput {
                        step_key: "step_0".to_string(),
                        ordinal: 0,
                        input_hash: "h0".to_string(),
                    },
                    CreateStudyStepInput {
                        step_key: "step_1".to_string(),
                        ordinal: 1,
                        input_hash: "h1".to_string(),
                    },
                ],
            })
            .await
            .unwrap();

        // Out of order claim should fail
        let ooo = repo
            .claim_study_job_step(&job.id, "step_1", "worker-1", 0)
            .await;
        assert!(ooo.is_err());
        assert_eq!(ooo.unwrap_err().code, StudyErrorCode::OrderConflict);

        // Legitimate claim
        let step0 = repo
            .claim_study_job_step(&job.id, "step_0", "worker-1", 0)
            .await
            .unwrap();
        assert_eq!(step0.status, StudyStepStatus::Running);

        // Concurrent claim by another worker while lease is active should fail with JobLeaseStale
        let stolen = repo
            .claim_study_job_step(&job.id, "step_0", "worker-2", 0)
            .await;
        assert!(stolen.is_err());
        assert_eq!(stolen.unwrap_err().code, StudyErrorCode::JobLeaseStale);
    }

    #[tokio::test]
    async fn test_complete_step_idempotency_and_hash_mismatch() {
        let (repo, _) = setup_test_repo().await;

        let job = repo
            .start_study_generation_job(StartStudyJobInput {
                kind: StudyJobKind::Curriculum,
                target_id: "spv_draft_1".to_string(),
                target_revision: 1,
                creation_key: "ck_idempotency".to_string(),
                request_hash: "req_idempotency".to_string(),
                preflight: serde_json::json!({}),
                steps: vec![CreateStudyStepInput {
                    step_key: "step_0".to_string(),
                    ordinal: 0,
                    input_hash: "expected_hash".to_string(),
                }],
            })
            .await
            .unwrap();

        repo.claim_study_job_step(&job.id, "step_0", "worker-1", 0)
            .await
            .unwrap();

        // Complete step with wrong input hash should fail
        let bad_hash = repo
            .complete_study_job_step(CompleteStudyStepInput {
                job_id: job.id.clone(),
                step_key: "step_0".to_string(),
                lease_owner: "worker-1".to_string(),
                cancellation_epoch: 0,
                input_hash: "wrong_hash".to_string(),
                output_ref_id: None,
                next_step_index: 1,
                progress: StudyJobProgress {
                    execution: None,
                    completed: 1,
                    total: 1,
                    label_key: "done".to_string(),
                },
                status: None,
            })
            .await;
        assert!(bad_hash.is_err());
        assert_eq!(bad_hash.unwrap_err().code, StudyErrorCode::InvalidInput);

        // Complete step with correct input hash
        let ok_progress = repo
            .complete_study_job_step(CompleteStudyStepInput {
                job_id: job.id.clone(),
                step_key: "step_0".to_string(),
                lease_owner: "worker-1".to_string(),
                cancellation_epoch: 0,
                input_hash: "expected_hash".to_string(),
                output_ref_id: Some("out_ref".to_string()),
                next_step_index: 1,
                progress: StudyJobProgress {
                    execution: None,
                    completed: 1,
                    total: 1,
                    label_key: "done".to_string(),
                },
                status: None,
            })
            .await
            .unwrap();
        assert_eq!(ok_progress.completed, 1);

        // Duplicate identical completion should return previous progress (idempotent ack)
        let dup_progress = repo
            .complete_study_job_step(CompleteStudyStepInput {
                job_id: job.id.clone(),
                step_key: "step_0".to_string(),
                lease_owner: "worker-1".to_string(),
                cancellation_epoch: 0,
                input_hash: "expected_hash".to_string(),
                output_ref_id: Some("out_ref".to_string()),
                next_step_index: 1,
                progress: StudyJobProgress {
                    execution: None,
                    completed: 1,
                    total: 1,
                    label_key: "done".to_string(),
                },
                status: None,
            })
            .await
            .unwrap();
        assert_eq!(dup_progress.completed, 1);
    }

    #[tokio::test]
    async fn test_cancellation_and_resume_recovery() {
        let (repo, pool) = setup_test_repo().await;

        let job = repo
            .start_study_generation_job(StartStudyJobInput {
                kind: StudyJobKind::Curriculum,
                target_id: "spv_draft_1".to_string(),
                target_revision: 1,
                creation_key: "ck_recovery".to_string(),
                request_hash: "req_recovery".to_string(),
                preflight: serde_json::json!({}),
                steps: vec![CreateStudyStepInput {
                    step_key: "step_0".to_string(),
                    ordinal: 0,
                    input_hash: "h0".to_string(),
                }],
            })
            .await
            .unwrap();

        repo.claim_study_job_step(&job.id, "step_0", "worker-1", 0)
            .await
            .unwrap();

        // Artificially expire lease in the DB
        sqlx::query(
            "UPDATE study_generation_jobs SET lease_expires_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
        )
        .bind(&job.id)
        .execute(&pool)
        .await
        .unwrap();

        // Run recovery
        let recovered = repo.recover_interrupted_study_jobs().await.unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].status, StudyJobStatus::Interrupted);

        // Resuming the interrupted job resets steps to pending and sets status to queued
        let resumed = repo
            .resume_study_generation_job(&job.id, serde_json::json!({"resumed": true}))
            .await
            .unwrap();
        assert_eq!(resumed.status, StudyJobStatus::Queued);

        // Now cancel the job
        repo.cancel_study_generation_job(&job.id, 0).await.unwrap();
        let cancelled_job = repo.get_study_generation_job(&job.id).await.unwrap();
        assert_eq!(cancelled_job.status, StudyJobStatus::Cancelled);

        // Further claim attempts should be rejected
        let claim_err = repo
            .claim_study_job_step(&job.id, "step_0", "worker-1", 1)
            .await;
        assert!(claim_err.is_err());
        assert_eq!(claim_err.unwrap_err().code, StudyErrorCode::InvalidState);
    }
}
