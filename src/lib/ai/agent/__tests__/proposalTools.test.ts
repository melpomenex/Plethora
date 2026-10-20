import { describe, expect, it, vi } from "vitest";
import {
  proposeClozeTool,
  proposeExtractTool,
  proposeFlashcardTool,
  proposeLinkTool,
} from "../tools/proposals";
import { createAgentEvidenceMap } from "../evidence";
import type {
  AgentCardProposal,
  AgentProposalInput,
  AgentSessionRuntime,
  AgentToolContext,
} from "../tools/types";

function setup(sourceText = "Entropy is a measure of disorder in a closed system.") {
  const evidence = createAgentEvidenceMap("rev-1");
  evidence.register({
    kind: "chunk",
    recordId: "chunk-a",
    documentId: "paper-a",
    title: "Paper A",
    locator: "Chapter 1",
    text: sourceText,
  });
  const addProposal = vi.fn((input: AgentProposalInput) => ({
    ...input,
    proposalId: `run:p${addProposal.mock.calls.length}`,
    createdAt: 1,
  }));
  const session = {
    runId: "run",
    proposals: [],
    proposalCapHit: false,
    evidence,
    sourceRevision: "rev-1",
    closed: false,
    addProposal,
    close: vi.fn(),
  } as unknown as AgentSessionRuntime;
  const context: AgentToolContext = {
    session,
    env: {
      sourceScope: "frozen",
      getDocument: () => ({ id: "paper-a", title: "Paper A", fileType: "pdf" }),
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
  return { context, addProposal, evidence };
}

describe("source-bound proposal tools", () => {
  it("assigns application identity and the exact cited source to a card", async () => {
    const { context, addProposal } = setup();
    const input = proposeFlashcardTool.validate({
      question: "What is entropy?",
      answer: "A measure of disorder in a closed system.",
      sourceHandle: "s1",
      concept: "entropy",
    });
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const result = await proposeFlashcardTool.execute(input.value, context);
    expect(result.ok).toBe(true);
    expect(addProposal).toHaveBeenCalledTimes(1);
    const proposal = addProposal.mock.calls[0][0] as AgentCardProposal;
    expect(proposal.sourceRefs[0].documentId).toBe("paper-a");
    expect(proposal.sourceRefs[0].text).toContain("Entropy is a measure");
    expect(proposal.conceptKeys).toEqual(["entropy"]);
  });

  it("keeps supporting source handles on a multi-source candidate", async () => {
    const { context, addProposal, evidence } = setup();
    evidence.register({
      kind: "chunk",
      recordId: "chunk-b",
      documentId: "paper-b",
      title: "Paper B",
      text: "Free energy predicts spontaneity.",
    });
    const result = await proposeFlashcardTool.execute(
      {
        question: "How is spontaneity predicted?",
        answer: "Free energy.",
        cardType: "qa",
        sourceHandle: "s1",
        supportingSourceHandles: ["s2"],
      },
      context
    );
    expect(result.ok).toBe(true);
    const proposal = addProposal.mock.calls[0][0] as AgentCardProposal;
    expect(proposal.sourceRefs.map((source) => source.documentId)).toEqual([
      "paper-a",
      "paper-b",
    ]);
  });

  it("rejects a fabricated source handle", async () => {
    const { context, addProposal } = setup();
    const result = await proposeFlashcardTool.execute(
      {
        question: "What is entropy?",
        answer: "Disorder.",
        cardType: "qa",
        sourceHandle: "s99",
      },
      context
    );
    expect(result.ok).toBe(false);
    expect(result.displayDigest).toContain("not resolved");
    expect(addProposal).not.toHaveBeenCalled();
  });

  it("does not let paper B content inherit paper A's citation", async () => {
    const { context, addProposal } = setup(
      "Mitochondria produce ATP through oxidative phosphorylation."
    );
    const result = await proposeFlashcardTool.execute(
      {
        question: "What does the Krebs cycle produce?",
        answer: "NADH and FADH2 from paper B.",
        cardType: "qa",
      },
      context
    );
    expect(result.ok).toBe(false);
    expect(addProposal).not.toHaveBeenCalled();
  });

  it("requires a cloze deletion to be verbatim in the cited source", async () => {
    const { context, addProposal } = setup();
    const invalid = await proposeClozeTool.execute(
      { text: "Entropy is {{c1::temperature}}." },
      context
    );
    expect(invalid.ok).toBe(false);
    expect(addProposal).not.toHaveBeenCalled();

    const valid = await proposeClozeTool.execute(
      { text: "Entropy is {{c1::disorder}} in a closed system." },
      context
    );
    expect(valid.ok).toBe(true);
    expect(addProposal).toHaveBeenCalledTimes(1);
  });

  it("requires extract text to be verbatim in the resolved source", async () => {
    const { context, addProposal } = setup();
    const invented = await proposeExtractTool.execute(
      { text: "This sentence never appeared in the paper." },
      context
    );
    expect(invented.ok).toBe(false);
    expect(addProposal).not.toHaveBeenCalled();

    const real = await proposeExtractTool.execute(
      { text: "Entropy is a measure of disorder" },
      context
    );
    expect(real.ok).toBe(true);
    expect(addProposal).toHaveBeenCalledTimes(1);
  });

  it("keeps relationship proposals typed unavailable without concept handles", async () => {
    const { context } = setup();
    const validated = proposeLinkTool.validate({
      sourceHandle: "s1",
      targetHandle: "s1",
      relationType: "related-to",
      confidence: 0.9,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await proposeLinkTool.execute(validated.value, context);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("not-available");
  }, 20_000);
});
