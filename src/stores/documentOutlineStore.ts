import { create } from "zustand";

interface OutlineEntry {
  pdfOutline?: Array<{ title: string; pageNumber?: number; items?: unknown[] }>;
  epubToc?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }>;
  updatedAt: number;
}

interface DocumentOutlineState {
  outlineByDocId: Map<string, OutlineEntry>;
  setOutline: (docId: string, entry: Partial<OutlineEntry>) => void;
  getOutline: (docId: string) => OutlineEntry | undefined;
  clearOutline: (docId: string) => void;
}

export const useDocumentOutlineStore = create<DocumentOutlineState>((set, get) => ({
  outlineByDocId: new Map<string, OutlineEntry>(),

  setOutline: (docId, entry) => {
    set((state) => {
      const next = new Map(state.outlineByDocId);
      const existing = next.get(docId) || { updatedAt: Date.now() };
      next.set(docId, {
        pdfOutline: entry.pdfOutline ?? existing.pdfOutline,
        epubToc: entry.epubToc ?? existing.epubToc,
        updatedAt: Date.now(),
      });
      return { outlineByDocId: next };
    });
  },

  getOutline: (docId) => {
    return get().outlineByDocId.get(docId);
  },

  clearOutline: (docId) => {
    set((state) => {
      const next = new Map(state.outlineByDocId);
      next.delete(docId);
      return { outlineByDocId: next };
    });
  },
}));
