import { create } from "zustand";
import type { DocumentSortDirection, DocumentSortKey, DocumentViewMode } from "../utils/documentsView";

export const SAVED_VIEWS_KEY = "documentsSavedViews";

export type CompactDocumentFilter =
  | "all"
  | "priority"
  | "recent"
  | "active"
  | "parked"
  | "suspended"
  | "highlights"
  | "cards";

export type SavedViewConfig = {
  query: string;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
  mode: DocumentViewMode;
  compactDocumentsView?: boolean;
  showNextAction: boolean;
  fileTypeFilter: string;
  categoryFilter?: string;
  compactFilter?: CompactDocumentFilter;
};

export type SavedView = SavedViewConfig & {
  id: string;
  name: string;
};

const VALID_SORT_KEYS = new Set<DocumentSortKey>([
  "priority",
  "lastTouched",
  "added",
  "title",
  "type",
  "extracts",
  "cards",
]);

const VALID_MODES = new Set<DocumentViewMode>(["list", "grid"]);

const VALID_COMPACT_FILTERS = new Set<CompactDocumentFilter>([
  "all",
  "priority",
  "recent",
  "active",
  "parked",
  "suspended",
  "highlights",
  "cards",
]);

export function generateSavedViewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    const result: SavedView[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const rawId = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const rawName = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!rawId || !rawName) continue;

      const id = seenIds.has(rawId) ? generateSavedViewId() : rawId;
      seenIds.add(id);

      const sortKey: DocumentSortKey =
        typeof candidate.sortKey === "string" && VALID_SORT_KEYS.has(candidate.sortKey as DocumentSortKey)
          ? (candidate.sortKey as DocumentSortKey)
          : "priority";
      const sortDirection: DocumentSortDirection =
        candidate.sortDirection === "asc" || candidate.sortDirection === "desc"
          ? candidate.sortDirection
          : "desc";
      const mode: DocumentViewMode =
        typeof candidate.mode === "string" && VALID_MODES.has(candidate.mode as DocumentViewMode)
          ? (candidate.mode as DocumentViewMode)
          : "list";
      const compactFilter: CompactDocumentFilter | undefined =
        typeof candidate.compactFilter === "string" &&
        VALID_COMPACT_FILTERS.has(candidate.compactFilter as CompactDocumentFilter)
          ? (candidate.compactFilter as CompactDocumentFilter)
          : undefined;

      result.push({
        ...(candidate as Record<string, unknown>),
        id,
        name: rawName,
        query: typeof candidate.query === "string" ? candidate.query : "",
        sortKey,
        sortDirection,
        mode,
        compactDocumentsView:
          typeof candidate.compactDocumentsView === "boolean"
            ? candidate.compactDocumentsView
            : undefined,
        showNextAction: typeof candidate.showNextAction === "boolean" ? candidate.showNextAction : false,
        fileTypeFilter: typeof candidate.fileTypeFilter === "string" ? candidate.fileTypeFilter : "all",
        categoryFilter: typeof candidate.categoryFilter === "string" ? candidate.categoryFilter : undefined,
        compactFilter,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function readSavedViewsFromStorage(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

function writeSavedViewsToStorage(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Ignore quota or storage unavailability errors
  }
}

export function isSavedViewModified(view: SavedView, current: SavedViewConfig): boolean {
  return (
    (view.query ?? "") !== (current.query ?? "") ||
    view.sortKey !== current.sortKey ||
    view.sortDirection !== current.sortDirection ||
    view.mode !== current.mode ||
    Boolean(view.compactDocumentsView) !== Boolean(current.compactDocumentsView) ||
    Boolean(view.showNextAction) !== Boolean(current.showNextAction) ||
    (view.fileTypeFilter ?? "all") !== (current.fileTypeFilter ?? "all") ||
    (view.categoryFilter ?? "all") !== (current.categoryFilter ?? "all") ||
    (view.compactFilter ?? "all") !== (current.compactFilter ?? "all")
  );
}

interface SavedViewsState {
  savedViews: SavedView[];
  reloadFromStorage: () => void;
  createView: (name: string, config: SavedViewConfig) => SavedView | null;
  deleteView: (id: string) => { deletedView: SavedView; index: number } | null;
  restoreView: (view: SavedView, index: number) => boolean;
  renameView: (id: string, name: string) => SavedView | null;
  updateView: (id: string, config: SavedViewConfig) => SavedView | null;
  duplicateView: (id: string, copyLabel?: string) => SavedView | null;
  moveView: (id: string, direction: "up" | "down") => boolean;
  reorderViews: (fromIndex: number, toIndex: number) => boolean;
}

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
  savedViews: readSavedViewsFromStorage(),

  reloadFromStorage: () => {
    set({ savedViews: readSavedViewsFromStorage() });
  },

  createView: (name, config) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const view: SavedView = {
      ...config,
      id: generateSavedViewId(),
      name: trimmed,
    };
    const next = [...get().savedViews, view];
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return view;
  },

  deleteView: (id) => {
    const current = get().savedViews;
    const index = current.findIndex((v) => v.id === id);
    if (index === -1) return null;
    const deletedView = current[index];
    const next = current.filter((v) => v.id !== id);
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return { deletedView, index };
  },

  restoreView: (view, index) => {
    const current = get().savedViews;
    if (current.some((v) => v.id === view.id)) return false;
    const clampedIndex = Math.max(0, Math.min(index, current.length));
    const next = [...current.slice(0, clampedIndex), view, ...current.slice(clampedIndex)];
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return true;
  },

  renameView: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    let updated: SavedView | null = null;
    const next = get().savedViews.map((view) => {
      if (view.id !== id) return view;
      updated = { ...view, name: trimmed };
      return updated;
    });
    if (!updated) return null;
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return updated;
  },

  updateView: (id, config) => {
    let updated: SavedView | null = null;
    const next = get().savedViews.map((view) => {
      if (view.id !== id) return view;
      updated = {
        ...view,
        ...config,
        id: view.id,
        name: view.name,
      };
      return updated;
    });
    if (!updated) return null;
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return updated;
  },

  duplicateView: (id, copyLabel = "Copy") => {
    const current = get().savedViews;
    const index = current.findIndex((v) => v.id === id);
    if (index === -1) return null;
    const source = current[index];
    const baseName = `${source.name} (${copyLabel})`;
    const existingNames = new Set(current.map((v) => v.name));
    let candidateName = baseName;
    let suffix = 2;
    while (existingNames.has(candidateName)) {
      candidateName = `${source.name} (${copyLabel} ${suffix})`;
      suffix += 1;
    }
    const duplicate: SavedView = {
      ...source,
      id: generateSavedViewId(),
      name: candidateName,
    };
    const next = [...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)];
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return duplicate;
  },

  moveView: (id, direction) => {
    const current = get().savedViews;
    const index = current.findIndex((v) => v.id === id);
    if (index === -1) return false;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return false;
    return get().reorderViews(index, targetIndex);
  },

  reorderViews: (fromIndex, toIndex) => {
    const current = get().savedViews;
    if (
      fromIndex < 0 ||
      fromIndex >= current.length ||
      toIndex < 0 ||
      toIndex >= current.length ||
      fromIndex === toIndex
    ) {
      return false;
    }
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    writeSavedViewsToStorage(next);
    set({ savedViews: next });
    return true;
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_VIEWS_KEY) {
      useSavedViewsStore.getState().reloadFromStorage();
    }
  });
}
