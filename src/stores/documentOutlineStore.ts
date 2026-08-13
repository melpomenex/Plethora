import { create } from "zustand";
import type { SectionNode } from "../utils/sectionIndex";

interface OutlineEntry {
  pdfOutline?: Array<{ title: string; pageNumber?: number; items?: unknown[] }>;
  epubToc?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }>;
  updatedAt: number;
}

interface DocumentOutlineState {
  outlineByDocId: Map<string, OutlineEntry>;
  /** Viewer-published transcript chapters, shared by every # mention surface. */
  mediaSectionsByDocId: Map<string, SectionNode[]>;
  setOutline: (docId: string, entry: Partial<OutlineEntry>) => void;
  getOutline: (docId: string) => OutlineEntry | undefined;
  clearOutline: (docId: string) => void;
  setMediaSections: (docId: string, sections: SectionNode[]) => void;
  getMediaSections: (docId: string) => SectionNode[] | undefined;
}

export const useDocumentOutlineStore = create<DocumentOutlineState>((set, get) => ({
  outlineByDocId: new Map<string, OutlineEntry>(),
  mediaSectionsByDocId: new Map<string, SectionNode[]>(),

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

  setMediaSections: (docId, sections) => {
    set((state) => {
      if (state.mediaSectionsByDocId.get(docId) === sections) return state;
      const next = new Map(state.mediaSectionsByDocId);
      next.set(docId, sections);
      return { mediaSectionsByDocId: next };
    });
  },

  getMediaSections: (docId) => get().mediaSectionsByDocId.get(docId),
}));
