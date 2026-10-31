/**
 * E2E acceptance matrix (change 10.3, S1–S16): the priority scenario
 * (fixture document + section + protocol-perfect and protocol-failing
 * provider variants) exercising freeze → preflight selection → seat →
 * validated turn recovery → proposals render → approve subset → only
 * approved saved with provenance, plus negatives (unrecoverable malformed → 
 * agent-protocol; rejected tool call gains nothing; failed generation never
 * marked success).
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
import { SYNTHETIC_SECTION } from "../../__fixtures__/agentProtocolFixtures";
import { clearFeatureDiagnostics, getFeatureSummary } from "../../diagnostics";
import { resolveLearningAgentScope, runLearningAgent } from "../learningAgent";
import { buildAgentProposalGroups, saveAgentProposals, validateAgentProposalGroups } from "../learningAgentAcceptance";

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
  clearFeatureDiagnostics();
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

function sectionRun() {
  const prepared = resolveLearningAgentScope({
    conversationId: "conv-e2e",
    ownerRevision: 1,
    intent: "Cards from this section",
    scope: "section",
    documents: [{ id: "paper-a", title: "Paper A", contentVersion: "a1" }],
    section: {
      documentId: SYNTHETIC_SECTION.documentId,
      title: SYNTHETIC_SECTION.title,
      text: SYNTHETIC_SECTION.text,
      locator: SYNTHETIC_SECTION.locator,
    },
  });
  expect(prepared.ok).toBe(true);
  return (prepared as { ok: true; run: Parameters<typeof runLearningAgent>[0] }).run;
}

describe("E2E acceptance matrix (S1–S16)", () => {
  it("priority scenario: seeded run → grounded proposals → approved subset saved with provenance", async () => {
    const run = sectionRun();
    const provider = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({
            toolCalls: [
              {
                tool: "propose_flashcard",
                input: {
                  question: "What is entropy?",
                  answer: "A measure of disorder.",
                  sourceHandle: "s1",
                },
              },
              {
                tool: "propose_flashcard",
                input: {
                  question: "What did Landauer show?",
                  answer: "Erasure dissipates kT ln2.",
                  sourceHandle: "s1",
                },
              },
            ],
          }),
        },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "Two cards proposed." }) },
      ],
    });

    const outcome = await runLearningAgent(run, {
      provider,
      wallClockMs: 10_000,
      guard: () => null,
    });

    expect(outcome.result.endReason).toBe("final-answer");
    expect(outcome.result.proposals).toHaveLength(2);
    // Seat: first turn cited the seeded handle without a retrieval round trip.
    expect(outcome.result.proposals[0].sourceRefs[0].handle).toBe("s1");
    expect(outcome.result.proposals[0].sourceRefs[0].documentId).toBe("paper-entropy");
    expect(outcome.result.diagnostics?.evidence.handleCount).toBeGreaterThanOrEqual(1);

    // Approval flow: only the selected subset is saved, with provenance.
    createLearningItemsBatch.mockImplementation(async (entries: Array<Record<string, unknown>>) =>
      entries.map((entry) => learningItem(`saved-${entry.proposal_id}`, String(entry.question), ""))
    );
    const groups = await validateAgentProposalGroups(
      buildAgentProposalGroups(outcome.result.proposals)
    );
    const rows = groups.flatMap((group) => group.cards);
    const saved = await saveAgentProposals({
      runId: run.runId,
      conversationId: "conv-e2e",
      provider: "fake",
      modelClass: "full",
      proposals: outcome.result.proposals,
      selected: [{
        proposalId: rows[0].proposalId,
        candidate: rows[0].candidate,
      }],
    });
    expect(saved.saved).toHaveLength(1);
    expect(saved.failed).toHaveLength(0);
    const batchEntries = createLearningItemsBatch.mock.calls.flatMap(
      (call) => call[0] as Array<Record<string, unknown>>
    );
    expect(batchEntries).toHaveLength(1);
    expect(batchEntries[0].proposal_id).toBe(rows[0].proposalId);
    expect(String(batchEntries[0].source_reference)).toContain('"document_id":"paper-entropy"');
    expect(batchEntries[0].acceptance_id).toBe(run.runId);
  });

  it("unrecoverable malformed response → agent-protocol, never success", async () => {
    const run = sectionRun();
    const provider = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "t1", text: "garbage" },
        { requestId: "t2", text: "garbage" },
        { requestId: "t3", text: "garbage" },
        { requestId: "t4", text: "garbage" },
      ],
    });
    const outcome = await runLearningAgent(run, {
      provider,
      wallClockMs: 10_000,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("agent-protocol");
    expect(outcome.result.proposals).toHaveLength(0);
    expect(getFeatureSummary("learning-agent", "rev-1")?.stages.generation?.outcome).toBe(
      "incomplete"
    );
  });

  it("a rejected tool call gains nothing (no proposals, no success)", async () => {
    const run = sectionRun();
    const provider = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({ toolCalls: [{ tool: "delete_all_cards", input: {} }] }),
        },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "done" }) },
      ],
    });
    const outcome = await runLearningAgent(run, {
      provider,
      wallClockMs: 10_000,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("final-answer");
    expect(outcome.result.proposals).toHaveLength(0);
    // The rejected call was attempted but never executed.
    expect(outcome.result.toolCalls).toBe(1);
    expect(outcome.result.trace.some((entry) => entry.outcome === "rejected")).toBe(true);
  });
});
