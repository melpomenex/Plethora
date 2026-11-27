use crate::database::repository::Repository;
use crate::database::study_mode_repository::StudyModeRepository;
use crate::error::Result;
use crate::models::study_mode::{
    CreateStudyFormativeQuestionInput, RecordStudyEfficacyEventInput, SaveStudyModeArtifactInput,
    StudyFormativeQuestionClientView, StudyFormativeSubmissionResult, StudyLearnerPreference,
    StudyModeArtifact, StudyModeSession, SubmitStudyFormativeAnswerInput,
    UpsertStudyLearnerPreferenceInput, UpsertStudyModeSessionInput,
};
use crate::study_mode::{verify_artifact_deterministic, VerificationInput, VerificationResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyStudyModeArtifactInput {
    pub artifact_type: String,
    pub knowledge_authority: String,
    pub authorized_source_ids: Vec<String>,
    pub expected_revision: String,
    pub artifact_revision: String,
    pub source_texts: Vec<String>,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn upsert_study_mode_session(
    repo: State<'_, Repository>,
    input: UpsertStudyModeSessionInput,
) -> Result<StudyModeSession> {
    StudyModeRepository::upsert_session(repo.pool(), input).await
}

#[tauri::command]
pub async fn get_study_mode_session(
    repo: State<'_, Repository>,
    id: String,
) -> Result<StudyModeSession> {
    StudyModeRepository::get_session(repo.pool(), &id).await
}

#[tauri::command]
pub async fn find_study_mode_session_by_scope(
    repo: State<'_, Repository>,
    scope_kind: String,
    scope_key: Option<String>,
    document_id: Option<String>,
    study_plan_id: Option<String>,
    topic_id: Option<String>,
    segment_id: Option<String>,
) -> Result<Option<StudyModeSession>> {
    StudyModeRepository::find_session_by_scope(
        repo.pool(),
        &scope_kind,
        scope_key.as_deref(),
        document_id.as_deref(),
        study_plan_id.as_deref(),
        topic_id.as_deref(),
        segment_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn save_study_mode_artifact(
    repo: State<'_, Repository>,
    input: SaveStudyModeArtifactInput,
) -> Result<StudyModeArtifact> {
    StudyModeRepository::save_artifact(repo.pool(), input).await
}

#[tauri::command]
pub async fn list_study_mode_artifacts(
    repo: State<'_, Repository>,
    scope_key: String,
    include_dismissed: Option<bool>,
) -> Result<Vec<StudyModeArtifact>> {
    StudyModeRepository::list_artifacts_for_scope(
        repo.pool(),
        &scope_key,
        include_dismissed.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn mark_study_mode_artifacts_stale(
    repo: State<'_, Repository>,
    scope_key: String,
    current_revision: String,
) -> Result<u64> {
    StudyModeRepository::mark_scope_artifacts_stale(repo.pool(), &scope_key, &current_revision)
        .await
}

#[tauri::command]
pub async fn dismiss_study_mode_artifact(
    repo: State<'_, Repository>,
    artifact_id: String,
) -> Result<()> {
    StudyModeRepository::dismiss_artifact(repo.pool(), &artifact_id).await
}

#[tauri::command]
pub async fn restore_study_mode_artifact(
    repo: State<'_, Repository>,
    artifact_id: String,
) -> Result<StudyModeArtifact> {
    StudyModeRepository::restore_artifact(repo.pool(), &artifact_id).await
}

#[tauri::command]
pub async fn delete_study_mode_artifact(
    repo: State<'_, Repository>,
    artifact_id: String,
) -> Result<()> {
    StudyModeRepository::delete_artifact(repo.pool(), &artifact_id).await
}

#[tauri::command]
pub async fn delete_study_mode_artifacts_for_scope(
    repo: State<'_, Repository>,
    scope_key: String,
) -> Result<u64> {
    StudyModeRepository::delete_artifacts_for_scope(repo.pool(), &scope_key).await
}

#[tauri::command]
pub async fn upsert_study_learner_preference(
    repo: State<'_, Repository>,
    input: UpsertStudyLearnerPreferenceInput,
) -> Result<StudyLearnerPreference> {
    StudyModeRepository::upsert_learner_preference(repo.pool(), input).await
}

#[tauri::command]
pub async fn list_study_learner_preferences(
    repo: State<'_, Repository>,
) -> Result<Vec<StudyLearnerPreference>> {
    StudyModeRepository::list_learner_preferences(repo.pool()).await
}

#[tauri::command]
pub async fn delete_study_learner_preference(
    repo: State<'_, Repository>,
    subject_key: String,
) -> Result<()> {
    StudyModeRepository::delete_learner_preference(repo.pool(), &subject_key).await
}

#[tauri::command]
pub async fn create_study_formative_question(
    repo: State<'_, Repository>,
    input: CreateStudyFormativeQuestionInput,
) -> Result<StudyFormativeQuestionClientView> {
    StudyModeRepository::create_formative_question(repo.pool(), input).await
}

#[tauri::command]
pub async fn submit_study_formative_answer(
    repo: State<'_, Repository>,
    input: SubmitStudyFormativeAnswerInput,
) -> Result<StudyFormativeSubmissionResult> {
    StudyModeRepository::submit_formative_answer(repo.pool(), input).await
}

#[tauri::command]
pub async fn verify_study_mode_artifact(
    input: VerifyStudyModeArtifactInput,
) -> Result<VerificationResult> {
    Ok(verify_artifact_deterministic(&VerificationInput {
        artifact_type: &input.artifact_type,
        knowledge_authority: &input.knowledge_authority,
        authorized_source_ids: &input.authorized_source_ids,
        expected_revision: &input.expected_revision,
        artifact_revision: &input.artifact_revision,
        source_texts: &input.source_texts,
        payload: &input.payload,
    }))
}

#[tauri::command]
pub async fn record_study_efficacy_event(
    repo: State<'_, Repository>,
    input: RecordStudyEfficacyEventInput,
) -> Result<String> {
    StudyModeRepository::record_efficacy_event(repo.pool(), input).await
}
