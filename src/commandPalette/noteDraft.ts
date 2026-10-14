/**
 * Session-scoped draft store for the palette note composer.
 *
 * The draft lives outside the palette component tree so closing the palette
 * (or navigating) does not lose unsaved work: reopening Create a note within
 * the same app session resumes it. It is deliberately *not* persisted to
 * disk — leaving the session discards an unsaved note, matching "session-
 * recoverable" semantics, and only a successful save clears it.
 */

import { create } from "zustand";

export interface PaletteNoteDraft {
  title: string;
  body: string;
}

interface PaletteNoteDraftState {
  draft: PaletteNoteDraft;
  /** True when the draft holds unsaved user content. */
  dirty: boolean;
  setDraft: (patch: Partial<PaletteNoteDraft>) => void;
  clearDraft: () => void;
}

const EMPTY_DRAFT: PaletteNoteDraft = { title: "", body: "" };

export const usePaletteNoteDraftStore = create<PaletteNoteDraftState>((set) => ({
  draft: EMPTY_DRAFT,
  dirty: false,
  setDraft: (patch) =>
    set((state) => ({
      draft: { ...state.draft, ...patch },
      dirty: true,
    })),
  clearDraft: () => set({ draft: EMPTY_DRAFT, dirty: false }),
}));
