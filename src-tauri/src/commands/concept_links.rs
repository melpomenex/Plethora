//! Concept + concept-link commands (design D21, tasks 6.1/6.4/6.5; extended by
//! `complete-knowledge-relationships-and-coverage`, tasks 1.1/3.2).
//!
//! Thin wrappers over `ConceptRepository` (see that module for the proposal
//! lifecycle: rows ARE the proposals; accept endorses, dismiss remembers the
//! fingerprint, the per-day AI cap is the anti-spam backstop).
//!
//! The command boundary is deliberately defensive: endpoint kind/existence,
//! source revision, finite confidence, immutable origin, per-analysis cap and
//! uniqueness are validated in Rust so a direct IPC caller cannot bypass the
//! UI policy. Existing single-link commands remain compatible.
//!
//! Registered next to the element_tree/neural_queue commands (knowledge
//! infrastructure), NOT in the review/rag/ai_learning groups.

use crate::database::{
    Concept, ConceptBacklink, ConceptLink, ConceptLinkProposal, ConceptLinkUpdate,
    ConceptRepository, LinkProposalOutcome, LinkUpdateOutcome, NewConceptDraft,
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

fn proposal_result(outcome: LinkProposalOutcome) -> LinkProposalResult {
    match outcome {
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
    }
}

/// Wire shape of `update_concept_link`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkUpdateResult {
    /// `"updated"` | `"conflict"` | `"not-found"`.
    pub outcome: String,
    pub link: Option<ConceptLink>,
    pub conflicting_link: Option<ConceptLink>,
}

/// One proposal supplied by the explicit "Save suggestions" path.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptLinkProposalInput {
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub relation_type: String,
    pub confidence: f64,
    pub source_revision: Option<String>,
    pub target_revision: Option<String>,
    pub provenance_json: Option<serde_json::Value>,
    pub fingerprint: Option<String>,
}

/// One unresolved concept created atomically with its links.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConceptInput {
    pub handle: String,
    pub name: String,
    pub description: Option<String>,
}

fn sanitize_provenance(value: Option<serde_json::Value>) -> Option<String> {
    let value = value?;
    let object = value.as_object()?;
    let mut out = serde_json::Map::new();
    for key in [
        "analysisId",
        "policyVersion",
        "taskId",
        "origin",
        "providerId",
        "modelClass",
        "baseModelName",
    ] {
        if let Some(field) = object.get(key).and_then(|v| v.as_str()) {
            let trimmed = field.trim();
            let safe_token = trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'));
            if !trimmed.is_empty() && trimmed.len() <= 128 && safe_token {
                out.insert(
                    key.to_string(),
                    serde_json::Value::String(trimmed.to_string()),
                );
            }
        }
    }
    if let Some(evidence) = object.get("evidence").and_then(|v| v.as_array()) {
        let bounded: Vec<serde_json::Value> = evidence
            .iter()
            .filter_map(|entry| {
                let entry = entry.as_object()?;
                let kind = entry.get("kind")?.as_str()?;
                if !matches!(kind, "chunk" | "extract" | "card" | "annotation") {
                    return None;
                }
                let id = entry.get("id")?.as_str()?;
                let source_revision = entry
                    .get("sourceRevision")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if id.len() > 200 || source_revision.len() > 200 {
                    return None;
                }
                Some(serde_json::json!({
                    "kind": kind,
                    "id": id,
                    "sourceRevision": source_revision,
                }))
            })
            .take(4)
            .collect();
        out.insert("evidence".to_string(), serde_json::Value::Array(bounded));
    }
    if out.is_empty() {
        return None;
    }
    Some(serde_json::Value::Object(out).to_string())
}

fn to_proposal(
    input: ConceptLinkProposalInput,
    analysis_id: Option<String>,
) -> ConceptLinkProposal {
    ConceptLinkProposal {
        source_kind: input.source_kind,
        source_id: input.source_id,
        target_kind: input.target_kind,
        target_id: input.target_id,
        relation_type: input.relation_type,
        confidence: input.confidence,
        provenance_json: sanitize_provenance(input.provenance_json),
        fingerprint: input.fingerprint,
        origin: "ai".into(),
        analysis_id,
        source_revision: input.source_revision,
        target_revision: input.target_revision,
    }
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

/// Bounded concept list for the read-only graph projection.
#[tauri::command]
pub async fn list_concepts(
    limit: Option<i64>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<Concept>> {
    repo(&state).list_concepts(limit.unwrap_or(500)).await
}

/// Confirmed/endorsed live links only. Pending AI suggestions are excluded
/// from authoritative graph edges/counts.
#[tauri::command]
pub async fn list_confirmed_concept_links(
    limit: Option<i64>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<ConceptLink>> {
    repo(&state)
        .list_confirmed_links(limit.unwrap_or(2000))
        .await
}

/// Propose a concept link. Endpoint kind/existence, revision, relation,
/// confidence, per-analysis cap and immutable origin are enforced here.
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
    source_revision: Option<String>,
    target_revision: Option<String>,
    analysis_id: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<LinkProposalResult> {
    let outcome = repo(&state)
        .propose_link_validated(ConceptLinkProposal {
            source_kind,
            source_id,
            target_kind,
            target_id,
            relation_type,
            confidence,
            provenance_json: sanitize_provenance(provenance_json),
            fingerprint,
            origin: "ai".into(),
            analysis_id,
            source_revision,
            target_revision,
        })
        .await?;
    Ok(proposal_result(outcome))
}

/// Explicit "Save suggestions": ONE transaction creates unresolved concepts
/// and pending AI links, enforces the five-per-analysis cap, and leaves no
/// orphan concepts on failure.
#[tauri::command]
pub async fn save_concept_link_suggestions(
    analysis_id: String,
    proposals: Vec<ConceptLinkProposalInput>,
    new_concepts: Option<Vec<NewConceptInput>>,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<LinkProposalResult>> {
    let drafts: Vec<NewConceptDraft> = new_concepts
        .unwrap_or_default()
        .into_iter()
        .map(|input| NewConceptDraft {
            handle: input.handle,
            name: input.name,
            description: input.description,
        })
        .collect();
    let converted: Vec<ConceptLinkProposal> = proposals
        .into_iter()
        .map(|input| to_proposal(input, Some(analysis_id.clone())))
        .collect();
    let outcomes = repo(&state)
        .save_proposals_batch(&analysis_id, &converted, &drafts)
        .await?;
    Ok(outcomes.into_iter().map(proposal_result).collect())
}

/// Accept a proposed link — records user endorsement (`created_by` → user)
/// while preserving immutable `origin`.
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

/// Remove a link outright (spec: user control over durable links). Removal is
/// distinct from dismissal: no fingerprint is retained.
#[tauri::command]
pub async fn delete_concept_link(
    link_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<bool> {
    repo(&state).delete_link(&link_id).await
}

/// Narrow edit preserving origin, revalidating endpoints/uniqueness. Material
/// edits reset AI endorsement; conflicts surface without dropping the original.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_concept_link(
    link_id: String,
    relation_type: Option<String>,
    confidence: Option<f64>,
    source_kind: Option<String>,
    source_id: Option<String>,
    target_kind: Option<String>,
    target_id: Option<String>,
    source_revision: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<LinkUpdateResult> {
    let outcome = repo(&state)
        .update_link(
            &link_id,
            ConceptLinkUpdate {
                relation_type,
                confidence,
                source_kind,
                source_id,
                target_kind,
                target_id,
                source_revision,
            },
        )
        .await?;
    Ok(match outcome {
        LinkUpdateOutcome::Updated(link) => LinkUpdateResult {
            outcome: "updated".into(),
            link: Some(link),
            conflicting_link: None,
        },
        LinkUpdateOutcome::NotFound => LinkUpdateResult {
            outcome: "not-found".into(),
            link: None,
            conflicting_link: None,
        },
        LinkUpdateOutcome::Conflict(link) => LinkUpdateResult {
            outcome: "conflict".into(),
            link: None,
            conflicting_link: Some(link),
        },
    })
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

/// Narrow read projection for coverage evidence hydration. The coverage module
/// must verify that an annotation still exists and is current before counting
/// it; there was no existing frontend annotation read command.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptEvidenceAnnotation {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub page_number: Option<i64>,
    pub date_modified: String,
}

#[tauri::command]
pub async fn get_concept_evidence_annotation(
    annotation_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<ConceptEvidenceAnnotation>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT id, document_id, content, page_number, date_modified \
         FROM annotations WHERE id = ?1",
    )
    .bind(&annotation_id)
    .fetch_optional(state.pool())
    .await?;
    let Some(row) = row else { return Ok(None) };
    let content: Option<String> = row.try_get("content").unwrap_or(None);
    Ok(Some(ConceptEvidenceAnnotation {
        id: row.try_get("id")?,
        document_id: row.try_get("document_id")?,
        content: content.unwrap_or_default(),
        page_number: row.try_get::<Option<i64>, _>("page_number").ok().flatten(),
        date_modified: row.try_get("date_modified")?,
    }))
}

#[cfg(test)]
mod tests {
    use super::sanitize_provenance;

    #[test]
    fn provenance_projection_drops_arbitrary_fields_and_bounds_evidence() {
        let value = serde_json::json!({
            "analysisId": "analysis-1",
            "taskId": "concept-relationship-analysis",
            "origin": "ai",
            "notes": "free-form hostile text that must not be stored",
            "evidence": [
                {"kind": "chunk", "id": "c1", "sourceRevision": "r1", "text": "private source text"},
                {"kind": "not-a-kind", "id": "x"},
                {"kind": "card", "id": "card-1", "sourceRevision": "r2"},
                {"kind": "extract", "id": "e1", "sourceRevision": "r3"},
                {"kind": "annotation", "id": "a1", "sourceRevision": "r4"},
                {"kind": "chunk", "id": "c2", "sourceRevision": "r5"}
            ]
        });
        let sanitized = sanitize_provenance(Some(value)).expect("projection");
        assert!(sanitized.contains("analysis-1"));
        assert!(!sanitized.contains("free-form hostile text"));
        assert!(!sanitized.contains("private source text"));
        let parsed: serde_json::Value = serde_json::from_str(&sanitized).unwrap();
        assert_eq!(parsed["evidence"].as_array().unwrap().len(), 4);
    }
}
