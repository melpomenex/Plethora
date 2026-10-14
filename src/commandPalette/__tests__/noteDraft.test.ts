import { describe, expect, it, beforeEach } from "vitest";
import { usePaletteNoteDraftStore } from "../noteDraft";

describe("palette note draft store (session-recoverable)", () => {
  beforeEach(() => {
    usePaletteNoteDraftStore.getState().clearDraft();
  });

  it("keeps a draft across apparent unmounts until explicitly cleared", () => {
    usePaletteNoteDraftStore.getState().setDraft({ title: "Idea", body: "Line one" });
    const state = usePaletteNoteDraftStore.getState();
    expect(state.draft).toEqual({ title: "Idea", body: "Line one" });
    expect(state.dirty).toBe(true);

    // Simulates leaving the composer / closing the palette: the store is
    // module-scoped, so the draft survives.
    usePaletteNoteDraftStore.getState().setDraft({ body: "Line two" });
    expect(usePaletteNoteDraftStore.getState().draft).toEqual({
      title: "Idea",
      body: "Line two",
    });

    usePaletteNoteDraftStore.getState().clearDraft();
    const cleared = usePaletteNoteDraftStore.getState();
    expect(cleared.draft).toEqual({ title: "", body: "" });
    expect(cleared.dirty).toBe(false);
  });

  it("marks the draft dirty on first partial edit", () => {
    usePaletteNoteDraftStore.getState().setDraft({ body: "x" });
    expect(usePaletteNoteDraftStore.getState().dirty).toBe(true);
  });
});
