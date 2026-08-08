/**
 * Neural-review helpers for Scroll Mode — the bridge between the neural_queue
 * backend and the scroll renderer.
 *
 * Lives outside `QueueScrollPage.tsx` (the ~4000-line component) so the
 * spreading-activation → ScrollItem mapping and seed derivation are unit-
 * testable without mounting the component, mirroring `queueScrollBudget.ts`
 * and `queueScrollOrder.ts`.
 */

import type { ResolvedNeuralQueueEntry, NeuralElementKind } from "../api/neural-queue";
import type { Document } from "../types/document";
import type { LearningItem } from "../api/learning-items";
import type { Extract } from "../api/extracts";
import { getDocument } from "../api/documents";
import { getAllLearningItems } from "../api/learning-items";
import { getExtracts } from "../api/extracts";

/**
 * How many neural-queue entries to fetch per batch. Larger than the 20-element
 * refill threshold so we don't refetch the front on every advance, but bounded
 * so a huge activation graph doesn't load all at once.
 */
export const NEURAL_FETCH_BATCH = 60;

/**
 * The subset of a ScrollItem that a neural entry resolves to. Structurally
 * compatible with the full ScrollItem defined in QueueScrollPage, so the
 * component can use the result directly.
 */
export interface NeuralScrollItem {
  id: string;
  type: "document" | "flashcard" | "extract";
  neuralElementId: number;
  documentTitle: string;
  documentId?: string;
  learningItem?: LearningItem;
  extract?: Extract;
  category?: string;
  estimatedTime?: number;
  engagementScore?: number;
}

/**
 * Derive a neural seed (element kind + ref id) from a scroll item, for the
 * refill-after-consume path. Returns null for items with no element_tree node
 * (RSS/podcast), which cannot seed a neural build.
 */
export function neuralSeedFromItem(item: {
  type: string;
  documentId?: string;
  learningItem?: { id: string };
  extract?: { id: string };
} | undefined): { kind: NeuralElementKind; refId: string } | null {
  if (!item) return null;
  if (item.type === "document" && item.documentId) {
    return { kind: "document", refId: item.documentId };
  }
  if (item.type === "flashcard" && item.learningItem) {
    return { kind: "learning_item", refId: item.learningItem.id };
  }
  if (item.type === "extract" && item.extract) {
    return { kind: "extract", refId: item.extract.id };
  }
  return null;
}

/**
 * Resolve neural-queue entries (each a bare element_tree id + kind + ref id)
 * into renderable scroll items, in spreading-activation presentation order.
 *
 * Documents resolve from the in-memory `documentsMap` (the loaded store) with
 * a per-miss `getDocument` fallback; learning items and extracts are fetched
 * in bulk once and indexed by id. The entries are already sorted by
 * `position ASC` by the backend, so the result preserves the activation order
 * — it is NOT re-sorted (that would defeat the feature).
 *
 * Each item carries `neuralElementId` so advancing can consume the right
 * element_tree node and trigger a refill when depleted.
 *
 * Dependencies (`getDocument`, `getAllLearningItems`, `getExtracts`) are
 * injected so the mapping logic is testable without IPC.
 */
export async function buildNeuralScrollItems(
  entries: ResolvedNeuralQueueEntry[],
  documentsMap: ReadonlyMap<string, Document>,
  fallbackTitle: string,
  deps: {
    fetchDocument?: (id: string) => Promise<Document | undefined>;
    fetchAllLearningItems?: () => Promise<LearningItem[]>;
    fetchAllExtracts?: () => Promise<Extract[]>;
  } = {},
): Promise<NeuralScrollItem[]> {
  if (entries.length === 0) return [];

  const fetchDocument = deps.fetchDocument ?? (async (id: string) => {
    try {
      return await getDocument(id);
    } catch {
      return undefined;
    }
  });
  const fetchAllLearningItems = deps.fetchAllLearningItems ?? getAllLearningItems;
  const fetchAllExtracts = deps.fetchAllExtracts ?? getExtracts;

  // Partition ref ids by kind so each bulk fetch runs once.
  const docIds = new Set<string>();
  const cardIds = new Set<string>();
  const extractIds = new Set<string>();
  for (const entry of entries) {
    if (entry.element_kind === "document") docIds.add(entry.element_ref_id);
    else if (entry.element_kind === "learning_item") cardIds.add(entry.element_ref_id);
    else if (entry.element_kind === "extract") extractIds.add(entry.element_ref_id);
  }

  // Bulk-fetch cards and extracts once; index by id for O(1) lookup.
  const cardById = new Map<string, LearningItem>();
  if (cardIds.size > 0) {
    try {
      for (const card of await fetchAllLearningItems()) cardById.set(card.id, card);
    } catch {
      // Fall back to empty — unresolved entries are skipped below.
    }
  }
  const extractById = new Map<string, Extract>();
  if (extractIds.size > 0) {
    try {
      for (const ext of await fetchAllExtracts()) extractById.set(ext.id, ext);
    } catch {
      // Fall back to empty.
    }
  }

  // Walk entries in presentation order, resolving each to a scroll item.
  const items: NeuralScrollItem[] = [];
  for (const entry of entries) {
    if (entry.element_kind === "document") {
      let doc = documentsMap.get(entry.element_ref_id);
      if (!doc) doc = await fetchDocument(entry.element_ref_id);
      if (!doc || doc.isArchived || doc.isDismissed) continue;
      items.push({
        id: `neural-${entry.element_id}`,
        type: "document",
        neuralElementId: entry.element_id,
        documentId: doc.id,
        documentTitle: doc.title,
        category: doc.category ?? "uncategorized",
        estimatedTime: 10,
        engagementScore: 10 - entry.priority_value * 5,
      });
    } else if (entry.element_kind === "learning_item") {
      const card = cardById.get(entry.element_ref_id);
      if (!card) continue;
      items.push({
        id: `neural-${entry.element_id}`,
        type: "flashcard",
        neuralElementId: entry.element_id,
        documentTitle: card.question.substring(0, 50) + (card.question.length > 50 ? "..." : ""),
        learningItem: card,
        category: card.tags?.[0] ?? "flashcards",
        estimatedTime: 2,
        engagementScore: 10 - entry.priority_value * 5,
      });
    } else if (entry.element_kind === "extract") {
      const ext = extractById.get(entry.element_ref_id);
      if (!ext) continue;
      const doc = documentsMap.get(ext.document_id);
      items.push({
        id: `neural-${entry.element_id}`,
        type: "extract",
        neuralElementId: entry.element_id,
        documentTitle: doc ? doc.title : fallbackTitle,
        extract: ext,
        category: ext.category ?? doc?.category ?? "extracts",
        estimatedTime: 3,
        engagementScore: 10 - entry.priority_value * 5,
      });
    }
  }
  return items;
}
