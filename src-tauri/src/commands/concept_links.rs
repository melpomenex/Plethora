//! Concept + concept-link commands (design D21, tasks 6.1/6.4/6.5).
//!
//! Thin wrappers over `ConceptRepository` (see that module for the proposal
//! lifecycle: rows ARE the proposals; accept endorses, dismiss remembers the
//! fingerprint, the per-day AI cap is the anti-spam backstop).
//!
//! Registered next to the element_tree/neural_queue commands (knowledge
//! infrastructure), NOT in the review/rag/ai_learning groups.

use crate::database::{
    Concept, ConceptBacklink, ConceptLink, ConceptRepository, LinkProposalOutcome,
};
use crate::error::Result;
use tauri::State;

fn repo(repo: &State<'_, crate::database::Repository>) -> ConceptRepository {
    ConceptRepository::new(repo.pool().clone())
}

/// Wire shape of `propose_concept_link` results.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkProposalResult {
    /// `"created"` | `"duplicate"` | `"dismissed"`.
    pub outcome: String,
    pub link: ConceptLink,
}

/// Create (or reuse) a concept by name; `normalized_name` dedupes casing and
/// whitespace variants.
#[tauri::command]
pub async fn upsert_concept(
    name: String,
    description: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<Concept> {
    repo(&state)
        .upsert_concept(&name, description.as_deref())
        .await
}

#[tauri::command]
pub async fn get_concept(
    concept_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<Concept>> {
    repo(&state).get_concept(&concept_id).await
}

/// Resolve concepts for a list of names (normalized matching).
#[tauri::command]
pub async fn find_concepts_by_names(
    names: Vec<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<Concept>> {
    repo(&state).find_concepts_by_names(&names).await
}

/// Propose a concept link. Per-analysis caps (≤ 5) and confidence thresholds
/// are enforced by the TS caller; this enforces relation-type validity and
/// the hard per-day AI cap.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn propose_concept_link(
    source_kind: String,
    source_id: String,
    target_kind: String,
    target_id: String,
    relation_type: String,
    confidence: f64,
    provenance_json: Option<serde_json::Value>,
    fingerprint: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<LinkProposalResult> {
    let provenance = provenance_json.map(|value| value.to_string());
    let outcome = repo(&state)
        .propose_link(
            &source_kind,
            &source_id,
            &target_kind,
            &target_id,
            &relation_type,
            confidence,
            provenance.as_deref(),
            fingerprint.as_deref(),
            "ai",
        )
        .await?;
    Ok(match outcome {
        LinkProposalOutcome::Created(link) => LinkProposalResult {
            outcome: "created".into(),
            link,
        },
        LinkProposalOutcome::Duplicate(link) => LinkProposalResult {
            outcome: "duplicate".into(),
            link,
        },
        LinkProposalOutcome::Dismissed(link) => LinkProposalResult {
            outcome: "dismissed".into(),
            link,
        },
    })
}

/// Accept a proposed link — records user endorsement (`created_by` → user).
#[tauri::command]
pub async fn accept_concept_link(
    link_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<ConceptLink>> {
    repo(&state).accept_link(&link_id).await
}

/// Dismiss a proposed link. The fingerprint is remembered; the same proposal
/// is never re-inserted (spec: "dismissed proposals are not re-proposed").
#[tauri::command]
pub async fn dismiss_concept_link(
    link_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<ConceptLink>> {
    repo(&state).dismiss_link(&link_id).await
}

/// Remove a link outright (spec: user control over durable links).
#[tauri::command]
pub async fn delete_concept_link(
    link_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<bool> {
    repo(&state).delete_link(&link_id).await
}

/// Links whose source is `(source_kind, source_id)`, newest first.
#[tauri::command]
pub async fn list_concept_links_for(
    source_kind: String,
    source_id: String,
    include_dismissed: Option<bool>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<ConceptLink>> {
    repo(&state)
        .list_links_for(&source_kind, &source_id, include_dismissed.unwrap_or(false))
        .await
}

/// Links whose target is `(target_kind, target_id)`, newest first.
#[tauri::command]
pub async fn list_concept_links_targeting(
    target_kind: String,
    target_id: String,
    include_dismissed: Option<bool>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<ConceptLink>> {
    repo(&state)
        .list_links_targeting(&target_kind, &target_id, include_dismissed.unwrap_or(false))
        .await
}

/// Concept-page backlinks: live links targeting a concept, with the source
/// concept's name resolved when the source is itself a concept.
#[tauri::command]
pub async fn get_concept_backlinks(
    concept_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<ConceptBacklink>> {
    repo(&state).backlinks(&concept_id).await
}

/// Has this proposal fingerprint been dismissed before? (TS pre-check so
/// dismissed proposals can be skipped before ever surfacing.)
#[tauri::command]
pub async fn concept_link_fingerprint_dismissed(
    fingerprint: String,
    state: State<'_, crate::database::Repository>,
) -> Result<bool> {
    repo(&state)
        .dismissed_fingerprint_exists(&fingerprint)
        .await
}
