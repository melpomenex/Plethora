//! Tauri commands for Resumable Examination Sessions and Attempts.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/implement-resumable-examination-sessions/ (C4-T03)

use crate::database::{ExamSessionRepository, Repository};
use crate::models::exam_session::*;
use crate::models::study_source::StudyCommandError;
use tauri::State;

#[tauri::command]
pub async fn start_exam_attempt(
    input: StartAttemptInput,
    repo: State<'_, Repository>,
) -> Result<AttemptDetail, StudyCommandError> {
    ExamSessionRepository::start_exam_attempt(repo.pool(), input).await
}

#[tauri::command]
pub async fn get_exam_attempt(
    attempt_id: String,
    repo: State<'_, Repository>,
) -> Result<AttemptDetail, StudyCommandError> {
    ExamSessionRepository::get_exam_attempt(repo.pool(), &attempt_id).await
}

#[tauri::command]
pub async fn list_exam_attempts(
    input: AttemptHistoryFilter,
    repo: State<'_, Repository>,
) -> Result<Vec<AttemptSummary>, StudyCommandError> {
    ExamSessionRepository::list_exam_attempts(repo.pool(), input).await
}

#[tauri::command]
pub async fn save_exam_response(
    input: SaveResponseInput,
    repo: State<'_, Repository>,
) -> Result<ExamResponse, StudyCommandError> {
    ExamSessionRepository::save_exam_response(repo.pool(), input).await
}

#[tauri::command]
pub async fn submit_exam_attempt(
    input: SubmitAttemptInput,
    repo: State<'_, Repository>,
) -> Result<AttemptDetail, StudyCommandError> {
    ExamSessionRepository::submit_exam_attempt(repo.pool(), input).await
}

#[tauri::command]
pub async fn check_practice_response(
    input: CheckPracticeInput,
    repo: State<'_, Repository>,
) -> Result<PracticeCheckResult, StudyCommandError> {
    ExamSessionRepository::check_practice_response(repo.pool(), input).await
}

#[tauri::command]
pub async fn cancel_exam_attempt(
    attempt_id: String,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<AttemptDetail, StudyCommandError> {
    ExamSessionRepository::cancel_exam_attempt(repo.pool(), &attempt_id, expected_revision).await
}

#[tauri::command]
pub async fn delete_exam_history(
    attempt_id: String,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    ExamSessionRepository::delete_exam_history(repo.pool(), &attempt_id).await
}
