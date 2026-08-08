//! Tauri commands for the SuperMemo neural queue (supermemo-faithful-queue
//! Phase 4) — the optional "Go neural" creative-exploration mode.
//!
//! These commands are the entry points the frontend invokes to enter neural
//! review, fetch the next elements, mark them studied, and let the depletion
//! trigger refill the queue. Normal learning never touches these; the neural
//! queue is layered on top of the priority queue and does not mutate it.

use tauri::State;

use crate::database::{ElementKind, ElementTreeRepository, NeuralQueueRepository, Repository};
use crate::error::{IncrementumError, Result};

/// Enter neural review (SuperMemo's *Learn : Go neural*): build the neural
/// queue by spreading activation seeded at the element derived from
/// `(element_kind, element_ref_id)`. Returns the number of elements queued.
///
/// The priority queue is **not** mutated — only read for intrinsic priorities.
#[tauri::command]
pub async fn build_neural_queue(
    element_kind: String,
    element_ref_id: String,
    repo: State<'_, Repository>,
) -> Result<usize> {
    let kind = match element_kind.as_str() {
        "document" => ElementKind::Document,
        "extract" => ElementKind::Extract,
        "learning_item" => ElementKind::LearningItem,
        other => {
            return Err(IncrementumError::InvalidInput(format!(
                "unknown element_kind '{other}'"
            )))
        }
    };
    let et = ElementTreeRepository::new(repo.pool().clone());
    let seed = et
        .find_node_id(kind, &element_ref_id)
        .await?
        .ok_or_else(|| {
            IncrementumError::NotFound(format!(
                "element_tree node for {element_kind}:{element_ref_id}"
            ))
        })?;
    let nqr = NeuralQueueRepository::new(repo.pool().clone());
    let entries = nqr.build(seed).await?;
    Ok(entries.len())
}

/// Fetch up to `limit` unconsumed elements from the front of the neural queue,
/// in presentation order.
#[tauri::command]
pub async fn get_neural_queue_front(
    limit: Option<usize>,
    repo: State<'_, Repository>,
) -> Result<Vec<crate::database::NeuralQueueRow>> {
    let nqr = NeuralQueueRepository::new(repo.pool().clone());
    nqr.front(limit.unwrap_or(20)).await
}

/// Mark `element_id` as studied (consumed). If the queue depletes below the
/// threshold as a result, a refill is **not** triggered here — the frontend
/// calls `refill_neural_queue_if_depleted` after consuming, seeded at the
/// element just studied (task 4.11 depletion trigger).
#[tauri::command]
pub async fn consume_neural_queue_element(
    element_id: i64,
    repo: State<'_, Repository>,
) -> Result<bool> {
    let nqr = NeuralQueueRepository::new(repo.pool().clone());
    nqr.consume(element_id).await
}

/// Refill the neural queue by spreading activation seeded at the given element
/// **only if** the remaining count is below the depletion threshold. Returns
/// Some(count) if a refill ran, None if the threshold was met. This is the
/// depletion trigger (task 4.11): it runs after a consume when remaining < 20,
/// not on every grade.
#[tauri::command]
pub async fn refill_neural_queue_if_depleted(
    element_kind: String,
    element_ref_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<usize>> {
    let kind = match element_kind.as_str() {
        "document" => ElementKind::Document,
        "extract" => ElementKind::Extract,
        "learning_item" => ElementKind::LearningItem,
        other => {
            return Err(IncrementumError::InvalidInput(format!(
                "unknown element_kind '{other}'"
            )))
        }
    };
    let nqr = NeuralQueueRepository::new(repo.pool().clone());
    if !nqr.needs_refill().await? {
        return Ok(None);
    }
    let et = ElementTreeRepository::new(repo.pool().clone());
    let seed = et
        .find_node_id(kind, &element_ref_id)
        .await?
        .ok_or_else(|| {
            IncrementumError::NotFound(format!(
                "element_tree node for {element_kind}:{element_ref_id}"
            ))
        })?;
    let entries = nqr.build(seed).await?;
    Ok(Some(entries.len()))
}

/// The number of unconsumed elements remaining in the neural queue.
#[tauri::command]
pub async fn get_neural_queue_remaining(repo: State<'_, Repository>) -> Result<usize> {
    let nqr = NeuralQueueRepository::new(repo.pool().clone());
    nqr.remaining().await
}
