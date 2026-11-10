//! Tauri commands for Study Generation durable narrow jobs.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T04)

use crate::database::{Repository, StudyGenerationRepository};
use crate::models::{
    CompleteStudyStepInput, FailStudyStepInput, StartStudyJobInput, StudyCommandError,
    StudyGenerationJob, StudyGenerationStep, StudyJobProgress,
};
use tauri::State;

fn repository(repo: &Repository) -> StudyGenerationRepository {
    StudyGenerationRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn start_study_generation_job(
    input: StartStudyJobInput,
    repo: State<'_, Repository>,
) -> Result<StudyGenerationJob, StudyCommandError> {
    repository(&repo).start_study_generation_job(input).await
}

#[tauri::command]
pub async fn claim_study_job_step(
    job_id: String,
    step_key: String,
    lease_owner: String,
    cancellation_epoch: i64,
    repo: State<'_, Repository>,
) -> Result<StudyGenerationStep, StudyCommandError> {
    repository(&repo)
        .claim_study_job_step(&job_id, &step_key, &lease_owner, cancellation_epoch)
        .await
}

#[tauri::command]
pub async fn complete_study_job_step(
    input: CompleteStudyStepInput,
    repo: State<'_, Repository>,
) -> Result<StudyJobProgress, StudyCommandError> {
    repository(&repo).complete_study_job_step(input).await
}

#[tauri::command]
pub async fn fail_study_job_step(
    input: FailStudyStepInput,
    repo: State<'_, Repository>,
) -> Result<StudyJobProgress, StudyCommandError> {
    repository(&repo).fail_study_job_step(input).await
}

#[tauri::command]
pub async fn cancel_study_generation_job(
    job_id: String,
    cancellation_epoch: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .cancel_study_generation_job(&job_id, cancellation_epoch)
        .await
}

#[tauri::command]
pub async fn resume_study_generation_job(
    job_id: String,
    preflight: serde_json::Value,
    repo: State<'_, Repository>,
) -> Result<StudyGenerationJob, StudyCommandError> {
    repository(&repo)
        .resume_study_generation_job(&job_id, preflight)
        .await
}

#[tauri::command]
pub async fn recover_interrupted_study_jobs(
    repo: State<'_, Repository>,
) -> Result<Vec<StudyGenerationJob>, StudyCommandError> {
    repository(&repo).recover_interrupted_study_jobs().await
}

#[tauri::command]
pub async fn list_study_generation_jobs(
    target_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyGenerationJob>, StudyCommandError> {
    repository(&repo)
        .list_study_generation_jobs(target_id.as_deref())
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::models::{CreateStudyStepInput, StudyJobKind, StudyJobStatus};

    #[tokio::test]
    async fn test_study_generation_commands_direct_flow() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        // Seed a draft study plan
        sqlx::query(
            "INSERT INTO study_plans (id, title, goal, depth, status, created_at, updated_at)
             VALUES ('plan_cmd', 'Cmd Plan', 'Goal', 'foundational', 'active', '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO study_plan_versions (id, plan_id, version, state, source_scope_json, created_by, created_at)
             VALUES ('spv_cmd_1', 'plan_cmd', 1, 'draft', '{}', 'user', '2026-11-10T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let repo = StudyGenerationRepository::new(pool);

        let job = repo
            .start_study_generation_job(StartStudyJobInput {
                kind: StudyJobKind::Curriculum,
                target_id: "spv_cmd_1".to_string(),
                target_revision: 1,
                creation_key: "ck_cmd_1".to_string(),
                request_hash: "hash_cmd_1".to_string(),
                preflight: serde_json::json!({"provider": "test"}),
                steps: vec![CreateStudyStepInput {
                    step_key: "step_0".to_string(),
                    ordinal: 0,
                    input_hash: "h0".to_string(),
                }],
            })
            .await
            .unwrap();

        assert_eq!(job.status, StudyJobStatus::Queued);

        let list = repo
            .list_study_generation_jobs(Some("spv_cmd_1"))
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, job.id);
    }
}
