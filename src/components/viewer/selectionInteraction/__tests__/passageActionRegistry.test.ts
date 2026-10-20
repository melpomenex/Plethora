import { describe, expect, it } from "vitest";
import {
  getPassageScoreActions,
  getSelectionActions,
  isValidPassageActionSnapshot,
  type PassageActionSnapshot,
} from "../selectionActionRegistry";

const valid: PassageActionSnapshot = {
  ownerToken: "owner-1",
  documentId: "doc-1",
  sourceRevision: "rev-1",
  passageId: "p1",
  contentHash: "f".repeat(64),
};

describe("passage score action registry", () => {
  it("requires a complete validated snapshot with a full content digest", () => {
    expect(isValidPassageActionSnapshot(valid)).toBe(true);
    expect(isValidPassageActionSnapshot({ ...valid, ownerToken: "" })).toBe(false);
    expect(isValidPassageActionSnapshot({ ...valid, sourceRevision: "" })).toBe(false);
    expect(isValidPassageActionSnapshot({ ...valid, passageId: "" })).toBe(false);
    expect(isValidPassageActionSnapshot({ ...valid, contentHash: "short" })).toBe(false);
    expect(isValidPassageActionSnapshot({ ...valid, contentHash: "G".repeat(64) })).toBe(false);
    expect(isValidPassageActionSnapshot(null)).toBe(false);
  });

  it("orders passage actions and gates object creation independently", () => {
    const actions = getPassageScoreActions(valid);
    expect(actions.map((action) => action.id)).toEqual([
      "passageExtract",
      "passageLearnThis",
      "passageFlashcard",
      "passageCloze",
      "passageHighlight",
      "passageDismiss",
    ]);

    const ephemeral = getPassageScoreActions(valid, { canCreateObjects: false });
    expect(ephemeral.map((action) => action.id)).toEqual(["passageDismiss"]);

    const noLearnThis = getPassageScoreActions(valid, { learnThisEnabled: false });
    expect(noLearnThis.map((action) => action.id)).not.toContain("passageLearnThis");

    expect(getPassageScoreActions(null)).toEqual([]);
  });

  it("does not leak passage actions onto existing selection surfaces", () => {
    for (const surface of ["bar", "menu", "sheet"] as const) {
      const ids = getSelectionActions(surface).map((action) => action.id);
      expect(ids).not.toContain("passageExtract");
      expect(ids).not.toContain("passageDismiss");
    }
    // Existing selection behavior is unchanged (AI gating still applies).
    expect(getSelectionActions("bar", { aiAvailable: false }).map((a) => a.id)).toContain(
      "extract"
    );
  });
});
