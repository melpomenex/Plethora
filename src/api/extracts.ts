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
  note?: string;
  tags?: string[];
  category?: string;
  color?: string;
  max_disclosure_level?: number;
}

function normalizeExtract(extract: Extract): Extract {
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
  const extract = await invokeCommand<Extract | null>("get_extract", { id });
  return extract ? normalizeExtract(extract) : null;
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
  void (async () => {
    try {
      const { publishExtract } = await import("../lib/sync/entities/extracts");
      await publishExtract(normalized);
    } catch (e) {
      console.warn("Failed to publish extract creation", e);
    }
  })();
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
  });
  const normalized = normalizeExtract(extract);
  void (async () => {
    try {
      const { publishExtract } = await import("../lib/sync/entities/extracts");
      await publishExtract(normalized);
    } catch (e) {
      console.warn("Failed to publish extract update", e);
    }
  })();
  return normalized;
}

/**
 * Delete an extract
 */
export async function deleteExtract(id: string): Promise<void> {
  // The delete command doesn't return the extract, so look up which document
  // owns it BEFORE deleting — relying on whatever local cache happens to have
  // it would silently skip the count patch when the cache is stale, which is
  // the exact bug this function exists to fix.
  const owner = await getExtract(id).catch(() => null);

  await invokeCommand("delete_extract", { id });
  void (async () => {
    try {
      const { publishExtractDeleted } = await import("../lib/sync/entities/extracts");
      await publishExtractDeleted(id);
    } catch (e) {
      console.warn("Failed to publish extract deletion", e);
    }
  })();
  if (owner?.document_id) {
    void patchDocumentExtractCount(owner.document_id, -1);
  }
}

// Helper to publish an extract by fetching it first (for lifecycle updates that don't return the extract)
async function publishExtractById(id: string): Promise<void> {
  try {
    const ext = await getExtract(id);
    if (ext) {
      const { publishExtract } = await import("../lib/sync/entities/extracts");
      await publishExtract(ext);
    }
  } catch (e) {
    console.warn("Failed to publish extract by id", id, e);
  }
}

// ---------------------------------------------------------------------------
// Extract lifecycle actions (SuperMemo-style Forget / Dismiss / Done)
// ---------------------------------------------------------------------------

/**
 * Forget an extract: reset its memory state and return it to the new queue.
 */
export async function forgetExtract(id: string): Promise<void> {
  await invokeCommand("forget_extract", { extractId: id, extract_id: id });
  void publishExtractById(id);
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
  void publishExtractById(id);
}

/**
 * Graduate an extract: schedule it ~5 years in the future with high stability.
 */
export async function graduateExtract(id: string): Promise<void> {
  await invokeCommand("graduate_extract", { extractId: id, extract_id: id });
  void publishExtractById(id);
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
  void publishExtractById(id);
}
