/**
 * Production adapter integration (task 4.1/4.2): frozen envelope →
 * createFrozenAgentEnvironment → real runAgentLoop with a deterministic fake
 * provider → real candidate validation → existing domain writers (mocked at
 * the API boundary) with two document sources.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const retrieveFromLibrary = vi.hoisted(() => vi.fn());
const searchLearningItemsBounded = vi.hoisted(() => vi.fn());
const getDueLearningItemsBounded = vi.hoisted(() => vi.fn());
const getReviewStatistics = vi.hoisted(() => vi.fn());
const getExtracts = vi.hoisted(() => vi.fn());
const getImageAssetById = vi.hoisted(() => vi.fn());
const createLearningItemsBatch = vi.hoisted(() => vi.fn());
const createLearningItem = vi.hoisted(() => vi.fn());
const createClozeFromExtract = vi.hoisted(() => vi.fn());
const checkSemanticDuplicateCandidates = vi.hoisted(() => vi.fn());
const getLearningItemsByAcceptanceKey = vi.hoisted(() => vi.fn());
const recordAiProvenance = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/ai-learning", () => ({ retrieveFromLibrary }));
vi.mock("../../../../api/learning-items", () => ({
  searchLearningItemsBounded,
  getDueLearningItemsBounded,
  getReviewStatistics,
  createLearningItemsBatch,
  createLearningItem,
  checkSemanticDuplicateCandidates,
  getLearningItemsByAcceptanceKey,
}));
vi.mock("../../../../api/extracts", () => ({ getExtracts }));
vi.mock("../../../../api/image-registry", () => ({ getImageAssetById }));
vi.mock("../../../../api/extract-review", () => ({ createClozeFromExtract }));
vi.mock("../../../../api/ai-provenance", () => ({ recordAiProvenance }));

import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import {
  createFrozenAgentEnvironment,
  resolveLearningAgentScope,
  runLearningAgent,
} from "../learningAgent";
import {
  buildAgentProposalGroups,
  saveAgentProposals,
  validateAgentProposalGroups,
} from "../learningAgentAcceptance";

function learningItem(id: string, question: string, answer: string) {
  return {
    id,
    question,
    answer,
    item_type: "Qa" as const,
    state: "New" as const,
    due_date: "",
    date_created: "",
    date_modified: "",
    difficulty: 0,
    interval: 0,
    ease_factor: 0,
    review_count: 0,
    lapses: 0,
    is_suspended: false,
    tags: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  retrieveFromLibrary.mockResolvedValue({
    mode: "semantic",
    results: [
      {
        chunkId: "chunk-a",
        documentId: "paper-a",
        documentTitle: "Paper A",
        sourceType: "document",
        text: "Entropy is a measure of disorder in a closed system.",
        headingPath: ["Chapter 1"],
        score: 0.9,
        mode: "semantic",
      },
      {
        chunkId: "chunk-b",
        documentId: "paper-b",
        documentTitle: "Paper B",
        sourceType: "document",
        text: "Gibbs free energy determines reaction spontaneity.",
        headingPath: ["Chapter 2"],
        score: 0.86,
        mode: "semantic",
      },
    ],
  });
  searchLearningItemsBounded.mockResolvedValue([]);
  getDueLearningItemsBounded.mockResolvedValue([]);
  getReviewStatistics.mockResolvedValue({
    total_items: 0,
    total_reviews: 0,
    total_lapses: 0,
    avg_interval: 0,
    retention_estimate: 0,
    due_today: 0,
    due_week: 0,
    due_month: 0,
  });
  getExtracts.mockResolvedValue([]);
  getImageAssetById.mockResolvedValue(null);
  checkSemanticDuplicateCandidates.mockResolvedValue([]);
  recordAiProvenance.mockResolvedValue({});
  getLearningItemsByAcceptanceKey.mockResolvedValue([]);
});

describe("Learning Agent production integration", () => {
  it("keeps per-paper evidence, never attaches paper A to paper B, and saves approved rows only", async () => {
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-1",
      ownerRevision: 1,
      intent: "Cards from the attached papers",
      scope: "papers",
      documents: [
        { id: "paper-a", title: "Paper A", contentVersion: "a1" },
        { id: "paper-b", title: "Paper B", contentVersion: "b1" },
      ],
      primaryDocumentId: "paper-a",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const provider = new FakeAIProvider({
      kind: "ondevice",
      responses: [
        { requestId: "t1", text: JSON.stringify({ toolCalls: [{ tool: "search_library", input: { query: "entropy free energy" } }] }) },
        {
          requestId: "t2",
          text: JSON.stringify({
            toolCalls: [
              {
                tool: "propose_flashcard",
                sourceHandle: "s1",
                input: {
                  question: "What is entropy?",
                  answer: "A measure of disorder in a closed system.",
                  sourceHandle: "s1",
                  concept: "entropy",
                },
              },
              {
                tool: "propose_flashcard",
                input: {
                  question: "What determines reaction spontaneity?",
                  answer: "Gibbs free energy.",
                  sourceHandle: "s2",
                  concept: "free energy",
                },
              },
            ],
          }),
        },
        { requestId: "t3", text: JSON.stringify({ finalAnswer: "Two source-grounded cards proposed." }) },
      ],
    });
    const env = createFrozenAgentEnvironment(prepared.run);
    const outcome = await runLearningAgent(prepared.run, { provider, env, wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("final-answer");
    expect(outcome.result.proposals).toHaveLength(2);
    const [first, second] = outcome.result.proposals;
    expect(first.sourceRefs[0].handle).toBe("s1");
    expect(first.sourceRefs[0].documentId).toBe("paper-a");
    expect(second.sourceRefs[0].handle).toBe("s2");
    expect(second.sourceRefs[0].documentId).toBe("paper-b");
    expect(first.proposalId).toMatch(/p1$/);
    expect(second.proposalId).toMatch(/p2$/);

    const groups = await validateAgentProposalGroups(
      buildAgentProposalGroups(outcome.result.proposals)
    );
    expect(groups).toHaveLength(2);
    const rows = groups.flatMap((group) => group.cards);
    expect(rows.every((row) => row.status === "valid")).toBe(true);

    createLearningItemsBatch.mockImplementation(async (entries: Array<Record<string, unknown>>) =>
      entries.map((entry) => learningItem(`saved-${entry.proposal_id}`, String(entry.question), ""))
    );
    const saved = await saveAgentProposals({
      runId: "run-int-1",
      conversationId: "conv-1",
      provider: "fake",
      modelClass: "full",
      proposals: outcome.result.proposals,
      selected: rows.map((row) => ({ proposalId: row.proposalId, candidate: row.candidate })),
    });

    // Only the selected rows were saved, grouped per source (one batch each).
    expect(saved.saved).toHaveLength(2);
    expect(saved.failed).toHaveLength(0);
    const batchEntries = createLearningItemsBatch.mock.calls.flatMap(
      (call) => call[0] as Array<Record<string, unknown>>
    );
    expect(batchEntries).toHaveLength(2);
    const byQuestion = new Map(batchEntries.map((entry) => [entry.question, entry]));
    expect(byQuestion.get("What is entropy?")?.document_id).toBe("paper-a");
    expect(byQuestion.get("What determines reaction spontaneity?")?.document_id).toBe("paper-b");
    expect(byQuestion.get("What is entropy?")?.acceptance_id).toBe("run-int-1");
    expect(byQuestion.get("What is entropy?")?.proposal_id).toBe(first.proposalId);
    // Extract-less cards carry the existing serialized source envelope.
    expect(String(byQuestion.get("What is entropy?")?.source_reference)).toContain(
      '"document_id":"paper-a"'
    );
    expect(String(byQuestion.get("What determines reaction spontaneity?")?.source_reference)).toContain(
      '"document_id":"paper-b"'
    );
  });

  it("does not read the subsequently active global document", async () => {
    const preparedA = resolveLearningAgentScope({
      conversationId: "conv-switch",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A", contentVersion: "a1" }],
    });
    expect(preparedA.ok).toBe(true);
    if (!preparedA.ok) return;
    const envA = createFrozenAgentEnvironment(preparedA.run);
    const { useDocumentStore } = await import("../../../../stores/documentStore");
    useDocumentStore.setState({
      currentDocument: { id: "paper-b", title: "Paper B", fileType: "pdf" },
    } as never);
    expect(envA.getDocument()?.id).toBe("paper-a");
    expect(envA.listSources?.().map((source) => source.documentId)).toEqual(["paper-a"]);
  });

  it("returns a typed error on native failure without trying another destination", async () => {
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-3",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const provider = new FakeAIProvider({
      kind: "ondevice",
      responses: [new Error("native model unavailable")],
    });
    const env = createFrozenAgentEnvironment(prepared.run);
    const outcome = await runLearningAgent(prepared.run, {
      provider,
      env,
      wallClockMs: 2_000,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("error");
    expect(outcome.result.proposals).toHaveLength(0);
    // The provider is pinned: no second provider/destination was attempted.
    expect(provider.callCount).toBe(1);
  });

  it("stops before another model turn when the run deadline expires (no fallback)", async () => {
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-2",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    let calls = 0;
    const provider = new FakeAIProvider({
      kind: "ondevice",
      responses: [
        async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 150));
          return {
            requestId: `t${calls}`,
            text: JSON.stringify({ toolCalls: [{ tool: "get_current_document", input: {} }] }),
          };
        },
      ],
    });
    const env = createFrozenAgentEnvironment(prepared.run);
    const outcome = await runLearningAgent(prepared.run, {
      provider,
      env,
      wallClockMs: 40,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("timeout");
    expect(outcome.result.proposals).toHaveLength(0);
    expect(calls).toBe(1);
  });
});
