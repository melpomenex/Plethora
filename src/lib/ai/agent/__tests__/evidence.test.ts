import { describe, expect, it, vi } from "vitest";
import { createAgentDeadline } from "../deadline";
import { AgentEvidenceMap, entryContainsText } from "../evidence";
import { resolveProposalSources } from "../tools/proposals";
import { createAgentEvidenceMap } from "../evidence";
import type { AgentSessionRuntime, AgentToolContext } from "../tools/types";

function contextWithEvidence(
  entries: Array<{ text: string; documentId: string; title?: string; locator?: string }>,
  sourceScope: "frozen" | "global" = "frozen"
): AgentToolContext {
  const evidence = createAgentEvidenceMap("rev-1");
  for (const entry of entries) {
    evidence.register({
      kind: "chunk",
      recordId: `chunk-${entry.documentId}`,
      documentId: entry.documentId,
      title: entry.title,
      locator: entry.locator,
      text: entry.text,
    });
  }
  const session = {
    runId: "run-1",
    proposals: [],
    proposalCapHit: false,
    evidence,
    sourceRevision: "rev-1",
    closed: false,
    addProposal: vi.fn(),
    close: vi.fn(),
  } as unknown as AgentSessionRuntime;
  return {
    session,
    env: {
      sourceScope,
      getDocument: () => null,
      getSelection: () => null,
      retrieve: async () => ({ results: [], mode: "none" }),
      getRecentExtracts: async () => [],
      getCards: async () => [],
      getDueCards: async () => [],
      getReviewStats: async () => ({
        totalItems: 0,
        totalReviews: 0,
        totalLapses: 0,
        avgInterval: 0,
        retentionEstimate: 0,
        dueToday: 0,
        dueWeek: 0,
        dueMonth: 0,
      }),
      getImageAsset: async () => null,
    },
  };
}

describe("agent run deadline", () => {
  it("aborts at the absolute deadline and reports deadline expiry separately", () => {
    let clock = 0;
    const scheduled: Array<() => void> = [];
    const deadline = createAgentDeadline({
      wallClockMs: 1_000,
      now: () => clock,
      setTimeoutFn: ((handler: () => void) => {
        scheduled.push(handler);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    });
    expect(deadline.remainingMs()).toBe(1_000);
    clock = 1_000;
    scheduled[0]();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expiredByDeadline()).toBe(true);
    expect(deadline.cancelledExternally()).toBe(false);
    deadline.dispose();
  });

  it("links an external Stop signal without claiming deadline expiry", () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline({ signal: controller.signal, wallClockMs: 60_000 });
    controller.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expiredByDeadline()).toBe(false);
    expect(deadline.cancelledExternally()).toBe(true);
    deadline.dispose();
  });
});

describe("per-run evidence map", () => {
  it("assigns application handles and resolves exact text", () => {
    const map = new AgentEvidenceMap("rev-1");
    const first = map.register({
      kind: "chunk",
      recordId: "chunk-1",
      documentId: "doc-a",
      text: "Entropy is a measure of disorder.",
    });
    const second = map.register({
      kind: "chunk",
      recordId: "chunk-2",
      documentId: "doc-b",
      text: "The hippocampus consolidates memories.",
    });
    expect(first.handle).toBe("s1");
    expect(second.handle).toBe("s2");
    expect(map.resolve("s1")?.documentId).toBe("doc-a");
    expect(map.findContaining("measure of disorder")?.handle).toBe("s1");
    expect(map.findContaining("hippocampus")?.handle).toBe("s2");
    expect(map.findContaining("not present anywhere")).toBeUndefined();
  });

  it("normalizes whitespace/case for verbatim containment", () => {
    const entry = {
      handle: "s1",
      kind: "chunk" as const,
      sourceRef: { refId: "c", kind: "chunk" as const },
      text: "The  Pumping\nLemma applies.",
      recordId: "c",
    };
    expect(entryContainsText(entry, "pumping lemma")).toBe(true);
    expect(entryContainsText(entry, "pumping theorem")).toBe(false);
  });
});

describe("proposal source resolution (frozen scope)", () => {
  it("resolves an application handle and rejects fabricated handles", () => {
    const context = contextWithEvidence([
      { text: "ATP synthase produces ATP.", documentId: "paper-a", title: "Paper A" },
    ]);
    const ok = resolveProposalSources(
      { sourceHandle: "s1", requireText: "ATP synthase" },
      context
    );
    expect(ok.ok).toBe(true);
    expect(ok.sources[0].documentId).toBe("paper-a");

    const fabricated = resolveProposalSources(
      { sourceHandle: "s99", requireText: "ATP synthase" },
      context
    );
    expect(fabricated.ok).toBe(false);
    expect(fabricated.problem).toContain("not resolved");
  });

  it("never falls back to another visible document in a frozen run", () => {
    const context = contextWithEvidence(
      [{ text: "Mitochondria are organelles.", documentId: "paper-a" }],
      "frozen"
    );
    // Even if a global document existed, frozen scope must not use it.
    (context.env as { getDocument: () => unknown }).getDocument = () => ({
      id: "paper-b",
      title: "Currently visible paper B",
      fileType: "pdf",
    });
    const result = resolveProposalSources(
      { requireText: "This sentence is from paper B" },
      context
    );
    expect(result.ok).toBe(false);
    expect(result.sources).toHaveLength(0);
  });

  it("uses exact text containment to resolve a cloze deletion", () => {
    const context = contextWithEvidence([
      { text: "The Krebs cycle occurs in the mitochondrial matrix.", documentId: "paper-a" },
    ]);
    const result = resolveProposalSources(
      { requireText: "mitochondrial matrix" },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.sources[0].handle).toBe("s1");
  });

  it("rejects an evidence quote that is not verbatim", () => {
    const context = contextWithEvidence([
      { text: "The cell membrane is selectively permeable.", documentId: "paper-a" },
    ]);
    const result = resolveProposalSources(
      { sourceHandle: "s1", evidenceQuote: "The cell membrane is impermeable" },
      context
    );
    expect(result.ok).toBe(false);
    expect(result.problem).toContain("evidenceQuote");
  });
});
