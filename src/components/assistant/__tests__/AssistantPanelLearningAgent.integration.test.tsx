/**
 * Production entry integration: Assistant submit → frozen envelope → real
 * adapter/loop with a fake provider → real candidate validation → existing
 * domain batch writer (mocked at the API boundary). This test does NOT mock
 * `runLearningAgent`; only provider readiness and external APIs are injected.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAssistantTurn = vi.hoisted(() => vi.fn());
const preflightLearningAgent = vi.hoisted(() => vi.fn());
const retrieveFromLibrary = vi.hoisted(() => vi.fn());
const searchLearningItemsBounded = vi.hoisted(() => vi.fn());
const createLearningItemsBatch = vi.hoisted(() => vi.fn());
const checkSemanticDuplicateCandidates = vi.hoisted(() => vi.fn());
const recordAiProvenance = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/ai/assistant/orchestrator", () => ({ runAssistantTurn }));
vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../lib/ai/features/useFeatureReadiness", () => ({
  useFeatureReadiness: () => ({
    rows: [
      {
        featureId: "learning-agent",
        enabled: true,
        status: "ready",
        checkedAt: Date.now(),
        checking: false,
        dependencyRevision: "rev-1",
        dependencies: [],
        operations: [],
        recoveryActions: [],
        limitations: [],
      },
    ],
    context: null,
    loading: false,
    checkedAt: Date.now(),
    revision: "rev-1",
    refresh: vi.fn(),
  }),
}));
vi.mock("../../../lib/ai/assistant/learningAgentHandoff", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../lib/ai/assistant/learningAgentHandoff")
  >();
  return {
    ...actual,
    learningAgentAvailability: () => ({ available: true, reason: "ready" }),
  };
});
vi.mock("../../../lib/ai/assistant/learningAgent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ai/assistant/learningAgent")>();
  return { ...actual, preflightLearningAgent };
});
vi.mock("../../../api/ai-learning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/ai-learning")>();
  return { ...actual, retrieveFromLibrary };
});
vi.mock("../../../api/learning-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/learning-items")>();
  return {
    ...actual,
    searchLearningItemsBounded,
    createLearningItemsBatch,
    checkSemanticDuplicateCandidates,
  };
});
vi.mock("../../../api/ai-provenance", () => ({ recordAiProvenance }));

import { AssistantPanel } from "../AssistantPanel";
import { FakeAIProvider } from "../../../lib/ai/__fixtures__/FakeAIProvider";
import { useDocumentStore } from "../../../stores/documentStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

const SOURCE = "Entropy is a measure of disorder in a closed system.";
const documentRecord = {
  id: "paper-a",
  title: "Paper A",
  fileType: "pdf",
  contentHash: "hash-a",
  tags: [],
  dateAdded: "",
  dateModified: "2026-01-01T00:00:00Z",
  extractCount: 0,
  learningItemCount: 0,
  priorityRating: 0,
  prioritySlider: 0,
  priorityScore: 0,
  isArchived: false,
  isFavorite: false,
};

function provider() {
  return new FakeAIProvider({
    kind: "ondevice",
    responses: [
      {
        requestId: "t1",
        text: JSON.stringify({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
      },
      {
        requestId: "t2",
        text: JSON.stringify({
          toolCalls: [
            {
              tool: "propose_flashcard",
              input: {
                question: "What is entropy?",
                answer: "A measure of disorder in a closed system.",
                sourceHandle: "s1",
                concept: "entropy",
              },
            },
          ],
        }),
      },
      { requestId: "t3", text: JSON.stringify({ finalAnswer: "One grounded proposal." }) },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "openai-cfg",
        provider: "openai",
        name: "OpenAI",
        apiKey: "sk-test",
        model: "gpt-4o",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
    ],
  });
  useDocumentStore.setState({
    documents: [documentRecord],
    currentDocument: null,
  } as never);
  const fake = provider();
  preflightLearningAgent.mockResolvedValue({
    ok: true,
    status: "ready",
    capabilityRevision: "rev-1",
    provider: fake,
    kind: "ondevice",
    providerId: fake.id,
    generation: {
      providerClass: "unknown",
      locality: "device",
      keyless: true,
      billable: false,
      sendsOffDevice: false,
      requiresDisclosure: false,
      requiresCostConsent: false,
    },
    embedding: {
      destination: {
        providerClass: "unknown",
        locality: "device",
        keyless: true,
        billable: false,
        sendsOffDevice: false,
        requiresDisclosure: false,
        requiresCostConsent: false,
      },
      authorized: true,
    },
    blockers: [],
    limitations: [],
    destinationChangeRequiresConsent: false,
  });
  retrieveFromLibrary.mockResolvedValue({
    mode: "semantic",
    results: [
      {
        chunkId: "chunk-a",
        documentId: "paper-a",
        documentTitle: "Paper A",
        sourceType: "document",
        text: SOURCE,
        headingPath: ["Chapter 1"],
        score: 0.9,
        mode: "semantic",
      },
    ],
  });
  searchLearningItemsBounded.mockResolvedValue([]);
  checkSemanticDuplicateCandidates.mockResolvedValue([]);
  recordAiProvenance.mockResolvedValue({});
  createLearningItemsBatch.mockImplementation(async (entries: Array<Record<string, unknown>>) =>
    entries.map((entry) => ({
      id: `saved-${entry.proposal_id}`,
      question: entry.question,
      item_type: "Qa",
      state: "New",
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
    }))
  );
});

const context = {
  type: "document" as const,
  documentId: "paper-a",
  content: "Paper content",
  status: "ready" as const,
  source: "document",
  metadata: { title: "Paper A" },
};

describe("Assistant submit → real agent adapter → domain writer", () => {
  it("produces and saves only the reviewed, source-grounded candidate", async () => {
    render(<AssistantPanel context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(
      () => expect(screen.getByText("Learning Agent proposals")).toBeInTheDocument(),
      { timeout: 10_000 }
    );
    expect(runAssistantTurn).not.toHaveBeenCalled();
    expect(screen.getByText("What is entropy?")).toBeInTheDocument();
    // Clicking the example set the input, so clear it is not part of this
    // path; send must have consumed it.
    expect(screen.getByRole("button", { name: /Save selected \(1\)/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /Save selected \(1\)/i }));
    await waitFor(() => expect(createLearningItemsBatch).toHaveBeenCalled(), {
      timeout: 10_000,
    });
    const entries = createLearningItemsBatch.mock.calls.flatMap(
      (call) => call[0] as Array<Record<string, unknown>>
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].document_id).toBe("paper-a");
    expect(entries[0].acceptance_id).toEqual(expect.stringMatching(/^lagent-/));
    expect(entries[0].proposal_id).toEqual(expect.stringMatching(/:p1$/));
    expect(String(entries[0].source_reference)).toContain('"document_id":"paper-a"');
  }, 20_000);
});
