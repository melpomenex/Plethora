import { beforeEach, describe, expect, it } from "vitest";
import {
  BAR_ADAPTATION_MIN_INVOCATIONS,
  rankBarActionsByUsage,
  recordSelectionActionInvocation,
  totalInvocationCount,
  useSelectionActionUsageStore,
} from "../selectionActionUsage";
import { getSelectionActions } from "../selectionActionRegistry";

const barIds = (counts: Parameters<typeof rankBarActionsByUsage>[1]) =>
  rankBarActionsByUsage(
    getSelectionActions("bar", { aiAvailable: true, canExtract: true, canReadAloud: true }),
    counts,
  ).map((a) => a.id);

const canonicalBar = ["summarize", "explain", "ask", "readFromHere", "extract", "copy"];

describe("selectionActionUsage", () => {
  beforeEach(() => {
    useSelectionActionUsageStore.getState().resetUsage();
    window.localStorage.removeItem("plethora-selection-action-usage");
  });

  it("keeps the canonical order until enough usage signal exists", () => {
    const counts = { extract: 3, copy: 2 };
    expect(totalInvocationCount(counts)).toBeLessThan(BAR_ADAPTATION_MIN_INVOCATIONS);
    expect(barIds(counts)).toEqual(canonicalBar);
    expect(barIds({})).toEqual(canonicalBar);
  });

  it("floats the most-used action to the front once the threshold is passed", () => {
    // A user who extracts constantly: extract first; remaining actions
    // follow usage, with equals keeping canonical order.
    const counts = { extract: BAR_ADAPTATION_MIN_INVOCATIONS, summarize: 2, copy: 1 };
    expect(barIds(counts)).toEqual([
      "extract",
      "summarize",
      "copy",
      "explain",
      "ask",
      "readFromHere",
    ]);
  });

  it("breaks ties by canonical order, so equals never jitter", () => {
    const counts = { copy: 4, extract: 4, summarize: 2 };
    const ids = barIds(counts);
    // extract (canonical 5) precedes copy (canonical 6) at equal counts.
    expect(ids.indexOf("extract")).toBeLessThan(ids.indexOf("copy"));
    expect(ids[0]).toBe("extract");
  });

  it("ranks only available actions — popularity never weakens gating", () => {
    // AI unavailable: summarize/explain/ask must not appear no matter their counts.
    const counts = { summarize: 50, explain: 20, extract: 3 };
    const ranked = rankBarActionsByUsage(
      getSelectionActions("bar", { canExtract: true }),
      counts,
    ).map((a) => a.id);
    expect(ranked).toEqual(["extract", "copy"]);
  });

  it("records increments through the store and persists content-free counts only", () => {
    recordSelectionActionInvocation("extract");
    recordSelectionActionInvocation("extract");
    recordSelectionActionInvocation("summarize");
    expect(useSelectionActionUsageStore.getState().counts).toEqual({
      extract: 2,
      summarize: 1,
    });
    const persisted = window.localStorage.getItem("plethora-selection-action-usage");
    expect(persisted).toBeTruthy();
    // Counts of action ids only — no selected text or document content.
    expect(Object.keys(JSON.parse(persisted!).state.counts)).toEqual(["extract", "summarize"]);
  });

  it("crosses the adaptation threshold exactly at BAR_ADAPTATION_MIN_INVOCATIONS", () => {
    const justBelow = { extract: BAR_ADAPTATION_MIN_INVOCATIONS - 1 };
    expect(barIds(justBelow)).toEqual(canonicalBar);
    const justAt = { extract: BAR_ADAPTATION_MIN_INVOCATIONS - 1, copy: 1 };
    expect(barIds(justAt)[0]).toBe("extract");
  });
});
