/**
 * Tauri Commands for Learning Evidence, Knowledge Gaps, and Remediation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§8, 9, 11
 * - openspec/changes/derive-study-gaps-from-exam-evidence/ (C6-T04)
 */
use crate::database::{LearningEvidenceRepository, Repository};
use crate::error::Result;
use crate::models::learning_evidence::{
    ConceptMasterySummary, CurriculumPriorEvidence, KnowledgeGapView,
    LearningEvidenceReconcileResult, PlanEvidenceSummary, RemediationRecommendation,
};
use tauri::State;

#[tauri::command]
pub async fn get_concept_mastery_summary(
    repository: State<'_, Repository>,
    concept_id: String,
) -> Result<ConceptMasterySummary> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.get_concept_mastery_summary(&concept_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn get_diagnostic_prior_evidence(
    repository: State<'_, Repository>,
    attempt_id: String,
) -> Result<CurriculumPriorEvidence> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.get_diagnostic_prior_evidence(&attempt_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn get_study_plan_evidence(
    repository: State<'_, Repository>,
    plan_id: String,
) -> Result<PlanEvidenceSummary> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.get_study_plan_evidence(&plan_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn list_learning_gaps(
    repository: State<'_, Repository>,
    plan_id: Option<String>,
    include_dismissed: Option<bool>,
) -> Result<Vec<KnowledgeGapView>> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.list_learning_gaps(plan_id.as_deref(), include_dismissed.unwrap_or(false))
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn dismiss_learning_gap(
    repository: State<'_, Repository>,
    gap_id: String,
    evidence_cutoff: String,
) -> Result<()> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.dismiss_learning_gap(&gap_id, &evidence_cutoff)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn refresh_local_learning_gaps(
    repository: State<'_, Repository>,
    plan_id: String,
) -> Result<Vec<KnowledgeGapView>> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.refresh_local_learning_gaps(&plan_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn reconcile_learning_evidence(
    repository: State<'_, Repository>,
    after_grade_id: Option<String>,
    batch_limit: Option<i64>,
) -> Result<LearningEvidenceReconcileResult> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.reconcile_learning_evidence(after_grade_id.as_deref(), batch_limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn record_remediation_disposition(
    repository: State<'_, Repository>,
    recommendation_id: String,
    status: String,
) -> Result<RemediationRecommendation> {
    let repo = LearningEvidenceRepository::new(repository.pool().clone());
    repo.record_remediation_disposition(&recommendation_id, &status)
        .await
        .map_err(|e| e.to_string().into())
}
