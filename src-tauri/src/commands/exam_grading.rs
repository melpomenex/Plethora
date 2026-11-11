/**
 * Tauri Commands for Rubric-Based Exam Grading.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, §11, §12
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T03)
 */
use crate::database::ExamGradingRepository;
use crate::error::Result;
use crate::models::exam_session::ExamGrade;
use crate::models::rubric_grade::{
    GradeSettlementOutcome, RecordManualGradeInput, RecordRubricGradeInput,
};
use sqlx::{Pool, Sqlite};
use tauri::State;

#[tauri::command]
pub async fn record_rubric_grade(
    pool: State<'_, Pool<Sqlite>>,
    input: RecordRubricGradeInput,
) -> Result<GradeSettlementOutcome> {
    let repo = ExamGradingRepository::new(pool.inner().clone());
    repo.record_rubric_grade(input)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn record_manual_grade(
    pool: State<'_, Pool<Sqlite>>,
    input: RecordManualGradeInput,
) -> Result<GradeSettlementOutcome> {
    let repo = ExamGradingRepository::new(pool.inner().clone());
    repo.record_manual_grade(input)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn get_response_grade_history(
    pool: State<'_, Pool<Sqlite>>,
    response_submission_id: String,
) -> Result<Vec<ExamGrade>> {
    let repo = ExamGradingRepository::new(pool.inner().clone());
    repo.get_response_grade_history(&response_submission_id)
        .await
        .map_err(|e| e.to_string().into())
}
