import { create } from "zustand";
import {
  createExtract,
  updateExtract,
  deleteExtract,
  type CreateExtractInput,
  type UpdateExtractInput,
} from "../api/extracts";

/**
 * Legacy "free-form data" shape that older callers passed in. We normalize it
 * to the typed {@link CreateExtractInput}/{@link UpdateExtractInput} so the
 * api/extracts wrappers (which use the correct Tauri arg shape AND publish to
 * the sync room) do the real work. Previously this store called
 * `invokeCommand("create_extract", { extract: data })`, which is NOT the shape
 * the Rust command accepts (it takes individual fields) and never published.
 */
type LegacyExtractData = Record<string, unknown> & {
  documentId?: string;
  document_id?: string;
  content?: string;
  note?: string;
  notes?: string;
  tags?: string[];
  category?: string;
  color?: string;
  highlight_color?: string;
  page_number?: number;
  pageNumber?: number;
  html_content?: string;
  htmlContent?: string;
  source_url?: string;
  sourceUrl?: string;
  selection_context?: unknown;
  selectionContext?: unknown;
  max_disclosure_level?: number;
  maxDisclosureLevel?: number;
};

interface ExtractState {
  extracts: any[];
  extractsInitialized: boolean;
  isLoading: boolean;
  /** Monotonic revision number incremented on every successful reload or mutation. */
  revision: number;
  /** Last load failure message, or null when the last load succeeded (or none
   * has run yet). `loadExtracts` swallows errors (existing callers fire it and
   * forget), so surfaces like the Extracts tab read this to render an error
   * state with a retry control. */
  error: string | null;
  lastHighlightColor: string;
  /** The document id currently reflected in `extracts` (so the sync-event
   * refresh knows which document to reload). Null when no doc loaded. */
  loadedDocumentId: string | null;
  loadExtracts: (documentId?: string) => Promise<void>;
  invalidateExtracts: (documentId?: string) => Promise<void>;
  createExtract: (data: LegacyExtractData) => Promise<void>;
  updateExtract: (id: string, data: LegacyExtractData) => Promise<void>;
  deleteExtract: (id: string) => Promise<void>;
  setLastHighlightColor: (color: string) => void;
  /** Locally merge a persisted tag list into the matching extract row (no API call). */
  patchExtractTags: (id: string, tags: string[]) => void;
}

export const useExtractStore = create<ExtractState>((set, get) => ({
  extracts: [],
  extractsInitialized: false,
  isLoading: false,
  revision: 0,
  error: null,
  lastHighlightColor: "#fef08a",
  loadedDocumentId: null,

  loadExtracts: async (documentId) => {
    set({ isLoading: true, error: null });
    try {
      // Dynamic import keeps this store from eagerly pulling the full extracts
      // API (and its sync-entity re-exports) at module load on the web shell.
      const { getExtracts } = await import("../api/extracts");
      const extracts: any[] = (await getExtracts(documentId ?? null)) || [];
      set((state) => ({
        extracts,
        isLoading: false,
        extractsInitialized: true,
        loadedDocumentId: documentId ?? null,
        revision: state.revision + 1,
      }));
    } catch (error) {
      console.error("Failed to load extracts:", error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load extracts",
      });
    }
  },

  invalidateExtracts: async (documentId) => {
    const targetDocId = documentId !== undefined ? documentId : get().loadedDocumentId ?? undefined;
    await get().loadExtracts(targetDocId);
  },

  createExtract: async (data) => {
    const input: CreateExtractInput = {
      document_id: String(data.document_id ?? data.documentId ?? ""),
      content: String(data.content ?? ""),
      html_content: (data.html_content ?? data.htmlContent) as string | undefined,
      source_url: (data.source_url ?? data.sourceUrl) as string | undefined,
      note: (data.note ?? data.notes) as string | undefined,
      tags: Array.isArray(data.tags) ? data.tags : undefined,
      category: data.category as string | undefined,
      color: (data.color ?? data.highlight_color) as string | undefined,
      page_number: (data.page_number ?? data.pageNumber) as number | undefined,
      selection_context: (data.selection_context ?? data.selectionContext) as
        | CreateExtractInput["selection_context"]
        | undefined,
      max_disclosure_level: (data.max_disclosure_level ?? data.maxDisclosureLevel) as
        | number
        | undefined,
    };
    try {
      await createExtract(input);
      const docId = input.document_id || get().loadedDocumentId || undefined;
      await get().loadExtracts(docId);
    } catch (error) {
      console.error("Failed to create extract:", error);
      throw error;
    }
  },

  updateExtract: async (id, data) => {
    const input: UpdateExtractInput = {
      id,
      content: data.content as string | undefined,
      note: (data.note ?? data.notes) as string | undefined,
      tags: Array.isArray(data.tags) ? data.tags : undefined,
      category: data.category as string | undefined,
      color: (data.color ?? data.highlight_color) as string | undefined,
      max_disclosure_level: (data.max_disclosure_level ?? data.maxDisclosureLevel) as
        | number
        | undefined,
    };
    try {
      await updateExtract(input);
      await get().loadExtracts(get().loadedDocumentId ?? undefined);
    } catch (error) {
      console.error("Failed to update extract:", error);
      throw error;
    }
  },

  deleteExtract: async (id) => {
    try {
      await deleteExtract(id);
      await get().loadExtracts(get().loadedDocumentId ?? undefined);
    } catch (error) {
      console.error("Failed to delete extract:", error);
      throw error;
    }
  },

  patchExtractTags: (id, tags) => {
    set((state) => ({
      extracts: state.extracts.map((extract) =>
        extract && extract.id === id ? { ...extract, tags } : extract
      ),
    }));
  },

  setLastHighlightColor: (color) => set({ lastHighlightColor: color }),
}));
