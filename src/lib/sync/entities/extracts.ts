import { createReplicatedMap, type ReplicatedMap } from "../replicatedMap";
import { invokeCommand, isTauri } from "../../tauri";
import type { Extract } from "../../../api/extracts";

export interface SyncedExtract {
  id: string;
  collection_id: string;
  document_id: string;
  content: string;
  html_content?: string;
  source_url?: string;
  page_title?: string;
  page_number?: number;
  selection_context?: any;
  highlight_color?: string;
  notes?: string;
  progressive_disclosure_level: number;
  max_disclosure_level: number;
  progressive_summaries?: any[];
  date_created: string;
  date_modified: string;
  tags: string[];
  category?: string;
  memory_state?: { stability: number; difficulty: number };
  next_review_date?: string;
  last_review_date?: string;
  review_count: number;
  reps: number;
  source_hash?: string;
  priority_score: number;
  is_dismissed: boolean;
  updatedAt: string; // CamelCase alias mapped to date_modified for replicatedMap
}

let extractsMap: ReplicatedMap<SyncedExtract> | null = null;

function getExtractsMap(): ReplicatedMap<SyncedExtract> {
  if (!extractsMap) {
    extractsMap = createReplicatedMap<SyncedExtract>({
      name: "extracts",
      label: "extracts",
      mode: "row-lww",
      clockField: "updatedAt",
      getLocal: async (key) => {
        try {
          const raw = await invokeCommand<Extract | null>("get_synced_extract", { id: key });
          if (!raw) return null;
          return toSyncedExtract(raw);
        } catch {
          return null;
        }
      },
      apply: async (_key, row) => {
        const input = fromSyncedExtract(row);
        await invokeCommand("upsert_synced_extract", { extract: input });
        try {
          window.dispatchEvent(new CustomEvent("incrementum:synced-extract", { detail: { id: row.id } }));
        } catch {
          /* ignore */
        }
      },
      applyDelete: async (key) => {
        await invokeCommand("delete_synced_extract", { id: key });
        try {
          window.dispatchEvent(new CustomEvent("incrementum:synced-extract-deleted", { detail: { id: key } }));
        } catch {
          /* ignore */
        }
      },
    });
  }
  return extractsMap;
}

export function toSyncedExtract(raw: any): SyncedExtract {
  const dateModified = raw.dateModified || raw.date_modified || new Date().toISOString();
  return {
    id: String(raw.id ?? ""),
    collection_id: raw.collectionId || raw.collection_id || "00000000-0000-0000-0000-000000000001",
    document_id: raw.documentId || raw.document_id || "",
    content: String(raw.content ?? ""),
    html_content: raw.htmlContent || raw.html_content || undefined,
    source_url: raw.sourceUrl || raw.source_url || undefined,
    page_title: raw.pageTitle || raw.page_title || undefined,
    page_number: raw.pageNumber || raw.page_number || undefined,
    selection_context: raw.selectionContext || raw.selection_context || undefined,
    highlight_color: raw.highlightColor || raw.highlight_color || raw.color || undefined,
    notes: raw.notes || raw.note || raw.notes || undefined,
    progressive_disclosure_level: raw.progressiveDisclosureLevel || raw.progressive_disclosure_level || 0,
    max_disclosure_level: raw.maxDisclosureLevel || raw.max_disclosure_level || 3,
    progressive_summaries: raw.progressiveSummaries || raw.progressive_summaries || undefined,
    date_created: raw.dateCreated || raw.date_created || new Date().toISOString(),
    date_modified: dateModified,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    category: raw.category || undefined,
    memory_state: raw.memoryState || raw.memory_state || undefined,
    next_review_date: raw.nextReviewDate || raw.next_review_date || undefined,
    last_review_date: raw.lastReviewDate || raw.last_review_date || undefined,
    review_count: raw.reviewCount || raw.review_count || 0,
    reps: raw.reps || 0,
    source_hash: raw.sourceHash || raw.source_hash || undefined,
    priority_score: raw.priorityScore || raw.priority_score || 0.0,
    is_dismissed: !!(raw.isDismissed || raw.is_dismissed),
    updatedAt: dateModified,
  };
}

function fromSyncedExtract(row: SyncedExtract): any {
  return {
    id: row.id,
    collection_id: row.collection_id,
    document_id: row.document_id,
    content: row.content,
    html_content: row.html_content,
    source_url: row.source_url,
    page_title: row.page_title,
    page_number: row.page_number,
    selection_context: row.selection_context,
    highlight_color: row.highlight_color,
    notes: row.notes,
    progressive_disclosure_level: row.progressive_disclosure_level,
    max_disclosure_level: row.max_disclosure_level,
    progressive_summaries: row.progressive_summaries,
    date_created: row.date_created,
    date_modified: row.date_modified,
    tags: row.tags,
    category: row.category,
    memory_state: row.memory_state,
    next_review_date: row.next_review_date,
    last_review_date: row.last_review_date,
    review_count: row.review_count,
    reps: row.reps,
    source_hash: row.source_hash,
    priority_score: row.priority_score,
    is_dismissed: row.is_dismissed,
  };
}

export async function publishExtract(raw: any): Promise<void> {
  if (!isTauri()) return;
  const synced = toSyncedExtract(raw);
  await getExtractsMap().publish(synced.id, synced);
}

export async function publishExtractDeleted(id: string): Promise<void> {
  if (!isTauri()) return;
  await getExtractsMap().delete(id);
}

export async function ensureExtractSyncReady(): Promise<void> {
  if (!isTauri()) return;
  await getExtractsMap().ensureReady();
}
