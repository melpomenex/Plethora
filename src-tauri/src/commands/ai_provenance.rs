//! AI provenance commands (design D22/D23, task 2.6).
//!
//! Recording happens from the TS acceptance flow AFTER a domain create
//! succeeded (separate invoke, so a provenance failure can never roll back a
//! created card). `metadata_json` carries the original passage + selection
//! context payload for source navigation.

use crate::database::{AiProvenance, AiProvenanceRepository, Repository};
use crate::error::Result;
use tauri::State;

/// Record provenance for an accepted AI-generated object.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_ai_provenance(
    target_kind: String,
    target_id: String,
    task_id: String,
    provider: String,
    model: Option<String>,
    model_class: Option<String>,
    input_fingerprint: Option<String>,
    metadata_json: Option<serde_json::Value>,
    repo: State<'_, Repository>,
) -> Result<AiProvenance> {
    let repository = AiProvenanceRepository::new(repo.pool().clone());
    repository
        .insert_provenance(&AiProvenance {
            id: String::new(),
            target_kind,
            target_id,
            task_id,
            provider,
            model,
            model_class,
            input_fingerprint,
            created_at: String::new(),
            metadata_json: metadata_json.map(|value| value.to_string()),
        })
        .await
}

/// Get every provenance record attached to a target, oldest first.
#[tauri::command]
pub async fn get_ai_provenance(
    target_kind: String,
    target_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<AiProvenance>> {
    let repository = AiProvenanceRepository::new(repo.pool().clone());
    repository
        .get_provenance_for_target(&target_kind, &target_id)
        .await
}
