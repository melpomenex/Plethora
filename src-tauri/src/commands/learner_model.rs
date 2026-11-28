//! Tauri commands for the 5-dimension Persistent Learner Model (Phase 1B).

use crate::database::{LearnerModelRepository, Repository};
use crate::error::Result;
use crate::models::learner_model::{
    CompetencyDimension, CompetencyEvidenceRecord, ConceptCompetencyProfile,
    DeclaredCompetencyLevel, InvalidateCompetencyEvidenceResult, LearnerCompetencyDeclaration,
    RecordCompetencyEvidenceInput,
};
use tauri::State;

#[tauri::command]
pub async fn record_competency_evidence(
    repository: State<'_, Repository>,
    input: RecordCompetencyEvidenceInput,
) -> Result<CompetencyEvidenceRecord> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.record_competency_evidence(&input).await
}

#[tauri::command]
pub async fn invalidate_competency_evidence(
    repository: State<'_, Repository>,
    evidence_ids: Option<Vec<String>>,
    source_event_id: Option<String>,
    invalidated_by_event_id: Option<String>,
) -> Result<InvalidateCompetencyEvidenceResult> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.invalidate_competency_evidence(
        evidence_ids.as_deref(),
        source_event_id.as_deref(),
        invalidated_by_event_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn recompute_concept_competency(
    repository: State<'_, Repository>,
    concept_id: String,
    now_iso: Option<String>,
) -> Result<ConceptCompetencyProfile> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.recompute_concept_competency(&concept_id, now_iso.as_deref())
        .await
}

#[tauri::command]
pub async fn get_concept_competency_profile(
    repository: State<'_, Repository>,
    concept_id: String,
    ai_context: Option<bool>,
) -> Result<ConceptCompetencyProfile> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.get_concept_competency_profile(&concept_id, ai_context.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn list_concept_competency_profiles(
    repository: State<'_, Repository>,
    concept_ids: Option<Vec<String>>,
    ai_context: Option<bool>,
) -> Result<Vec<ConceptCompetencyProfile>> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.list_concept_competency_profiles(concept_ids.as_deref(), ai_context.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn set_learner_competency_declaration(
    repository: State<'_, Repository>,
    concept_id: String,
    declared_level: DeclaredCompetencyLevel,
    note: Option<String>,
) -> Result<LearnerCompetencyDeclaration> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.set_learner_competency_declaration(&concept_id, declared_level, note.as_deref())
        .await
}

#[tauri::command]
pub async fn get_concept_evidence_history(
    repository: State<'_, Repository>,
    concept_id: String,
    dimension: Option<CompetencyDimension>,
    include_invalidated: Option<bool>,
    ai_context: Option<bool>,
) -> Result<Vec<CompetencyEvidenceRecord>> {
    let repo = LearnerModelRepository::new(repository.pool().clone());
    repo.get_concept_evidence_history(
        &concept_id,
        dimension,
        include_invalidated.unwrap_or(false),
        ai_context.unwrap_or(false),
    )
    .await
}
