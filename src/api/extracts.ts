import { invokeCommand } from "../lib/tauri";
import type { SelectionContext } from "../types/selection";

export interface Extract {
  id: string;
  document_id: string;
  /** Plain text content for search and AI processing */
  content: string;
  /** Rich HTML content with inline styles for 1:1 visual fidelity */
  html_content?: string;
  /** Source URL for web extracts */
  source_url?: string;
  page_title?: string;
  page_number?: number;
  selection_context?: SelectionContext;
  highlight_color?: string;
  notes?: string;
  progressive_disclosure_level: number;
  max_disclosure_level: number;
  progressive_summaries?: Array<{
    level: number;
    summary: string;
    word_count: number;
  }>;
  date_created: string;
  date_modified: string;
  tags: string[];
  category?: string;
  next_review_date?: string;
  last_review_date?: string;
  review_count: number;
  reps: number;
  memory_state?: {
    stability: number;
    difficulty: number;
  };
  /** Inherited priority score (0–100) from the parent document. */
  priority_score?: number;
  /** Dismissed extracts leave the review queue but remain in the library. */
  is_dismissed?: boolean;
  /**
   * Cumulative *active* seconds invested in this extract, mirroring
   * `Document.totalTimeSpent`. `null` means no time was ever recorded — the
   * extract predates tracking — which is deliberately distinct from `0`.
   */
  total_time_spent?: number | null;
}

export interface CreateExtractInput {
  document_id: string;
  content: string;
  /** Rich HTML content with inline styles for 1:1 visual fidelity */
  html_content?: string;
  /** Source URL for web extracts */
  source_url?: string;
  note?: string;
  tags?: string[];
  category?: string;
  color?: string;
  page_number?: number;
  selection_context?: SelectionContext | Record<string, unknown>;
  max_disclosure_level?: number;
}

export interface UpdateExtractInput {
  id: string;
  content?: string;
  /** Rendered rich view (markdown or attached-image figures). Sent by the shared editor; None in Rust preserves the stored value. */
  html_content?: string;
  note?: string;
  tags?: string[];
  category?: string;
  color?: string;
  max_disclosure_level?: number;
  selection_context?: SelectionContext | Record<string, unknown>;
}

const EXTRACT_FIELD_ALIASES = {
  document_id: "documentId", html_content: "htmlContent", source_url: "sourceUrl",
  page_title: "pageTitle", page_number: "pageNumber", selection_context: "selectionContext",
  highlight_color: "highlightColor", progressive_disclosure_level: "progressiveDisclosureLevel",
  max_disclosure_level: "maxDisclosureLevel", progressive_summaries: "progressiveSummaries",
  date_created: "dateCreated", date_modified: "dateModified", next_review_date: "nextReviewDate",
  last_review_date: "lastReviewDate", review_count: "reviewCount", memory_state: "memoryState",
  priority_score: "priorityScore", is_dismissed: "isDismissed", total_time_spent: "totalTimeSpent",
} as const;

function normalizeExtract(input: Extract): Extract {
  // The browser backend emits camelCase; native commands emit snake_case.
  // Keep the public API's snake_case contract for ownership and saved anchors.
  const extract = { ...input } as Extract & Record<string, unknown>;
  for (const [field, alias] of Object.entries(EXTRACT_FIELD_ALIASES)) {
    if (extract[field] === undefined && extract[alias] !== undefined) extract[field] = extract[alias];
  }
  return {
    ...extract,
    content: extract.content ?? "",
    notes: extract.notes ?? "",
    tags: Array.isArray(extract.tags) ? extract.tags : [],
    progressive_disclosure_level: extract.progressive_disclosure_level ?? 0,
    max_disclosure_level: extract.max_disclosure_level ?? 0,
    progressive_summaries: Array.isArray(extract.progressive_summaries) ? extract.progressive_summaries : [],
    review_count: extract.review_count ?? 0,
    reps: extract.reps ?? 0,
  };
}

/**
 * Get all extracts for a document, or all extracts if no documentId is provided
 */
export async function getExtracts(documentId?: string | null): Promise<Extract[]> {
  const extracts = await invokeCommand<Extract[]>("get_extracts", { documentId });
  return Array.isArray(extracts) ? extracts.map(normalizeExtract) : [];
}

/**
 * Get a single extract by ID
 */
export async function getExtract(id: string): Promise<Extract | null> {
  const extract = await invokeCommand<(Extract & { _deleted?: boolean; Deleted?: boolean }) | null>("get_extract", { id });
  if (!extract || extract._deleted || extract.Deleted) return null;
  return normalizeExtract(extract);
}

/**
 * Patch a document's extractCount in the (already-loaded) documentStore, so
 * the Documents view — list, grid, and compact — reflects a newly created or
 * deleted extract without a full document reload.
 *
 * Lives here rather than in extractStore because most callers create/delete
 * extracts by calling this module directly (DocumentViewer, ExtractCreator,
 * CreateExtractDialog, AssistantPanel, ScrollModeArticleEditor, and others),
 * bypassing useExtractStore entirely. This is the one choke point every
 * caller — store-mediated or direct, desktop or browser/PWA (invokeCommand
 * routes to browserInvoke there) — actually passes through.
 *
 * Dynamic import avoids pulling documentStore's dependency graph into this
 * module's callers at load time; a document not present in the store yet
 * (not loaded, or the count patch racing a reload) is a silent no-op rather
 * than an error, since the next real load will carry the correct count anyway.
 */
export async function patchDocumentExtractCount(documentId: string, delta: 1 | -1): Promise<void> {
  try {
    const { useDocumentStore } = await import("../stores/documentStore");
    useDocumentStore.getState().patchExtractCount(documentId, delta);
  } catch (error) {
    console.warn("Failed to patch document extractCount locally", error);
  }
}

/**
 * Create a new extract
 */
export async function createExtract(input: CreateExtractInput): Promise<Extract> {
  const extract = await invokeCommand<Extract>("create_extract", {
    documentId: input.document_id,
    content: input.content,
    htmlContent: input.html_content,
    sourceUrl: input.source_url,
    note: input.note,
    tags: input.tags,
    category: input.category,
    color: input.color,
    pageNumber: input.page_number,
    selectionContext: input.selection_context,
    maxDisclosureLevel: input.max_disclosure_level,
  });
  const normalized = normalizeExtract(extract);
  if (normalized.document_id) {
    void patchDocumentExtractCount(normalized.document_id, 1);
  }
  return normalized;
}

/**
 * Update an existing extract
 */
export async function updateExtract(input: UpdateExtractInput): Promise<Extract> {
  const extract = await invokeCommand<Extract>("update_extract", {
    id: input.id,
    content: input.content,
    note: input.note,
    tags: input.tags,
    category: input.category,
    color: input.color,
    maxDisclosureLevel: input.max_disclosure_level,
    selectionContext: input.selection_context,
  });
  const normalized = normalizeExtract(extract);
  return normalized;
}

/**
 * Delete an extract
 */
const pendingDeletes = new Map<string, Promise<void>>();

export async function deleteExtract(id: string, expectedDocumentId?: string): Promise<void> {
  const pending = pendingDeletes.get(id);
  if (pending) return pending;
  const operation = (async () => {
    // Reader targets require verified ownership; legacy callers retain their
    // existing best-effort owner lookup when deleting by ID alone.
    const owner = expectedDocumentId ? await getExtract(id) : await getExtract(id).catch(() => null);
    if (owner && expectedDocumentId && owner.document_id !== expectedDocumentId) {
      throw new Error("This extract belongs to another document.");
    }
    if (owner || !expectedDocumentId) {
      await invokeCommand("delete_extract", { id });
      if (owner?.document_id) await patchDocumentExtractCount(owner.document_id, -1);
    }
    // Reconcile the known deletion locally; a subsequent refresh failure must
    // never put the mark back or cause another delete/count decrement.
    const reconciled = await Promise.allSettled([
      import("../stores/extractStore").then(({ useExtractStore }) => {
        useExtractStore.setState((state) => ({
          extracts: state.extracts.filter((extract) => extract.id !== id),
          revision: state.revision + 1,
        }));
      }),
      import("../stores/queueStore").then(({ useQueueStore }) => {
        const state = useQueueStore.getState();
        state.removeItemsLocally(state.items.filter((item) => item.itemType === "extract"
          && (item.extractId === id || item.id === id)).map((item) => item.id));
      }),
    ]);
    for (const result of reconciled) {
      if (result.status === "rejected") console.warn("Failed to reconcile deleted extract", result.reason);
    }
    window.dispatchEvent(new CustomEvent("plethora:extract-deleted", { detail: { id, documentId: owner?.document_id ?? expectedDocumentId } }));
  })();
  pendingDeletes.set(id, operation);
  try { await operation; } finally { pendingDeletes.delete(id); }
}

// ---------------------------------------------------------------------------
// Extract lifecycle actions (Forget / Dismiss / Done)
// ---------------------------------------------------------------------------

/**
 * Forget an extract: reset its memory state and return it to the new queue.
 */
export async function forgetExtract(id: string): Promise<void> {
  await invokeCommand("forget_extract", { extractId: id, extract_id: id });
}

/**
 * Dismiss (or undismiss) an extract: removes it from the review queue without
 * deleting it. Defaults to dismissed=true when omitted.
 */
export async function dismissExtract(id: string, dismissed?: boolean): Promise<void> {
  await invokeCommand("dismiss_extract", {
    extractId: id,
    extract_id: id,
    dismissed: dismissed ?? true,
  });
}

/**
 * Graduate an extract: schedule it ~5 years in the future with high stability.
 */
export async function graduateExtract(id: string): Promise<void> {
  await invokeCommand("graduate_extract", { extractId: id, extract_id: id });
}

/**
 * Manually override an extract's inherited priority score (0–100).
 */
export async function setExtractPriority(id: string, priorityScore: number): Promise<void> {
  await invokeCommand("set_extract_priority", {
    id,
    priorityScore,
    priority_score: priorityScore,
  });
}
