import { describe, expect, it } from "vitest";
import {
  buildSelectionAskSeedMessage,
  createSelectionAskSnapshot,
  requestSelectionAsk,
  SELECTION_ASK_EVENT,
  shouldReseedSelectionSnapshot,
} from "../selectionAskHandoff";

describe("selectionAskHandoff", () => {
  it("snapshots normalized selection with doc ref", () => {
    const snapshot = createSelectionAskSnapshot("  hello   world  ", {
      documentId: "doc-1",
      documentTitle: "Photosynthesis",
      locator: "Page 3",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.excerpt).toBe("hello world");
    expect(snapshot?.documentTitle).toBe("Photosynthesis");
    expect(snapshot?.truncated).toBe(false);
  });

  it("returns null for empty selection", () => {
    expect(createSelectionAskSnapshot("   ")).toBeNull();
  });

  it("reseeds on new excerpt or document, not on identical snapshot", () => {
    const a = createSelectionAskSnapshot("alpha", { documentId: "doc-1" })!;
    const same = createSelectionAskSnapshot("alpha", { documentId: "doc-1" })!;
    const differentText = createSelectionAskSnapshot("beta", { documentId: "doc-1" })!;
    const differentDoc = createSelectionAskSnapshot("alpha", { documentId: "doc-2" })!;
    expect(shouldReseedSelectionSnapshot(null, a)).toBe(true);
    expect(shouldReseedSelectionSnapshot(a, same)).toBe(false);
    expect(shouldReseedSelectionSnapshot(a, differentText)).toBe(true);
    expect(shouldReseedSelectionSnapshot(a, differentDoc)).toBe(true);
    expect(shouldReseedSelectionSnapshot(a, null)).toBe(false);
  });

  it("builds a seed message quoting excerpt with source and question", () => {
    const snapshot = createSelectionAskSnapshot("selected paragraph", {
      documentTitle: "Photosynthesis",
    })!;
    const message = buildSelectionAskSeedMessage(snapshot, "Why does this matter?");
    expect(message).toContain("selected paragraph");
    expect(message).toContain("Photosynthesis");
    expect(message).toContain("Why does this matter?");
  });

  it("dispatches the Ask handoff event for hosts to open/focus the Assistant", () => {
    const seen: Array<{ excerpt: string }> = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { snapshot: { excerpt: string } };
      seen.push({ excerpt: detail.snapshot.excerpt });
    };
    window.addEventListener(SELECTION_ASK_EVENT, listener);
    try {
      const snapshot = requestSelectionAsk("paragraph text", { documentId: "doc-9" });
      expect(snapshot?.excerpt).toContain("paragraph text");
      expect(seen).toHaveLength(1);
      expect(seen[0].excerpt).toContain("paragraph text");
    } finally {
      window.removeEventListener(SELECTION_ASK_EVENT, listener);
    }
  });
});
