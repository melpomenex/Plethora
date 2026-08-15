/**
 * Agent session context (task 8.1): who knows what the user is looking at.
 *
 * The agent runs from a GLOBAL entry (command palette), but
 * `get_current_document` needs the open document. A single-slot provider
 * (same pattern as `paletteActionEvents` live context) lets app surfaces
 * publish read-only document/selection context; the default resolver reads
 * the zustand `documentStore.currentDocument`, which the reader keeps
 * current without any viewer-file changes.
 *
 * Selection is not globally tracked today: with no publisher, the default
 * returns null and `get_current_selection` answers a typed not-available
 * result (spec: typed result, not an error).
 */

import { useDocumentStore } from "../../../stores/documentStore";
import type {
  AgentDocumentSummary,
  AgentEnvironment,
  AgentSelectionSummary,
} from "./tools/types";
import { getImageAssetById } from "../../../api/image-registry";
import { getDueItems, getAllLearningItems } from "../../../api/learning-items";
import { getExtracts } from "../../../api/extracts";
import { getReviewStatistics } from "../../../api/algorithm";
import { retrieveFromLibrary } from "../../../api/ai-learning";

// ──────────────────────────────────────────────────────────────────────────
// Session context provider (single-slot, read-only)
// ──────────────────────────────────────────────────────────────────────────

export interface AgentSessionContextProvider {
  getDocument(): AgentDocumentSummary | null;
  getSelection(): AgentSelectionSummary | null;
}

let provider: AgentSessionContextProvider | null = null;

/** Publish (or replace) the live session context; null clears it. */
export function publishAgentSessionContext(next: AgentSessionContextProvider | null): void {
  provider = next;
}

function documentSummary(doc: ReturnType<typeof useDocumentStore.getState>["currentDocument"]):
  | AgentDocumentSummary
  | null {
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    fileType: doc.fileType,
    currentPage: doc.currentPage,
    totalPages: doc.totalPages,
    progressPercent: doc.progressPercent,
  };
}

/** Default resolver: the globally tracked open document; no selection. */
export const defaultSessionContextProvider: AgentSessionContextProvider = {
  getDocument: () => documentSummary(useDocumentStore.getState().currentDocument),
  getSelection: () => null,
};

export function getAgentSessionContext(): AgentSessionContextProvider {
  return provider ?? defaultSessionContextProvider;
}

// ──────────────────────────────────────────────────────────────────────────
// Default environment over the real APIs (tests inject their own)
// ──────────────────────────────────────────────────────────────────────────

export function createDefaultAgentEnvironment(): AgentEnvironment {
  const context = () => getAgentSessionContext();
  return {
    retrieve: (query, options) =>
      retrieveFromLibrary(query, {
        k: options.k,
        filters: options.filters as never,
      }),
    getDocument: () => context().getDocument(),
    getSelection: () => context().getSelection(),
    getRecentExtracts: async (limit) => {
      const extracts = await getExtracts(null);
      return [...extracts]
        .sort((a, b) => (a.date_modified < b.date_modified ? 1 : -1))
        .slice(0, limit)
        .map((e) => ({
          id: e.id,
          documentId: e.document_id,
          content: e.content,
          dateModified: e.date_modified,
        }));
    },
    getCards: async () => {
      const items = await getAllLearningItems();
      return items.map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        clozeText: item.cloze_text,
        itemType: item.item_type,
        state: item.state,
        dueDate: item.due_date,
        reviewCount: item.review_count,
        lapses: item.lapses,
        lastReviewDate: item.last_review_date,
        tags: item.tags,
      }));
    },
    getDueCards: async () => {
      const due = await getDueItems();
      return due.map((item) => ({
        id: item.id,
        question: item.question,
        itemType: item.item_type,
        dueDate: item.due_date,
      }));
    },
    getReviewStats: async () => {
      const stats = await getReviewStatistics();
      return {
        totalItems: stats.total_items,
        totalReviews: stats.total_reviews,
        totalLapses: stats.total_lapses,
        avgInterval: stats.avg_interval,
        retentionEstimate: stats.retention_estimate,
        dueToday: stats.due_today,
        dueWeek: stats.due_week,
        dueMonth: stats.due_month,
      };
    },
    getImageAsset: async (assetId) => {
      const asset = await getImageAssetById(assetId);
      return asset ? { id: asset.id, fileName: asset.file_name } : null;
    },
  };
}
