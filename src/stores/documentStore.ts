import { create } from "zustand";
import { Document, Extract } from "../types";
import * as documentsApi from "../api/documents";
import * as segmentationApi from "../api/segmentation";
import { isKindleClippingsFilename } from "../utils/kindleClippingsImport";
import { openKindleImportDialog } from "./kindleImportDialogStore";

import { useSettingsStore } from "./settingsStore";
import { useCollectionStore } from "./collectionStore";
import { importFromUrl as importFromUrlUtil, importFromArxiv as importFromArxivUtil } from "../utils/documentImport";
import { importArticle } from "../utils/articleImport/importPipeline";
import type { ArticleImportOutcome } from "../utils/articleImport/importPipeline";
import { importRawFallbackPage } from "../utils/articleImport/rawFallback";
import { ArticleImportError } from "../utils/articleImport/errors";
import { normalizeArticleUrl } from "../utils/articleImport/urlNormalizer";
import { EXTRACTOR_VERSION, SNAPSHOT_MAX_AGE_DAYS } from "../utils/articleImport/extractor-config";
import type { WebArticleProvenance } from "../types/document";
import { resolveImportCategory } from "../utils/importCategory";
import { listen, isTauri, isNativeMobile } from "../lib/tauri";
import { useToastStore, ToastType } from "../components/common/Toast";
import { emitFeedback } from "../lib/feedback";
import { enrichAudiobookDocument, isAudiobookFile } from "../api/audiobooks";
import { parseThreadError } from "../lib/xthreadError";
import { extractXStatusId } from "../lib/xthreadUrl";

// ──────────────────────────────────────────────────────────────────────────
// Web Article Import Pipeline support (overhaul-web-article-import)
// ──────────────────────────────────────────────────────────────────────────

/** In-flight URL imports keyed by normalized URL so rapid re-shares coalesce
 *  instead of racing to create duplicate documents. */
const inflightUrlImports = new Map<string, Promise<Document>>();

/** One snapshot-retention sweep per session (180-day cap). */
let snapshotRetentionSwept = false;

/**
 * In-memory `root_id → TwitterThread` cache (30 min TTL) for X threads, so
 * revisits of the same thread (or its mid-thread URLs) never re-hit
 * ThreadReaderApp/X. Enrichment is fired once per fresh open per session.
 */
const threadCache = new Map<string, { thread: import("../types/document").TwitterThread; fetchedAt: number }>();
const THREAD_CACHE_TTL_MS = 30 * 60 * 1000;

function cachedThread(rootId: string): import("../types/document").TwitterThread | null {
  const entry = threadCache.get(rootId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > THREAD_CACHE_TTL_MS) {
    threadCache.delete(rootId);
    return null;
  }
  return entry.thread;
}

function cacheThread(thread: import("../types/document").TwitterThread): void {
  if (thread?.rootId) {
    threadCache.set(thread.rootId, { thread, fetchedAt: Date.now() });
  }
}

/** Test-only: clear the X thread cache between tests. */
export function __clearThreadCacheForTests(): void {
  threadCache.clear();
}

/**
 * Merge an enriched thread into the stored document's `metadata.xThread`
 * (zustand set; no refetch — enrichment is a background upgrade).
 */
function mergeEnrichedThread(targetId: string, enriched: import("../types/document").TwitterThread): void {
  const { currentDocument } = useDocumentStore.getState();
  useDocumentStore.setState((state) => ({
    documents: state.documents.map((d) =>
      d.id === targetId && d.metadata
        ? { ...d, metadata: { ...d.metadata, xThread: enriched } }
        : d
    ),
    currentDocument:
      currentDocument?.id === targetId && currentDocument.metadata
        ? { ...currentDocument, metadata: { ...currentDocument.metadata, xThread: enriched } }
        : currentDocument,
  }));
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

/** True when the URL points at a direct file (legacy non-article path). */
function isDirectFileUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\.(pdf|epub|md|markdown|txt|html?)$/i.test(path);
  } catch {
    return false;
  }
}

/** Persist a pipeline (or raw-fallback) article outcome as an Incrementum
 *  document: create → snapshot → single web-article UPDATE (content +
 *  metadata + canonical source_url + cover) → tags/category/priority. */
async function persistWebArticleOutcome(
  outcome: ArticleImportOutcome,
  options: { extraTags?: string[]; rawFallback?: boolean } = {}
): Promise<Document> {
  const { article, diagnostics } = outcome;
  const hostname = hostnameOf(outcome.canonicalUrl);
  const now = new Date().toISOString();

  const provenance: WebArticleProvenance = {
    originalUrl: diagnostics.originalUrl,
    canonicalUrl: outcome.canonicalUrl,
    resolvedUrl: outcome.resolvedUrl,
    extractor: options.rawFallback
      ? "raw-fallback"
      : (diagnostics.selected?.engine ?? "unknown"),
    extractionScore: options.rawFallback ? 0 : (diagnostics.selected?.score ?? 0),
    extractionConfidence: options.rawFallback ? "low" : (diagnostics.selected?.confidence ?? "low"),
    extractionVersion: EXTRACTOR_VERSION,
    importedAt: now,
    renderedFallbackUsed: diagnostics.renderedFallbackUsed,
    renderFallbackReason: diagnostics.renderedFallbackReason,
    failureReason: diagnostics.failureReason,
    candidates: diagnostics.candidates,
    diagnostics: {
      originalUrl: diagnostics.originalUrl,
      canonicalUrl: diagnostics.canonicalUrl,
      resolvedUrl: diagnostics.resolvedUrl,
      fetch: diagnostics.fetch,
      candidates: diagnostics.candidates,
      selected: diagnostics.selected,
      renderedFallbackUsed: diagnostics.renderedFallbackUsed,
      renderedFallbackReason: diagnostics.renderedFallbackReason,
      normalizationWarnings: diagnostics.normalizationWarnings,
      sanitization: diagnostics.sanitization,
      finalTextChars: diagnostics.finalTextChars,
      finalImageCount: diagnostics.finalImageCount,
      timings: diagnostics.timings,
      failureReason: diagnostics.failureReason,
    },
  };

  const collectionId = useCollectionStore.getState().activeCollectionId;
  const doc = await documentsApi.createDocument(
    article.title || `Web Content - ${hostname}`,
    outcome.canonicalUrl,
    "html",
    collectionId
  );

  // Raw-source snapshot (retention setting; skip silently off-platform).
  const keepRaw = useSettingsStore.getState().settings.documents.webImportKeepRawSource;
  if (keepRaw && outcome.rawFilePath) {
    try {
      const snapshot = await documentsApi.storeSourceSnapshot(doc.id, outcome.rawFilePath);
      if (snapshot?.stored && snapshot.path && snapshot.sha256) {
        provenance.sourceSnapshot = {
          path: snapshot.path,
          sha256: snapshot.sha256,
          rawBytes: snapshot.rawBytes ?? 0,
          gzipBytes: snapshot.gzipBytes ?? 0,
        };
      } else if (snapshot?.skippedReason) {
        diagnostics.normalizationWarnings.push(`snapshot skipped: ${snapshot.skippedReason}`);
      }
    } catch (e) {
      console.warn("[documentStore] source snapshot failed (non-fatal)", e);
    }
  }

  const metadata = {
    source: diagnostics.originalUrl,
    fetchedAt: now,
    language: article.language ?? "en",
    author: article.byline,
    siteName: article.siteName ?? hostname,
    image: article.heroImage,
    fetchMethod: "direct" as const,
    wordCount: article.stats.words,
    readingTime: Math.ceil(article.stats.words / 250),
    webArticle: provenance,
  };

  const updated = await documentsApi.updateWebArticle(
    doc.id,
    article.contentHtml,
    metadata,
    outcome.canonicalUrl,
    article.heroImage
  );

  const tags = Array.from(
    new Set(["web-import", ...(hostname && hostname !== "web" ? [hostname] : []), ...(options.extraTags ?? [])])
  );
  const finalDoc = await documentsApi.updateDocument(updated.id, {
    ...updated,
    tags,
    category: "Web Import",
    prioritySlider: 50,
    priorityScore: 5,
  } as Document);

  return finalDoc;
}


/**
 * Apply the user's default-category setting to a freshly imported document
 * when it arrived without a category. Generic file imports (drag-and-drop,
 * folder import) enter with no category; this gives them a home. Source-specific
 * imports already carry a category and are left untouched. Mutates `doc` in
 * place so callers continue to work with the same reference. Best-effort: a
 * failure to persist the category does not fail the import.
 */
async function applyDefaultCategoryIfNeeded(doc: Document): Promise<void> {
  const desired = resolveImportCategory(doc.category);
  if (!desired || desired === doc.category) return;
  try {
    const updated = await documentsApi.updateDocument(doc.id, {
      ...doc,
      category: desired,
    } as Document);
    Object.assign(doc, updated);
  } catch (e) {
    console.warn("[documentStore] failed to apply default category on import", e);
  }
}

/**
 * Library queries intentionally return lightweight summaries with the large
 * content fields set to null. Preserve a document body that this client has
 * already hydrated when a later library refresh brings that summary back.
 */
function mergeDocumentSummary(existing: Document | undefined, summary: Document): Document {
  if (!existing) return summary;
  return {
    ...existing,
    ...summary,
    content: summary.content ?? existing.content,
    contentHash: summary.contentHash ?? existing.contentHash,
    metadata: summary.metadata ?? existing.metadata,
  };
}

/**
 * Mobile file picker: uses the WebView's <input type=file>, which Android/iOS
 * route to the native system file chooser (SAF / document picker). Returns the
 * chosen File objects so their bytes can be sent to import_document_from_bytes.
 * Resolves null if the user cancels.
 */
function pickMobileFiles(options?: { multiple?: boolean }): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options?.multiple ?? false;
    // Accept all supported document/audio/video types. Android's Storage Access
    // Framework (the WebView <input type=file> backend) matches `accept` against
    // MIME types, not just extensions, so omitting audio/video MIMEs here makes
    // audiobook (.m4b/.mp3/...) files appear greyed out / unselectable. Keep this
    // list in sync with DEFAULT_EXTENSIONS in
    // src-tauri/plugins/folder-import/src/lib.rs and FileType in document.rs.
    input.accept = [
      // documents
      ".pdf", ".epub", ".md", ".markdown", ".html", ".htm", ".txt", ".json",
      "application/pdf", "application/epub+zip", "text/plain", "text/markdown", "text/html", "application/json",
      // audio (incl. audiobooks)
      ".mp3", ".wav", ".m4a", ".m4b", ".aac", ".ogg", ".flac", ".opus", ".wma",
      "audio/*",
      // video
      ".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v",
      "video/*",
    ].join(",");

    let settled = false;
    const done = (val: File[] | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        done(Array.from(input.files));
      } else {
        done(null);
      }
    };

    // Some WebViews don't fire a cancel event; focus-leaving without a change
    // is treated as cancel after a short delay.
    input.click();
    window.setTimeout(() => {
      if (!settled && (!input.files || input.files.length === 0)) {
        // Only resolve-as-cancel if the input never received a selection.
        // (We can't reliably detect cancel, so this is best-effort.)
      }
    }, 60000);
  });
}

interface DocumentState {
  // Data
  documents: Document[];
  currentDocument: Document | null;
  extracts: Extract[];
  currentExtract: Extract | null;

  // UI State
  isLoading: boolean;
  isSaving: boolean;
  isImporting: boolean;
  isSegmenting: boolean;
  importProgress: {
    current: number;
    total: number;
    fileName?: string;
  };
  error: string | null;
  searchQuery: string;

  // Optimistic state tracking
  pendingDeletions: Set<string>;
  pendingUpdates: Map<string, Partial<Document>>;

  // Pagination
  currentPage: number;
  totalPages: number;

  // Actions
  loadDocuments: () => Promise<void>;
  hydrateStartupDocuments: (documents: Document[]) => void;
  hydrateDocument: (id: string) => Promise<Document | null>;
  loadDocumentsPage: (page?: number, append?: boolean) => Promise<void>;
  setDocuments: (documents: Document[]) => void;
  setCurrentDocument: (document: Document | null) => void;
  addDocument: (document: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
  patchExtractCount: (documentId: string, delta: 1 | -1) => void;
  updateDocumentOptimistic: (id: string, updates: Partial<Document>) => Promise<{ success: boolean; error?: Error }>;
  deleteDocument: (id: string) => Promise<void>;
  deleteDocumentOptimistic: (id: string) => Promise<{ success: boolean; error?: Error; rollback?: () => void }>;
  rollbackDocumentDeletion: (id: string, document: Document) => void;
  bulkDelete: (ids: string[]) => Promise<{ succeeded: string[]; failed: string[]; errors: string[] }>;
  importFromFile: (filePath: string) => Promise<Document>;
  importFromFiles: (filePaths: string[]) => Promise<Document[]>;
  /**
   * Private escape-hatch around the Kindle-detection routing in
   * {@link importFromFile} / {@link importFromFiles}. Used by the Kindle
   * dialog's "Import as plain text" fallback so the fallback doesn't re-fire
   * the filename sniff and recurse. Not intended for external callers.
   */
  importGenericFile: (filePath: string) => Promise<Document>;
  importGenericFiles: (filePaths: string[]) => Promise<Document[]>;
  importFromFolder: () => Promise<Document[]>;
  importFromUrl: (
    url: string,
    options?: {
      /** Abort the pipeline (dialog cancel / superseded share). */
      signal?: AbortSignal;
      /** Pipeline progress events for UI states. */
      onProgress?: (progress: { stage: string; detail?: string }) => void;
    }
  ) => Promise<Document>;
  /**
   * "Import full page anyway" escape hatch (dialog): stores the sanitized
   * full page as extractor `raw-fallback` with a visible inc-raw-notice.
   */
  importRawPageFromUrl: (
    url: string,
    options?: { signal?: AbortSignal; extraTags?: string[] }
  ) => Promise<Document>;
  /** Open and parse an X/Twitter post or thread directly into reader. */
  openTwitterThread: (url: string) => Promise<Document>;
  /** Permanently import an X/Twitter post or thread to database. */
  importTwitterThread: (url: string, collectionId?: string) => Promise<Document>;
  /** Delete every stored raw-source snapshot (retention setting off). */
  deleteAllSourceSnapshots: () => Promise<number>;
  importFromArxiv: (arxivIdOrUrl: string, format?: 'pdf' | 'html') => Promise<Document>;
  openFilePickerAndImport: () => Promise<Document[]>;
  segmentDocument: (documentId: string, fileType?: string) => Promise<number>;
  setExtracts: (extracts: Extract[]) => void;
  setCurrentExtract: (extract: Extract | null) => void;
  addExtract: (extract: Extract) => void;
  updateExtract: (id: string, updates: Partial<Extract>) => void;
  deleteExtract: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setImporting: (importing: boolean) => void;
  setImportProgress: (current: number, total: number, fileName?: string) => void;
  setError: (error: string | null) => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  // Initial State
  documents: [],
  currentDocument: null,
  extracts: [],
  currentExtract: null,
  isLoading: false,
  isSaving: false,
  isImporting: false,
  isSegmenting: false,
  importProgress: { current: 0, total: 0 },
  error: null,
  searchQuery: "",
  currentPage: 1,
  totalPages: 1,
  pendingDeletions: new Set(),
  pendingUpdates: new Map(),

  // Actions
  loadDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const docs = await documentsApi.getDocuments(collectionId);
      // If the active collection changed while this fetch was in flight, a
      // newer loadDocuments() call (from that switch) is already authoritative
      // for the current scope. Applying this stale response would re-merge
      // documents from a collection the user has since switched away from —
      // e.g. switching to collection B then quickly back to A could otherwise
      // have B's now-stale fetch land after A's and blend B's docs back in.
      if (useCollectionStore.getState().activeCollectionId !== collectionId) {
        set({ isLoading: false });
        return;
      }
      set((state) => {
        // This fetch is authoritative for its scope (the stale-response check
        // above already discarded it if a newer switch superseded it), so
        // replace the list outright rather than merging — a scoped fetch
        // must not leave a previous collection's documents lingering.
        // Existing entries are still consulted so in-progress content/
        // metadata hydration for a doc isn't clobbered by a lighter summary.
        const existingById = new Map(state.documents.map((doc) => [doc.id, doc]));
        const mergedDocs = docs.map((summary) =>
          mergeDocumentSummary(existingById.get(summary.id), summary)
        );
        return { documents: mergedDocs, isLoading: false };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load documents",
        isLoading: false,
      });
    }
  },

  hydrateStartupDocuments: (documents) => {
    set({ documents, isLoading: false, error: null });
    // File manifests and local binary registration can be large on mobile;
    // the first render only needs the metadata projection above.
  },

  hydrateDocument: async (id) => {
    const hydrated = await documentsApi.getDocument(id);
    if (!hydrated) return null;

    set((state) => {
      const existingIndex = state.documents.findIndex((doc) => doc.id === id);
      const documents = existingIndex === -1
        ? [...state.documents, hydrated]
        : state.documents.map((doc) => doc.id === id ? { ...doc, ...hydrated } : doc);
      return {
        documents,
        // A response for a background or previously active document may warm
        // the cache, but must never replace a different active document.
        currentDocument: state.currentDocument?.id === id
          ? { ...state.currentDocument, ...hydrated }
          : state.currentDocument,
      };
    });

    return hydrated;
  },

  loadDocumentsPage: async (page = 1, append = false) => {
    set({ isLoading: true, error: null });
    try {
      const requestCollectionId = useCollectionStore.getState().activeCollectionId;
      const { getStartupSnapshot } = await import("../api/startup");
      const snapshot = await getStartupSnapshot({
        surface: "dashboard",
        includeQueue: false,
        documentOffset: Math.max(0, page - 1) * 50,
      });
      if (useCollectionStore.getState().activeCollectionId !== snapshot.activeCollectionId ||
          requestCollectionId !== snapshot.activeCollectionId) {
        set({ isLoading: false });
        return;
      }
      const cachedDocuments = get().documents;
      const cachedById = new Map(cachedDocuments.map((doc) => [doc.id, doc]));
      const mergedPage = snapshot.documents.items.map((summary) =>
        mergeDocumentSummary(cachedById.get(summary.id), summary)
      );
      const pageIds = new Set(snapshot.documents.items.map((summary) => summary.id));
      const nextDocuments = append
        ? [
            ...cachedDocuments.filter((doc) => !pageIds.has(doc.id)),
            ...mergedPage,
          ]
        : mergedPage;
      set({
        documents: nextDocuments,
        isLoading: false,
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(snapshot.documents.total / 50)),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load document page",
        isLoading: false,
      });
    }
  },

  setDocuments: (documents) => set({ documents }),

  setCurrentDocument: (document) =>
    set({
      currentDocument: document,
      currentPage: document?.currentPage || 1,
      totalPages: document?.totalPages || 1,
    }),

  addDocument: (document) =>
    set((state) => {
      return { documents: [...state.documents, document] };
    }),

  updateDocument: (id, updates) =>
    set((state) => {
      // Only stamp dateModified if the caller didn't provide one explicitly.
      // Blindly overwriting it on every update breaks sort stability:
      // cover resolution → new dateModified → sort changes → re-render loop.
      const shouldStampDate = !('dateModified' in updates);
      const resolvedUpdates = shouldStampDate
        ? { ...updates, dateModified: new Date().toISOString() }
        : updates;
      return {
        documents: state.documents.map((doc) =>
          doc.id === id ? { ...doc, ...resolvedUpdates } : doc
        ),
        currentDocument:
          state.currentDocument?.id === id
            ? { ...state.currentDocument, ...resolvedUpdates }
            : state.currentDocument,
      };
    }),

  patchExtractCount: (documentId, delta) =>
    set((state) => {
      const patch = (doc: Document) =>
        doc.id === documentId
          ? { ...doc, extractCount: Math.max(0, (doc.extractCount ?? 0) + delta) }
          : doc;
      return {
        documents: state.documents.map(patch),
        currentDocument: state.currentDocument ? patch(state.currentDocument) : null,
      };
    }),

  deleteDocument: async (id) => {
    await documentsApi.deleteDocument(id);
    set((state) => ({
      documents: state.documents.filter((doc) => doc.id !== id),
      currentDocument: state.currentDocument?.id === id ? null : state.currentDocument,
    }));
  },

  /**
   * Optimistic delete - removes from UI immediately, rolls back on failure
   */
  deleteDocumentOptimistic: async (id) => {
    // Capture the document for potential rollback
    const docToDelete = get().documents.find((doc) => doc.id === id);
    if (!docToDelete) {
      return { success: false, error: new Error('Document not found') };
    }

    // Optimistically remove from UI
    set((state) => ({
      documents: state.documents.filter((doc) => doc.id !== id),
      currentDocument: state.currentDocument?.id === id ? null : state.currentDocument,
      pendingDeletions: new Set(state.pendingDeletions).add(id),
    }));

    try {
      await documentsApi.deleteDocument(id);

      set((state) => {
        const newPending = new Set(state.pendingDeletions);
        newPending.delete(id);
        return { pendingDeletions: newPending };
      });

  
      return { success: true };
    } catch (error) {
      // Rollback on failure
      set((state) => {
        const newPending = new Set(state.pendingDeletions);
        newPending.delete(id);
        return {
          documents: [...state.documents, docToDelete],
          pendingDeletions: newPending,
        };
      });

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        rollback: () => {
          set((state) => ({
            documents: [...state.documents, docToDelete],
          }));
        },
      };
    }
  },

  /**
   * Rollback a document deletion
   */
  rollbackDocumentDeletion: (id, document) => {
    set((state) => ({
      documents: [...state.documents, document],
      pendingDeletions: (() => {
        const newPending = new Set(state.pendingDeletions);
        newPending.delete(id);
        return newPending;
      })(),
    }));
  },

  /**
   * Bulk delete multiple documents in a single batched call.
   * Removes all successfully-deleted ids from state and clears
   * currentDocument if it was among them. Failed ids are retained so
   * the UI can surface them. Returns the backend's result summary.
   */
  bulkDelete: async (ids) => {
      if (ids.length === 0) {
        return { succeeded: [], failed: [], errors: [] };
      }
      const result = await documentsApi.bulkDeleteDocuments(ids);
      const removed = new Set(result.succeeded);
      set((state) => ({
        documents: state.documents.filter((doc) => !removed.has(doc.id)),
        currentDocument:
          state.currentDocument && removed.has(state.currentDocument.id)
            ? null
            : state.currentDocument,
      }));
      for (const id of result.succeeded) {
          }
      return result;
    },

  /**
   * Optimistic update - applies changes immediately, rolls back on failure
   */
  updateDocumentOptimistic: async (id, updates) => {
    // Capture current state for rollback
    const currentDoc = get().documents.find((doc) => doc.id === id);
    if (!currentDoc) {
      return { success: false, error: new Error('Document not found') };
    }

    const originalDoc = { ...currentDoc };

    // Only stamp dateModified if the caller didn't provide one explicitly.
    const shouldStampDate = !('dateModified' in updates);
    const resolvedUpdates = shouldStampDate
      ? { ...updates, dateModified: new Date().toISOString() }
      : updates;

    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, ...resolvedUpdates } : doc
      ),
      currentDocument:
        state.currentDocument?.id === id
          ? { ...state.currentDocument, ...resolvedUpdates }
          : state.currentDocument,
      pendingUpdates: new Map(state.pendingUpdates).set(id, updates),
    }));

    try {
      await documentsApi.updateDocument(id, { ...currentDoc, ...updates } as Document);

      set((state) => {
        const newPending = new Map(state.pendingUpdates);
        newPending.delete(id);
        return { pendingUpdates: newPending };
      });

      return { success: true };
    } catch (error) {
      // Rollback on failure
      set((state) => ({
        documents: state.documents.map((doc) =>
          doc.id === id ? originalDoc : doc
        ),
        currentDocument:
          state.currentDocument?.id === id ? originalDoc : state.currentDocument,
        pendingUpdates: (() => {
          const newPending = new Map(state.pendingUpdates);
          newPending.delete(id);
          return newPending;
        })(),
      }));

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  importFromFile: async (filePath) => {
    // Route Kindle clippings files to the dedicated dialog (see importFromFiles
    // for the rationale). The fallback the dialog triggers re-enters via the
    // private `importGenericFile` helper below so it bypasses detection
    // (otherwise the filename sniff would re-fire and we'd recurse forever).
    if (isKindleClippingsFilename(filePath)) {
      openKindleImportDialog(filePath, {
        onFallbackToGenericImport: (fallbackPath) => {
          void get()
            .importGenericFile(fallbackPath)
            .catch((e) => {
              console.warn("[documentStore] plain-text fallback import failed", e);
            });
        },
      });
      throw new Error("KINDLE_DIALOG_OPENED");
    }
    return get().importGenericFile(filePath);
  },

  // Private generic single-doc import (no Kindle detection). Exposed on the
  // store object so the dialog fallback can call it via `get()` without
  // duplicating the body. Not part of the public DocumentStore interface.
  importGenericFile: async (filePath) => {
    set({ isImporting: true, error: null });
    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const doc = await documentsApi.importDocument(filePath, collectionId);
      await applyDefaultCategoryIfNeeded(doc);

      set((state) => ({
        documents: [...state.documents, doc],
        isImporting: false,
      }));

      // Auto-segment if enabled
      const settings = useSettingsStore.getState().settings;
      if (settings.documents.autoProcessOnImport) {
        await get().segmentDocument(doc.id, doc.fileType);
      }

      return doc;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to import document",
        isImporting: false,
      });
      throw error;
    }
  },

  importFromFiles: async (filePaths) => {
    // Partition Kindle clippings files out of the generic import loop. A
    // dropped/picked `My Clippings.txt` is a multi-document source that the
    // generic single-doc pipeline can't represent — and historically it got
    // stored as an unreadable `.txt` blob. Route each Kindle file to the
    // dedicated preview/import dialog instead. The fallback hook hands the
    // file back to the generic loop (via importGenericFiles) if the content
    // sniff says "not Kindle".
    const kindlePaths: string[] = [];
    const otherPaths: string[] = [];
    for (const p of filePaths) {
      if (isKindleClippingsFilename(p)) kindlePaths.push(p);
      else otherPaths.push(p);
    }
    for (const kp of kindlePaths) {
      openKindleImportDialog(kp, {
        onFallbackToGenericImport: (fallbackPath) => {
          // Fire-and-forget — the dialog has already closed at this point.
          // Use the detection-bypassing helper so the filename sniff doesn't
          // re-fire and recurse.
          void get().importGenericFiles([fallbackPath]).catch((e) => {
            console.warn("[documentStore] plain-text fallback import failed", e);
          });
        },
      });
    }
    // If every incoming file was Kindle, the dialog takes over and there's
    // nothing for the generic loop to do. Bail out without flipping import
    // state (avoids a spurious "no documents could be imported" toast).
    if (otherPaths.length === 0) {
      return [];
    }
    return get().importGenericFiles(otherPaths);
  },

  // Private generic multi-doc import (no Kindle detection). See importGenericFile.
  importGenericFiles: async (filePaths) => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: filePaths.length } });
    const imported: Document[] = [];
    const settings = useSettingsStore.getState().settings;
    const autoSegment = settings.documents.autoProcessOnImport;
    const collectionId = useCollectionStore.getState().activeCollectionId;
    let totalExtracts = 0;
    let lastProgressAt = 0;

    const shouldUpdateProgress = () => {
      const now = Date.now();
      if (now - lastProgressAt > 120) {
        lastProgressAt = now;
        return true;
      }
      return false;
    };

    try {
      if (autoSegment) set({ isSegmenting: true });
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = filePath.split('/').pop() || filePath;

        if (i === 0 || shouldUpdateProgress()) {
          set({ importProgress: { current: i, total: filePaths.length, fileName } });
        }

        try {
          const doc = await documentsApi.importDocument(filePath, collectionId);
          await applyDefaultCategoryIfNeeded(doc);

          imported.push(doc);

          if (autoSegment) {
            const count = await get().segmentDocument(doc.id, doc.fileType);
            totalExtracts += count;
          }

          if (isAudiobookFile(fileName)) {
            void enrichAudiobookDocument(doc, fileName).catch(() => {});
          }
        } catch (error) {
          console.error(`Failed to import ${fileName}:`, error);
        }

        if (i === filePaths.length - 1 || shouldUpdateProgress()) {
          set({ importProgress: { current: i + 1, total: filePaths.length, fileName } });
        }
      }
      if (autoSegment) set({ isSegmenting: false });

      set((state) => ({
        documents: [...state.documents, ...imported],
        isImporting: false,
        isSegmenting: false,
        importProgress: { current: imported.length, total: filePaths.length }
      }));

      if (imported.length > 0) {
        const message = autoSegment && totalExtracts > 0
          ? `${imported.length} document${imported.length !== 1 ? "s" : ""} imported, ${totalExtracts} extract${totalExtracts !== 1 ? "s" : ""} created`
          : `${imported.length} document${imported.length !== 1 ? "s" : ""} imported`;
        void emitFeedback("import.completed", {
          documentCount: imported.length,
          extractCount: totalExtracts,
          title: "Import complete",
          message,
        });
      } else if (filePaths.length > 0) {
        void emitFeedback("import.failed", {
          title: "Import failed",
          message: "No documents could be imported.",
        });
      }

      return imported;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to import documents",
        isImporting: false,
        isSegmenting: false,
        importProgress: { current: 0, total: 0 }
      });
      throw error;
    }
  },

  importFromFolder: async () => {
    // Let the user pick a folder; the plugin returns every supported file
    // inside it (recursively, incl. subdirectories). On mobile the files are
    // staged into app-private storage so their paths are readable by the
    // path-based import pipeline below.
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 0 } });
    try {
      const staged = await documentsApi.pickFolderDocuments();
      if (staged.length === 0) {
        set({ isImporting: false, importProgress: { current: 0, total: 0 } });
        void emitFeedback("import.completed", {
          documentCount: 0,
          extractCount: 0,
          title: "No files found",
          message: "The selected folder has no supported documents, or the import was cancelled.",
        });
        return [];
      }
      // Reuse the existing multi-file import loop (handles per-file progress,
      // auto-segmentation, and the final toast summary).
      const paths = staged.map((f) => f.path);
      return await get().importFromFiles(paths);
    } catch (error) {
      void emitFeedback("import.failed", {
        title: "Failed to import documents",
        message: error instanceof Error ? error.message : "Failed to import documents",
      });
      set({
        error: error instanceof Error ? error.message : "Failed to import folder",
        isImporting: false,
        importProgress: { current: 0, total: 0 },
      });
      throw error;
    }
  },

  openFilePickerAndImport: async () => {
    // On native Android/iOS, use the native fast-copy picker (pickFilesMobile)
    // which copies chosen files to internal storage natively, bypassing the
    // slow JSON IPC byte transfer.
    if (isNativeMobile()) {
      const staged = await documentsApi.pickFilesMobile({
        multiple: true,
        extensions: undefined
      });
      if (!staged || staged.length === 0) return [];
      
      const paths = staged.map((f) => f.path);
      return await get().importFromFiles(paths);
    }

    const filePaths = await documentsApi.openFilePicker({ multiple: true });
    if (!filePaths || filePaths.length === 0) {
      return [];
    }
    return get().importFromFiles(filePaths);
  },

  segmentDocument: async (documentId: string, fileType?: string) => {
    const settings = useSettingsStore.getState().settings;
    const { segmentation } = settings.documents;
    const toast = useToastStore.getState();

    set({ isSegmenting: true });

    try {
      const config: segmentationApi.SegmentationConfig = {
        method: segmentation.method,
        targetLength: segmentation.targetLength,
        overlap: segmentation.overlap,
      };

      const extractIds = await segmentationApi.autoSegmentAndCreateExtracts(documentId, config);

      toast.addToast({
        type: ToastType.Success,
        title: "Segmentation complete",
        message: `${extractIds.length} extract${extractIds.length !== 1 ? "s" : ""} created`,
      });

      await get().loadDocuments();
      return extractIds.length;
    } catch (error) {
      console.error("[segmentDocument] Failed:", error);
      toast.addToast({
        type: ToastType.Error,
        title: "Segmentation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return 0;
    } finally {
      set({ isSegmenting: false });
    }
  },

  importFromUrl: async (url, options) => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 1, fileName: `Fetching ${url}...` } });

    // Direct-file URLs (pdf/epub/md/txt/html files) keep the legacy
    // non-article path; everything else runs the Web Article Import Pipeline.
    if (isDirectFileUrl(url)) {
      try {
        const docData = await importFromUrlUtil(url, { preserveImages: true });

        const collectionId = useCollectionStore.getState().activeCollectionId;
        const doc = await documentsApi.createDocument(
          docData.title,
          docData.filePath,
          docData.fileType,
          collectionId
        );

        const fullUpdate: Partial<Document> = {
          content: docData.content,
          tags: docData.tags,
          category: docData.category,
          metadata: docData.metadata,
          priorityRating: docData.priorityRating,
          prioritySlider: docData.prioritySlider,
          priorityScore: docData.priorityScore,
          nextReadingDate: docData.nextReadingDate,
          stability: docData.stability,
          difficulty: docData.difficulty,
          reps: docData.reps,
          totalTimeSpent: docData.totalTimeSpent,
        };

        if (docData.content && docData.content.trim().length > 0) {
          try {
            const updatedContentDoc = await documentsApi.updateDocumentContent(doc.id, docData.content);
            Object.assign(doc, updatedContentDoc);
          } catch (contentError) {
            console.warn("[DocumentStore] Failed to persist document content:", contentError);
          }
        }

        try {
          const updatedDoc = await documentsApi.updateDocument(doc.id, fullUpdate as Document);
          Object.assign(doc, updatedDoc);
        } catch (updateError) {
          console.warn('[DocumentStore] Failed to update document fully:', updateError);
        }

        set((state) => ({
          documents: [...state.documents, doc],
          isImporting: false,
          importProgress: { current: 1, total: 1, fileName: docData.title }
        }));

        return doc;
      } catch (error) {
        console.error('[DocumentStore] Direct-file import failed:', error);
        set({
          error: error instanceof Error ? error.message : 'Failed to import from URL',
          isImporting: false,
          importProgress: { current: 0, total: 0 }
        });
        throw error;
      }
    }

    // ── Article pipeline path ────────────────────────────────────────────
    const normalized = normalizeArticleUrl(url);
    const dedupeKey = normalized.valid ? normalized.normalized : url;

    // Coalesce rapid re-shares of the same URL into one import.
    const inflight = inflightUrlImports.get(dedupeKey);
    if (inflight) {
      return inflight;
    }

    // Canonical-URL dedupe: surface the existing document instead of a dupe.
    const surfaceExisting = async (): Promise<Document | null> => {
      try {
        const existingId = await documentsApi.findDocumentIdBySourceUrl(dedupeKey);
        if (existingId) {
          const existing = await documentsApi.getDocument(existingId);
          if (existing) return existing;
        }
      } catch (e) {
        console.warn("[DocumentStore] dedupe lookup failed (non-fatal)", e);
      }
      return null;
    };

    // Register the in-flight promise BEFORE any await so a rapid re-share
    // coalesces even while the pre-create dedupe lookup is still running.
    const promise = (async (): Promise<Document> => {
      const preExisting = await surfaceExisting();
      if (preExisting) {
        set({ isImporting: false, importProgress: { current: 1, total: 1, fileName: preExisting.title } });
        return preExisting;
      }

      // Session-lazy snapshot retention sweep (180 days).
      if (!snapshotRetentionSwept && isTauri()) {
        snapshotRetentionSwept = true;
        void documentsApi
          .cleanupSourceSnapshots(SNAPSHOT_MAX_AGE_DAYS)
          .catch((e) => console.warn("[documentStore] snapshot retention sweep failed", e));
      }

      set({ importProgress: { current: 0, total: 1, fileName: `Extracting article from ${hostnameOf(url)}...` } });
      const outcome = await importArticle(url, {
        signal: options?.signal,
        onProgress: options?.onProgress,
      });

      // Post-fetch dedupe: the canonical URL is authoritative once known.
      try {
        const canonicalId = await documentsApi.findDocumentIdBySourceUrl(outcome.canonicalUrl);
        if (canonicalId) {
          const existing = await documentsApi.getDocument(canonicalId);
          if (existing) return existing;
        }
      } catch (e) {
        console.warn("[DocumentStore] canonical dedupe lookup failed (non-fatal)", e);
      }

      const doc = await persistWebArticleOutcome(outcome);

      set((state) => ({
        documents: [...state.documents, doc],
        importProgress: { current: 1, total: 1, fileName: doc.title }
      }));
      return doc;
    })();
    inflightUrlImports.set(dedupeKey, promise);

    try {
      return await promise;
    } catch (error) {
      console.error('[DocumentStore] Article import failed:', error);
      set({
        error:
          error instanceof ArticleImportError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to import from URL',
        isImporting: false,
        importProgress: { current: 0, total: 0 }
      });
      throw error;
    } finally {
      inflightUrlImports.delete(dedupeKey);
      set({ isImporting: false });
    }
  },

  importRawPageFromUrl: async (url, options) => {
    // The explicitly-labeled "Import full page anyway" escape hatch: store
    // the sanitized full page marked extractor `raw-fallback` with a visible
    // in-document notice. Never auto-invoked by the pipeline.
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 1, fileName: `Fetching ${url}...` } });
    try {
      const outcome = await importRawFallbackPage(url, { signal: options?.signal });
      const doc = await persistWebArticleOutcome(outcome, {
        extraTags: options?.extraTags,
        rawFallback: true,
      });
      set((state) => ({
        documents: [...state.documents, doc],
        isImporting: false,
        importProgress: { current: 1, total: 1, fileName: doc.title }
      }));
      return doc;
    } catch (error) {
      console.error('[DocumentStore] Raw page import failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to import page',
        isImporting: false,
        importProgress: { current: 0, total: 0 }
      });
      throw error;
    }
  },

  openTwitterThread: async (url: string) => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 1, fileName: `Fetching X thread...` } });
    try {
      // 1. Check if document is already in store (skip stale placeholders so
      //    a failed load can be retried). The status-id detector accepts the
      //    same URL variants as the backend (www/mobile subdomains, query
      //    strings, trailing slashes, `/i/status/`).
      const statusId = extractXStatusId(url);
      const isStalePlaceholder = (d: Document) =>
        d.id.startsWith("x-thread-") && Boolean(d.metadata?.xThreadLoading || d.metadata?.xThreadError);

      const existing = get().documents.find(
        (d) =>
          !isStalePlaceholder(d) &&
          (d.filePath === url ||
            d.metadata?.source === url ||
            (statusId && (d.filePath.includes(statusId) || (d.metadata?.source && d.metadata.source.includes(statusId)))))
      );
      if (existing) {
        set({ isImporting: false, currentDocument: existing });
        return existing;
      }

      // 2. Placeholder document so the reader shows a native skeleton while
      //    the unrolled thread payload is being fetched (progressive open).
      const placeholderId = `x-thread-${statusId ?? "pending"}`;
      const placeholder: Document = {
        id: placeholderId,
        title: "X Thread",
        filePath: url,
        fileType: "html",
        content: "",
        tags: ["x", "twitter", "thread"],
        category: "X Threads",
        totalPages: 0,
        currentPage: 0,
        dateAdded: new Date().toISOString(),
        dateModified: new Date().toISOString(),
        extractCount: 0,
        learningItemCount: 0,
        priorityRating: 0,
        prioritySlider: 0,
        priorityScore: 6.0,
        isArchived: false,
        isFavorite: false,
        metadata: { source: url, siteName: "X", xThreadLoading: true },
      };
      set((state) => ({
        documents: [placeholder, ...state.documents.filter((d) => d.id !== placeholderId)],
        currentDocument: placeholder,
      }));

      // 3. Fetch thread structure — reuse the in-memory cache when this
      //    status id is itself a cached thread root (mid-thread URLs resolve
      //    their root via ping on the server and are deduped by the
      //    canonical-root document check below — the cache itself is keyed
      //    by root id, so mid-thread URLs naturally miss it).
      let thread: import("../types/document").TwitterThread;
      try {
        thread =
          (statusId ? cachedThread(statusId) : null) ?? (await documentsApi.fetchTwitterThread(url));
      } catch (fetchError) {
        // Native error state: keep the placeholder so the reader can show the
        // typed error (private/deleted, TRA down, rate limit, network) with
        // Retry / Open on X — no blank page, no white iframe fallback.
        const typed = parseThreadError(fetchError);
        set({
          isImporting: false,
          importProgress: { current: 0, total: 0 },
        });
        set((state) => ({
          documents: state.documents.map((d) =>
            d.id === placeholderId && d.metadata
              ? {
                  ...d,
                  metadata: { ...d.metadata, xThreadLoading: false, xThreadError: typed },
                }
              : d
          ),
          currentDocument: state.documents.find((d) => d.id === placeholderId) ?? null,
        }));
        return get().documents.find((d) => d.id === placeholderId) ?? placeholder;
      }

      // Check again against canonical rootUrl (dedupe across mid-thread URLs).
      // The in-flight placeholder itself is excluded — it matched only because
      // a root URL's filePath equals the canonical rootUrl.
      const existingRoot = get().documents.find(
        (d) => d.id !== placeholderId && (d.filePath === thread.rootUrl || d.metadata?.source === thread.rootUrl)
      );
      if (existingRoot) {
        set((state) => ({
          documents: state.documents.filter((d) => d.id !== placeholderId),
          currentDocument: existingRoot,
          isImporting: false,
          importProgress: { current: 1, total: 1, fileName: existingRoot.title },
        }));
        return existingRoot;
      }

      cacheThread(thread);

      let doc: Document;
      if (isTauri()) {
        try {
          const collectionId = useCollectionStore.getState().activeCollectionId;
          doc = await documentsApi.importTwitterThread(url, collectionId, thread);
        } catch (err) {
          console.warn("[DocumentStore] Failed to persist thread to DB, fallback to ephemeral doc:", err);
          doc = {
            id: `x-thread-${thread.rootId}`,
            title: thread.title,
            filePath: thread.rootUrl,
            fileType: "html",
            content: thread.structuredText,
            tags: ["x", "twitter", "thread"],
            category: "X Threads",
            totalPages: thread.totalPosts,
            currentPage: 0,
            dateAdded: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            extractCount: 0,
            learningItemCount: 0,
            priorityRating: 0,
            prioritySlider: 0,
            priorityScore: 6.0,
            isArchived: false,
            isFavorite: false,
            coverImageUrl: thread.posts.flatMap(p => p.media).find(m => m.kind === "photo")?.mediaUrl || thread.author.avatarUrl || undefined,
            coverImageSource: "twitter",
            metadata: {
              author: thread.author.name,
              source: thread.rootUrl,
              siteName: "X",
              articleHtml: thread.htmlContent,
              structuredContent: thread,
              xThread: thread,
            },
          };
        }
      } else {
        doc = {
          id: `x-thread-${thread.rootId}`,
          title: thread.title,
          filePath: thread.rootUrl,
          fileType: "html",
          content: thread.structuredText,
          tags: ["x", "twitter", "thread"],
          category: "X Threads",
          totalPages: thread.totalPosts,
          currentPage: 0,
          dateAdded: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          extractCount: 0,
          learningItemCount: 0,
          priorityRating: 0,
          prioritySlider: 0,
          priorityScore: 6.0,
          isArchived: false,
          isFavorite: false,
          coverImageUrl: thread.posts.flatMap(p => p.media).find(m => m.kind === "photo")?.mediaUrl || thread.author.avatarUrl || undefined,
          coverImageSource: "twitter",
          metadata: {
            author: thread.author.name,
            source: thread.rootUrl,
            siteName: "X",
            articleHtml: thread.htmlContent,
            structuredContent: thread,
            xThread: thread,
          },
        };
      }

      if (doc.metadata && !doc.metadata.xThread) {
        doc.metadata.xThread = thread;
      }

      set((state) => ({
        documents: [doc, ...state.documents.filter((d) => d.id !== doc.id && d.id !== placeholderId)],
        currentDocument: doc,
        isImporting: false,
        importProgress: { current: 1, total: 1, fileName: doc.title },
      }));

      // 3. Background enrichment: merge per-post X metadata (timestamps,
      //    engagement, video URLs, avatars, quotes) into the stored doc's
      //    `metadata.xThread` when it resolves. Non-blocking, non-fatal —
      //    the reader renders the unrolled data immediately.
      if (isTauri() && thread.posts.length > 0) {
        documentsApi
          .enrichTwitterThread(thread)
          .then((enriched) => {
            if (!enriched || !enriched.posts || enriched.posts.length === 0) return;
            mergeEnrichedThread(doc.id, enriched);
          })
          .catch((err) => {
            console.warn("[DocumentStore] Thread enrichment failed (non-fatal):", err);
          });
      }

      return doc;
    } catch (error) {
      console.error("[DocumentStore] Failed to open X thread:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to open X thread",
        isImporting: false,
        importProgress: { current: 0, total: 0 },
      });
      throw error;
    }
  },

  importTwitterThread: async (url: string, collectionId?: string) => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 1, fileName: `Importing X thread...` } });
    try {
      const doc = await documentsApi.importTwitterThread(url, collectionId);
      set((state) => ({
        documents: [doc, ...state.documents.filter((d) => d.id !== doc.id)],
        isImporting: false,
        importProgress: { current: 1, total: 1, fileName: doc.title },
      }));
      return doc;
    } catch (error) {
      console.error("[DocumentStore] Failed to import X thread:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to import X thread",
        isImporting: false,
        importProgress: { current: 0, total: 0 },
      });
      throw error;
    }
  },

  deleteAllSourceSnapshots: async () => {
    // Retention setting turned off: remove every existing snapshot. Articles
    // are untouched; only the re-extraction source is dropped.
    const { documents } = get();
    const ids = documents
      .map((d) => d.metadata?.webArticle?.sourceSnapshot?.path)
      .filter((p): p is string => typeof p === "string")
      .map((path) => path.split("/").pop()?.replace(/\.html\.gz$/, "") ?? "")
      .filter((id) => id.length > 0);
    if (ids.length === 0) return 0;
    try {
      return await documentsApi.deleteSourceSnapshots(ids);
    } catch (e) {
      console.warn("[documentStore] snapshot deletion failed", e);
      return 0;
    }
  },

  importFromArxiv: async (arxivIdOrUrl, format: 'pdf' | 'html' = 'pdf') => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 2, fileName: 'Fetching paper metadata...' } });

    try {
      // Use existing utility to fetch from Arxiv
      const docData = await importFromArxivUtil(arxivIdOrUrl, format);

      set({ importProgress: { current: 1, total: 2, fileName: 'Creating document...' } });

      const collectionId = useCollectionStore.getState().activeCollectionId;
      const doc = await documentsApi.createDocument(
        docData.title,
        docData.filePath,
        docData.fileType,
        collectionId
      );

      // Prepare full update with all document data
      const fullUpdate: Partial<Document> = {
        content: docData.content,
        tags: docData.tags,
        category: docData.category,
        metadata: docData.metadata,
        priorityRating: docData.priorityRating,
        prioritySlider: docData.prioritySlider,
        priorityScore: docData.priorityScore,
      };

      // Persist content separately for Tauri (update_document doesn't store content)
      if (docData.content && docData.content.trim().length > 0) {
        try {
          const updatedContentDoc = await documentsApi.updateDocumentContent(doc.id, docData.content);
          Object.assign(doc, updatedContentDoc);
        } catch (contentError) {
          console.warn("[DocumentStore] Failed to persist document content:", contentError);
        }
      }

      try {
        const updatedDoc = await documentsApi.updateDocument(doc.id, fullUpdate as Document);
        Object.assign(doc, updatedDoc);
      } catch (updateError) {
        console.warn('[DocumentStore] Failed to update document fully:', updateError);
      }

      set((state) => ({
        documents: [...state.documents, doc],
        isImporting: false,
        importProgress: { current: 2, total: 2, fileName: docData.title }
      }));

      return doc;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to import from Arxiv',
        isImporting: false,
        importProgress: { current: 0, total: 0 }
      });
      throw error;
    }
  },

  setExtracts: (extracts) => set({ extracts }),

  setCurrentExtract: (extract) => set({ currentExtract: extract }),

  addExtract: (extract) =>
    set((state) => ({
      extracts: [...state.extracts, extract],
    })),

  updateExtract: (id, updates) =>
    set((state) => {
      const shouldStampDate = !('dateModified' in updates);
      const resolvedUpdates = shouldStampDate
        ? { ...updates, dateModified: new Date().toISOString() }
        : updates;
      return {
        extracts: state.extracts.map((ext) =>
          ext.id === id ? { ...ext, ...resolvedUpdates } : ext
        ),
        currentExtract:
          state.currentExtract?.id === id
            ? { ...state.currentExtract, ...resolvedUpdates }
          : state.currentExtract,
      };
    }),

  deleteExtract: (id) =>
    set((state) => ({
      extracts: state.extracts.filter((ext) => ext.id !== id),
      currentExtract: state.currentExtract?.id === id ? null : state.currentExtract,
    })),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setCurrentPage: (currentPage) => set({ currentPage }),

  setLoading: (isLoading) => set({ isLoading }),

  setSaving: (isSaving) => set({ isSaving: isSaving }),

  setImporting: (isImporting) => set({ isImporting }),

  setImportProgress: (current, total, fileName) => set({ importProgress: { current, total, fileName } }),

  setError: (error) => set({ error }),
}));

// Listen for browser extension save events (Tauri only)
if (isTauri()) {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  listen<{ document_id: string; title: string; url: string }>(
    "browser-sync://document-saved",
    (event) => {
      const { title } = event.payload;

      useToastStore.getState().addToast({
        type: ToastType.Success,
        title: "Page saved to Plethora",
        message: title || undefined,
      });

      // Debounce document list refresh (500ms)
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        useDocumentStore.getState().loadDocuments();
        reloadTimer = null;
      }, 500);
    }
  ).catch((err) => {
    console.warn("[DocumentStore] Failed to register listener for browser-sync://document-saved:", err);
  });

}
