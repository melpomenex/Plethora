/**
 * Tauri API wrapper for the SuperMemo neural queue (supermemo-faithful-queue
 * Phase 4) — the optional "Go neural" creative-exploration mode.
 *
 * The neural queue is layered on top of the priority queue: entering neural
 * review builds a queue by spreading activation from a seed element; exiting
 * returns to the priority queue without mutating it. Normal learning never
 * touches these calls.
 */

import { invokeCommand } from "../lib/tauri";
import type { EmbeddingConfig } from "./ai-learning";

export type NeuralElementKind = "document" | "extract" | "learning_item";

/** A persisted row in the neural_queue table. */
export interface NeuralQueueRow {
  element_id: number;
  position: number;
  priority_value: number;
  consumed: boolean;
  updated_at: string;
}

/**
 * Enter neural review (SuperMemo's *Learn : Go neural*): build the neural
 * queue by spreading activation seeded at the given element. Returns the
 * number of elements queued. The priority queue is not mutated.
 *
 * When `embeddingConfig` is supplied, the spreading activation also follows
 * embedding-similarity edges (semantic neighbors via the RAG chunk embeddings).
 * Omit it for collections that aren't indexed — only the tree-topology
 * relationships then drive the queue.
 */
export async function buildNeuralQueue(
  elementKind: NeuralElementKind,
  elementRefId: string,
  embeddingConfig?: EmbeddingConfig,
): Promise<number> {
  return invokeCommand<number>("build_neural_queue", {
    elementKind,
    elementRefId,
    embeddingConfig: embeddingConfig ?? null,
  });
}

/** Fetch up to `limit` unconsumed elements from the front of the neural queue. */
export async function getNeuralQueueFront(limit: number = 20): Promise<NeuralQueueRow[]> {
  return invokeCommand<NeuralQueueRow[]>("get_neural_queue_front", { limit });
}

/**
 * A neural-queue front entry JOINed with its element_tree identity, so the UI
 * can resolve each position back to the concrete document / extract / card to
 * render. `element_id` alone is unrenderable without this JOIN.
 */
export interface ResolvedNeuralQueueEntry {
  element_id: number;
  position: number;
  priority_value: number;
  /** `"document"` | `"extract"` | `"learning_item"`. */
  element_kind: NeuralElementKind;
  /** The concrete item's uuid (documents.id / extracts.id / learning_items.id). */
  element_ref_id: string;
}

/**
 * Fetch up to `limit` unconsumed neural-queue entries, each resolved to its
 * concrete element identity. This is what the "Go neural" review UI calls —
 * unlike `getNeuralQueueFront`, the returned entries carry `element_kind` +
 * `element_ref_id` so the frontend can render the actual document / extract /
 * card. Entries arrive in presentation order (ascending `position`).
 */
export async function getNeuralQueueResolvedFront(
  limit: number = 60,
): Promise<ResolvedNeuralQueueEntry[]> {
  return invokeCommand<ResolvedNeuralQueueEntry[]>("get_neural_queue_resolved_front", { limit });
}

/** Mark `elementId` as studied (consumed). Returns true if a row was updated. */
export async function consumeNeuralQueueElement(elementId: number): Promise<boolean> {
  return invokeCommand<boolean>("consume_neural_queue_element", { elementId });
}

/**
 * Refill the neural queue by spreading activation seeded at the given element,
 * but **only if** the remaining count is below the depletion threshold (< 20).
 * Returns the new queue size if a refill ran, or null if the threshold was met.
 * This is the depletion trigger — call it after `consumeNeuralQueueElement`
 * when the user finishes studying an element in neural review.
 *
 * Pass the same `embeddingConfig` used at build time so semantic neighbors
 * remain in play on refill.
 */
export async function refillNeuralQueueIfDepleted(
  elementKind: NeuralElementKind,
  elementRefId: string,
  embeddingConfig?: EmbeddingConfig,
): Promise<number | null> {
  return invokeCommand<number | null>("refill_neural_queue_if_depleted", {
    elementKind,
    elementRefId,
    embeddingConfig: embeddingConfig ?? null,
  });
}

/** The number of unconsumed elements remaining in the neural queue. */
export async function getNeuralQueueRemaining(): Promise<number> {
  return invokeCommand<number>("get_neural_queue_remaining");
}
