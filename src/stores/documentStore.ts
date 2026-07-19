import { create } from "zustand";
import { Document, Extract } from "../types";
import * as documentsApi from "../api/documents";
import * as segmentationApi from "../api/segmentation";

import { useSettingsStore } from "./settingsStore";
import { useCollectionStore } from "./collectionStore";
import { importFromUrl as importFromUrlUtil, importFromArxiv as importFromArxivUtil } from "../utils/documentImport";
import { listen, isTauri, isNativeMobile } from "../lib/tauri";
import { useToastStore, ToastType } from "../components/common/Toast";
import { emitFeedback } from "../lib/feedback";
import { enrichAudiobookDocument, isAudiobookFile } from "../api/audiobooks";
import { markSyncPhaseStart } from "../lib/sync/syncTelemetry";

let fileSyncModPromise: Promise<typeof import("../lib/fileSyncRegistration")> | null = null;
let docReplicationModPromise: Promise<typeof import("../lib/documentReplication")> | null = null;

function getFileSyncModule() {
  if (!fileSyncModPromise) fileSyncModPromise = import("../lib/fileSyncRegistration");
  return fileSyncModPromise;
}
function getDocReplicationModule() {
  if (!docReplicationModPromise) docReplicationModPromise = import("../lib/documentReplication");
  return docReplicationModPromise;
}

function registerImportedFileSyncLazy(doc: Document): Promise<string | null> {
  return getFileSyncModule().then(({ registerImportedFileSync }) => registerImportedFileSync(doc));
}

function registerExistingFilesSyncLazy(docs: Document[]): Promise<void> {
  return getFileSyncModule().then(({ registerExistingFilesSync }) => registerExistingFilesSync(docs));
}

function publishDocumentLazy(doc: Document): Promise<void> {
  return getDocReplicationModule().then(({ publishDocument }) => publishDocument(doc));
}

function deleteDocumentSyncLazy(id: string): Promise<void> {
  return getDocReplicationModule().then(({ deleteDocumentSync }) => deleteDocumentSync(id));
}

function runDeferredSyncSetup(task: () => void): void {
  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof window === "undefined") {
    setTimeout(task, 0);
    return;
  }
  const win = window as IdleWindow;
  if (typeof win.requestIdleCallback === "function") {
    win.requestIdleCallback(task, { timeout: 5000 });
  } else {
    setTimeout(task, 1500);
  }
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
  updateDocumentOptimistic: (id: string, updates: Partial<Document>) => Promise<{ success: boolean; error?: Error }>;
  deleteDocument: (id: string) => Promise<void>;
  deleteDocumentOptimistic: (id: string) => Promise<{ success: boolean; error?: Error; rollback?: () => void }>;
  rollbackDocumentDeletion: (id: string, document: Document) => void;
  bulkDelete: (ids: string[]) => Promise<{ succeeded: string[]; failed: string[]; errors: string[] }>;
  importFromFile: (filePath: string) => Promise<Document>;
  importFromFiles: (filePaths: string[]) => Promise<Document[]>;
  importFromFolder: () => Promise<Document[]>;
  importFromUrl: (url: string) => Promise<Document>;
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
      set((state) => {
        // Merge rather than replace: a concurrent loadDocuments()/loadDocumentsPage()
        // call scoped to a different collection must not wipe out documents that
        // this fetch's scope simply doesn't cover. Reconcile deletions only among
        // entries that fall within the scope we just queried.
        const fetchedIds = new Set(docs.map((d) => d.id));
        const retained = state.documents.filter((d) => {
          if (fetchedIds.has(d.id)) return false; // superseded by fresh copy below
          if (collectionId == null) return false; // full-scope fetch is authoritative
          return d.collectionId !== collectionId; // outside this fetch's scope, keep as-is
        });
        return { documents: [...retained, ...docs], isLoading: false };
      });
      void registerExistingFilesSyncLazy(docs);
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
    runDeferredSyncSetup(() => {
      const endHydration = markSyncPhaseStart("background-hydration");
      void registerExistingFilesSyncLazy(documents).finally(() => {
        endHydration({ records: documents.length, surface: "startup" });
      });
    });
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
      const nextDocuments = append ? [...get().documents, ...snapshot.documents.items] : snapshot.documents.items;
      set({
        documents: nextDocuments,
        isLoading: false,
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(snapshot.documents.total / 50)),
      });
      runDeferredSyncSetup(() => {
        void registerExistingFilesSyncLazy(snapshot.documents.items);
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

  deleteDocument: async (id) => {
    await documentsApi.deleteDocument(id);
    set((state) => ({
      documents: state.documents.filter((doc) => doc.id !== id),
      currentDocument: state.currentDocument?.id === id ? null : state.currentDocument,
    }));
    await deleteDocumentSyncLazy(id);
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

      await deleteDocumentSyncLazy(id);

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
        await deleteDocumentSyncLazy(id);
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
    set({ isImporting: true, error: null });
    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const doc = await documentsApi.importDocument(filePath, collectionId);

      // Register with sync manifest (best-effort, see importFromFiles).
      const fileId = await registerImportedFileSyncLazy(doc).catch((e) => {
        console.warn("[documentStore] file-sync registration failed", e);
        return null;
      });
      if (fileId) {
        doc.fileId = fileId;
        doc.metadata = { ...doc.metadata, fileId };
        await documentsApi.upsertSyncedDocument(doc).catch((e) => {
          console.warn("[documentStore] failed to save fileId to SQLite metadata", e);
        });
      }

      // Publish the doc row to the sync room (see importFromFiles).
      await publishDocumentLazy(doc).catch((e) => {
        console.warn("[documentStore] document publish failed", e);
      });

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

          const fileId = await registerImportedFileSyncLazy(doc).catch((e) => {
            console.warn("[documentStore] file-sync registration failed", e);
            return null;
          });
          if (fileId) {
            doc.fileId = fileId;
            doc.metadata = { ...doc.metadata, fileId };
            await documentsApi.upsertSyncedDocument(doc).catch((e) => {
              console.warn("[documentStore] failed to save fileId to SQLite metadata", e);
            });
          }

          await publishDocumentLazy(doc).catch((e) => {
            console.warn("[documentStore] document publish failed", e);
          });

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

  importFromUrl: async (url) => {
    set({ isImporting: true, error: null, importProgress: { current: 0, total: 1, fileName: `Fetching ${url}...` } });

    try {
      // Use existing utility to fetch and create document data
      const docData = await importFromUrlUtil(url, { preserveImages: true });

      const collectionId = useCollectionStore.getState().activeCollectionId;
      const doc = await documentsApi.createDocument(
        docData.title,
        docData.filePath,
        docData.fileType,
        collectionId
      );

      // Prepare full update with all document data including FSRS fields
      const fullUpdate: Partial<Document> = {
        content: docData.content,
        tags: docData.tags,
        category: docData.category,
        metadata: docData.metadata,
        priorityRating: docData.priorityRating,
        prioritySlider: docData.prioritySlider,
        priorityScore: docData.priorityScore,
        // FSRS fields - new documents start fresh
        nextReadingDate: docData.nextReadingDate,
        stability: docData.stability,
        difficulty: docData.difficulty,
        reps: docData.reps,
        totalTimeSpent: docData.totalTimeSpent,
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

      // Publish the doc row to the sync room so other devices' libraries
      // receive it. URL imports (YouTube, web articles, etc.) store the URL in
      // filePath and have no local file bytes to transfer via the file-sync
      // layer — the URL IS the content, so the receiver opens it directly.
      // Without this publish, the doc never leaves the importing device.
      await publishDocumentLazy(doc).catch((e) => {
        console.warn("[documentStore] document publish failed", e);
      });

      set((state) => ({
        documents: [...state.documents, doc],
        isImporting: false,
        importProgress: { current: 1, total: 1, fileName: docData.title }
      }));

      return doc;
    } catch (error) {
      console.error('[DocumentStore] Import failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to import from URL',
        isImporting: false,
        importProgress: { current: 0, total: 0 }
      });
      throw error;
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

      // Publish the doc row to the sync room (see importFromUrl). arXiv imports
      // are URL/PDF-content documents with no device-local file to transfer.
      await publishDocumentLazy(doc).catch((e) => {
        console.warn("[documentStore] document publish failed", e);
      });

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
        title: "Page saved to Incrementum",
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

  runDeferredSyncSetup(() => {
    void import("../lib/yjsSync").then(({ registerRoomChangeListener }) => {
      registerRoomChangeListener(() => {
        const docs = useDocumentStore.getState().documents;
        void registerExistingFilesSyncLazy(docs);
      });
    }).catch((err) => {
      console.warn("[DocumentStore] Failed to register sync room-change listener:", err);
    });
  });
}
