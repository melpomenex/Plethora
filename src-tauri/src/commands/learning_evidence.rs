/**
 * Tauri Commands for Learning Evidence, Knowledge Gaps, and Remediation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§8, 9, 11
 * - openspec/changes/derive-study-gaps-from-exam-evidence/ (C6-T04)
 */
use crate::database::LearningEvidenceRepository;
use crate::error::Result;
use crate::models::learning_evidence::{
    ConceptMasterySummary, CurriculumPriorEvidence, KnowledgeGapView,
    LearningEvidenceReconcileResult, PlanEvidenceSummary, RemediationRecommendation,
};
use sqlx::{Pool, Sqlite};
use tauri::State;

#[tauri::command]
pub async fn get_concept_mastery_summary(
    pool: State<'_, Pool<Sqlite>>,
    concept_id: String,
) -> Result<ConceptMasterySummary> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.get_concept_mastery_summary(&concept_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn get_diagnostic_prior_evidence(
    pool: State<'_, Pool<Sqlite>>,
    attempt_id: String,
) -> Result<CurriculumPriorEvidence> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.get_diagnostic_prior_evidence(&attempt_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn get_study_plan_evidence(
    pool: State<'_, Pool<Sqlite>>,
    plan_id: String,
) -> Result<PlanEvidenceSummary> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.get_study_plan_evidence(&plan_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn list_learning_gaps(
    pool: State<'_, Pool<Sqlite>>,
    plan_id: Option<String>,
    include_dismissed: Option<bool>,
) -> Result<Vec<KnowledgeGapView>> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.list_learning_gaps(plan_id.as_deref(), include_dismissed.unwrap_or(false))
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn dismiss_learning_gap(
    pool: State<'_, Pool<Sqlite>>,
    gap_id: String,
    evidence_cutoff: String,
) -> Result<()> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.dismiss_learning_gap(&gap_id, &evidence_cutoff)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn refresh_local_learning_gaps(
    pool: State<'_, Pool<Sqlite>>,
    plan_id: String,
) -> Result<Vec<KnowledgeGapView>> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.refresh_local_learning_gaps(&plan_id)
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn reconcile_learning_evidence(
    pool: State<'_, Pool<Sqlite>>,
    after_grade_id: Option<String>,
    batch_limit: Option<i64>,
) -> Result<LearningEvidenceReconcileResult> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.reconcile_learning_evidence(after_grade_id.as_deref(), batch_limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string().into())
}

#[tauri::command]
pub async fn record_remediation_disposition(
    pool: State<'_, Pool<Sqlite>>,
    recommendation_id: String,
    status: String,
) -> Result<RemediationRecommendation> {
    let repo = LearningEvidenceRepository::new(pool.inner().clone());
    repo.record_remediation_disposition(&recommendation_id, &status)
        .await
        .map_err(|e| e.to_string().into())
}
