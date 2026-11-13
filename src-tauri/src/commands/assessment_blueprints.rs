//! Tauri commands for Assessment Blueprints and Questions.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/generate-study-plan-examinations/ (C3-T04)

use crate::database::{AssessmentBlueprintRepository, Repository};
use crate::models::assessment_blueprint::{
    AssessmentQuestionRevision, BlueprintDetail, BlueprintSummary, CreateBlueprintInput,
    SaveBlueprintDraftInput, SaveQuestionDraftInput,
};
use crate::models::study_source::StudyCommandError;
use tauri::State;

fn repository(repo: &Repository) -> AssessmentBlueprintRepository {
    AssessmentBlueprintRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn create_assessment_blueprint(
    input: CreateBlueprintInput,
    repo: State<'_, Repository>,
) -> Result<BlueprintDetail, StudyCommandError> {
    repository(&repo).create_assessment_blueprint(input).await
}

#[tauri::command]
pub async fn save_assessment_blueprint_draft(
    input: SaveBlueprintDraftInput,
    repo: State<'_, Repository>,
) -> Result<BlueprintDetail, StudyCommandError> {
    repository(&repo)
        .save_assessment_blueprint_draft(input)
        .await
}

#[tauri::command]
pub async fn get_assessment_blueprint_revision(
    revision_id: String,
    repo: State<'_, Repository>,
) -> Result<BlueprintDetail, StudyCommandError> {
    repository(&repo)
        .get_assessment_blueprint_revision(&revision_id)
        .await
}

#[tauri::command]
pub async fn list_assessment_blueprints(
    plan_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<BlueprintSummary>, StudyCommandError> {
    repository(&repo)
        .list_assessment_blueprints(plan_id.as_deref())
        .await
}

#[tauri::command]
pub async fn upsert_assessment_question_draft(
    input: SaveQuestionDraftInput,
    repo: State<'_, Repository>,
) -> Result<AssessmentQuestionRevision, StudyCommandError> {
    repository(&repo)
        .upsert_assessment_question_draft(input)
        .await
}

#[tauri::command]
pub async fn publish_assessment_blueprint(
    revision_id: String,
    expected_revision: i64,
    shortfall_accepted: bool,
    external_evidence_accepted: bool,
    repo: State<'_, Repository>,
) -> Result<BlueprintDetail, StudyCommandError> {
    repository(&repo)
        .publish_assessment_blueprint(
            &revision_id,
            expected_revision,
            shortfall_accepted,
            external_evidence_accepted,
        )
        .await
}

#[tauri::command]
pub async fn discard_assessment_blueprint_draft(
    revision_id: String,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .discard_assessment_blueprint_draft(&revision_id, expected_revision)
        .await
}

#[tauri::command]
pub async fn archive_assessment_blueprint(
    blueprint_id: String,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .archive_assessment_blueprint(&blueprint_id, expected_revision)
        .await
}

#[tauri::command]
pub async fn delete_unused_assessment_blueprint(
    blueprint_id: String,
    expected_revision: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .delete_unused_assessment_blueprint(&blueprint_id, expected_revision)
        .await
}
