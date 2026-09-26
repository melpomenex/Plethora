import { describe, expect, it } from "vitest";
import {
  SELECTION_ACTIONS,
  getSelectionAction,
  getSelectionActions,
  selectionActionLabelKey,
  type SelectionActionAvailability,
} from "../selectionActionRegistry";

const ids = (surface: Parameters<typeof getSelectionActions>[0], availability?: SelectionActionAvailability) =>
  getSelectionActions(surface, availability).map((a) => a.id);

describe("selectionActionRegistry", () => {
  it("derives the bar set in the chip order the bar has always used", () => {
    expect(ids("bar", { aiAvailable: true, canExtract: true, canReadAloud: true, learnThisHandlerAvailable: true })).toEqual([
      "summarize",
      "explain",
      "learnThis",
      "ask",
      "readFromHere",
      "extract",
      "copy",
    ]);
  });

  it("drops AI chips when no provider path exists", () => {
    expect(ids("bar", { canExtract: true, canReadAloud: true })).toEqual(["readFromHere", "extract", "copy"]);
  });

  it("drops extract on surfaces without an extract path and read-aloud without a TTS anchor", () => {
    expect(ids("bar", { aiAvailable: true, canExtract: false })).toEqual(["summarize", "explain", "ask", "copy"]);
    expect(ids("bar", { aiAvailable: true, canReadAloud: true })).toEqual([
      "summarize",
      "explain",
      "ask",
      "readFromHere",
      "extract",
      "copy",
    ]);
  });

  it("gates the bar Learn-this chip on the host-wired handler, not the feature flag", () => {
    expect(ids("bar", { aiAvailable: true, learnThisEnabled: true })).not.toContain("learnThis");
    expect(ids("bar", { aiAvailable: true, learnThisHandlerAvailable: true })).toContain("learnThis");
    expect(ids("bar", { learnThisHandlerAvailable: true })).not.toContain("learnThis");
  });

  it("derives the desktop menu set with its separator groups intact", () => {
    const full = getSelectionActions("menu", { aiAvailable: true, learnThisEnabled: true });
    expect(full.map((a) => a.id)).toEqual([
      "extract",
      "extractDialog",
      "highlight",
      "copy",
      "dictionary",
      "flashcard",
      "explain",
      "summarize",
      "simplify",
      "keyTerms",
      "ask",
      "learnThis",
    ]);
    // Groups: {extract, extractDialog, highlight} | {copy, dictionary} | {flashcard} | AI…
    expect(full.map((a) => a.menuGroup)).toEqual([1, 1, 1, 2, 2, 3, 4, 4, 4, 4, 4, 4]);
  });

  it("hides the whole AI block of the menu when AI is unavailable", () => {
    expect(ids("menu", {})).toEqual([
      "extract",
      "extractDialog",
      "highlight",
      "copy",
      "dictionary",
      "flashcard",
    ]);
    expect(ids("menu", { aiAvailable: true })).not.toContain("learnThis");
  });

  it("derives the sheet set, gating extract on the host capability and extras on their flags", () => {
    expect(
      ids("sheet", {
        aiAvailable: true,
        canExtract: true,
        learnThisEnabled: true,
        libraryRagEnabled: true,
        socraticTutorEnabled: true,
        prerequisitesEnabled: true,
      }),
    ).toEqual([
      "extract",
      "copy",
      "explain",
      "summarize",
      "simplify",
      "keyTerms",
      "ask",
      "learnThis",
      "askLibrary",
      "socraticTutor",
      "prerequisites",
    ]);
    expect(ids("sheet", { aiAvailable: true, canExtract: false })).toEqual([
      "copy",
      "explain",
      "summarize",
      "simplify",
      "keyTerms",
      "ask",
    ]);
  });

  it("defines every descriptor exactly once with a label key per surface it appears on", () => {
    const seen = new Set<string>();
    for (const action of SELECTION_ACTIONS) {
      expect(seen.has(action.id)).toBe(false);
      seen.add(action.id);
      const surfaces = Object.keys(action.order) as Array<keyof typeof action.order>;
      expect(surfaces.length).toBeGreaterThan(0);
      for (const surface of surfaces) {
        expect(action.order[surface]).toBeGreaterThan(-1);
        expect(selectionActionLabelKey(action, surface)).toMatch(/\w+\.\w+/);
      }
    }
    expect(SELECTION_ACTIONS.length).toBe(seen.size);
  });

  it("keeps per-surface orders collision-free", () => {
    for (const surface of ["bar", "menu", "sheet"] as const) {
      const orders = SELECTION_ACTIONS.map((a) => a.order[surface]).filter((o) => o !== undefined);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("resolves descriptors by id", () => {
    expect(getSelectionAction("extract")?.icon).toBeDefined();
    expect(getSelectionAction("nonexistent" as never)).toBeUndefined();
  });
});
