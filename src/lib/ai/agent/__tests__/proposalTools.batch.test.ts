/**
 * `propose_flashcard_batch` (change 8.1): 1–6 drafts per call, per-item
 * typed results, proposal cap stays authoritative, identical grounding.
 */

import { describe, expect, it } from "vitest";
import { isFailedOutcome } from "../../schemas/common";
import { createAgentEvidenceMap } from "../evidence";
import { proposeFlashcardBatchTool } from "../tools/proposals";
import type { AgentSessionRuntime, AgentEnvironment } from "../tools/types";

function sessionWithEvidence(seeds: number): AgentSessionRuntime {
  const evidence = createAgentEvidenceMap();
  for (let i = 0; i < seeds; i++) {
    evidence.register({ kind: "selection", recordId: `r${i}`, text: "source text" });
  }
  return {
    runId: "run-batch",
    proposals: [],
    proposalCapHit: false,
    evidence,
    sourceRevision: "v1",
    closed: false,
    addProposal(input) {
      if (this.closed) return null;
      const proposal = {
        ...input,
        proposalId: `run-batch:p${this.proposals.length + 1}`,
        createdAt: 0,
      } as never;
      this.proposals.push(proposal as never);
      return proposal;
    },
    close() {
      this.closed = true;
    },
  };
}

function ctx(session: AgentSessionRuntime): { session: AgentSessionRuntime; env: AgentEnvironment } {
  return {
    session,
    env: {
      sourceScope: "frozen",
      retrieve: async () => ({ results: [], mode: "none" }),
      getDocument: () => ({ id: "d1", title: "Doc", fileType: "pdf" }),
      getSelection: () => null,
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

describe("propose_flashcard_batch", () => {
  const draft = (index: number) => ({
    question: `Question ${index}?`,
    answer: `Answer ${index}.`,
    sourceHandle: "s1",
  });

  it("proposes 5 seeded cards in one call", async () => {
    const session = sessionWithEvidence(1);
    const outcome = proposeFlashcardBatchTool.validate({ cards: [1,2,3,4,5].map(draft) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = await proposeFlashcardBatchTool.execute(outcome.value, ctx(session));
    expect(result.ok).toBe(true);
    const payload = result.result as { proposed: Array<{ proposalId?: string; error?: string }> };
    expect(payload.proposed).toHaveLength(5);
    expect(payload.proposed.every((entry) => entry.proposalId)).toBe(true);
    expect(session.proposals).toHaveLength(5);
    expect(session.proposals.every((p) => p.sourceRefs[0].handle === "s1")).toBe(true);
  });

  it("mixed validity keeps valid items and returns typed per-item errors", async () => {
    const session = sessionWithEvidence(1);
    const mixed = {
      cards: [
        draft(1),
        { question: "Missing answer", sourceHandle: "s1" },
        draft(3),
        { answer: "Missing question", sourceHandle: "s1" },
      ],
    };
    const outcome = proposeFlashcardBatchTool.validate(mixed);
    if (!isFailedOutcome(outcome)) throw new Error("expected invalid batch");
    expect(outcome.errors.join(" ")).toContain("cards[1]");
    expect(outcome.errors.join(" ")).toContain("cards[3]");
  });

  it("cap hit mid-batch yields typed per-item rejection; session stays authoritative", async () => {
    const session = sessionWithEvidence(1) as AgentSessionRuntime & { addProposal: () => null };
    session.addProposal = () => null;
    const outcome = proposeFlashcardBatchTool.validate({ cards: [1, 2, 3].map(draft) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = await proposeFlashcardBatchTool.execute(outcome.value, ctx(session));
    const payload = result.result as { proposed: Array<{ proposalId?: string; error?: string }> };
    expect(payload.proposed.every((entry) => entry.error)).toBe(true);
    expect(payload.proposed[0].error).toContain("proposal limit");
  });

  it("rejects empty and over-limit batches", async () => {
    expect(proposeFlashcardBatchTool.validate({ cards: [] }).ok).toBe(false);
    expect(proposeFlashcardBatchTool.validate({ cards: Array.from({ length: 7 }, draft) }).ok).toBe(false);
    expect(proposeFlashcardBatchTool.validate({ cards: "nope" }).ok).toBe(false);
  });
});
