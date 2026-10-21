import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAssistantTurn = vi.hoisted(() => vi.fn());
const runLearningAgent = vi.hoisted(() => vi.fn());
const preflightLearningAgent = vi.hoisted(() => vi.fn());
const checkSemanticDuplicateCandidates = vi.hoisted(() => vi.fn());

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
  return {
    ...actual,
    preflightLearningAgent,
    runLearningAgent,
  };
});
vi.mock("../../../api/learning-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/learning-items")>();
  return {
    ...actual,
    checkSemanticDuplicateCandidates,
  };
});
vi.mock("../../extracts/CreateExtractDialog", () => ({
  CreateExtractDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Create extract</div> : null,
}));

import { AssistantPanel } from "../AssistantPanel";
import { useDocumentStore } from "../../../stores/documentStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { resetLearningAgentModeForTests, requestLearningAgentMode } from "../../../lib/ai/assistant/learningAgentHandoff";
import type { AgentProposal } from "../../../lib/ai/agent/tools/types";

const sourceText = "Entropy is a measure of disorder in a closed system.";
const proposal: AgentProposal = {
  kind: "flashcard",
  proposalId: "run-panel:p1",
  question: "What is entropy?",
  answer: "A measure of disorder in a closed system.",
  cardType: "qa",
  concept: "entropy",
  conceptKeys: ["entropy"],
  sourceText,
  evidenceQuote: sourceText,
  sourceRevision: "rev-1",
  sourceRefs: [
    {
      handle: "s1",
      refId: "chunk-a",
      kind: "chunk",
      documentId: "paper-a",
      title: "Paper A",
      locator: "Chapter 1",
      text: sourceText,
      sourceRevision: "rev-1",
    },
  ],
  createdAt: 1,
} as AgentProposal;

const preflight = {
  ok: true,
  status: "ready",
  capabilityRevision: "rev-1",
  provider: { id: "fake-ondevice", kind: "ondevice" },
  kind: "ondevice",
  providerId: "fake-ondevice",
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
};

function seed() {
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
    documents: [
      {
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
      },
      {
        id: "paper-b",
        title: "The Extended Phenotype: The Long Reach of the Gene",
        fileType: "epub",
        contentHash: "hash-b",
        tags: [],
        dateAdded: "",
        dateModified: "2026-01-02T00:00:00Z",
        extractCount: 0,
        learningItemCount: 0,
        priorityRating: 0,
        prioritySlider: 0,
        priorityScore: 0,
        isArchived: false,
        isFavorite: false,
      },
    ],
    currentDocument: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLearningAgentModeForTests();
  Element.prototype.scrollTo = vi.fn();
  seed();
  preflightLearningAgent.mockResolvedValue(preflight);
  checkSemanticDuplicateCandidates.mockResolvedValue([]);
  runAssistantTurn.mockResolvedValue({ rawContent: "ordinary chat answer" });
  runLearningAgent.mockImplementation(async (run) => ({
    run,
    result: {
      answer: "Here are source-grounded proposals.",
      endReason: "final-answer",
      proposals: [proposal],
      sources: proposal.sourceRefs,
      trace: [],
      turns: 2,
      toolCalls: 2,
      providerId: "fake-ondevice",
      providerKind: "ondevice",
    },
    deadline: { dispose: vi.fn(), signal: new AbortController().signal },
    durationMs: 5,
  }));
});

const context = {
  type: "document" as const,
  documentId: "paper-a",
  content: "Paper content",
  status: "ready" as const,
  source: "document",
  metadata: { title: "Paper A" },
};

describe("AssistantPanel Learning Agent mode", () => {
  it("keeps ordinary chat on its existing path", async () => {
    render(<AssistantPanel context={context} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Summarize this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalled());
    expect(runLearningAgent).not.toHaveBeenCalled();
  });

  it("enters the explicit agent mode and routes submit only through the adapter", async () => {
    render(<AssistantPanel context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    expect(document.querySelector("[data-learning-agent-composer]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(runLearningAgent).toHaveBeenCalledTimes(1));
    expect(runAssistantTurn).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("Learning Agent proposals")).toBeInTheDocument()
    );
    expect(screen.getAllByText("Paper A").length).toBeGreaterThan(0);
    const [run, options] = runLearningAgent.mock.calls[0];
    expect(run.conversationId).toBe("document:paper-a");
    expect(run.retrievalDocumentIds).toEqual(["paper-a"]);
    expect(options.provider.id).toBe("fake-ondevice");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("shows Stop during a run and suppresses proposals after cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    runLearningAgent.mockImplementation(
      (run, options) =>
        new Promise((resolve) => {
          observedSignal = options.signal;
          options.signal.addEventListener("abort", () =>
            resolve({
              run,
              result: {
                answer: "",
                endReason: "cancelled",
                explanation: "The run was cancelled.",
                proposals: [],
                sources: [],
                trace: [],
                turns: 1,
                toolCalls: 0,
              },
              deadline: { dispose: vi.fn(), signal: options.signal },
              durationMs: 1,
            })
          );
        })
    );
    render(<AssistantPanel context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(observedSignal?.aborted).toBe(true));
    expect(screen.queryByText("Learning Agent proposals")).toBeNull();
  });

  it("opens in agent mode from the palette handoff without sending a request", async () => {
    requestLearningAgentMode();
    render(<AssistantPanel context={context} />);
    await waitFor(() =>
      expect(document.querySelector("[data-learning-agent-composer]")).not.toBeNull()
    );
    expect(runLearningAgent).not.toHaveBeenCalled();
    expect(runAssistantTurn).not.toHaveBeenCalled();
  });

  it("exposes the same explicit mode in the mobile presentation", async () => {
    render(
      <AssistantPanel
        context={context}
        conversationKey="mobile:global"
        mobilePresentation={{ visible: true }}
        fillContainer
        appendContextMessages={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    expect(document.querySelector("[data-learning-agent-composer]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(runLearningAgent).toHaveBeenCalledTimes(1));
    expect(runAssistantTurn).not.toHaveBeenCalled();
  });

  it("aborts the run when the conversation changes", async () => {
    let observedSignal: AbortSignal | undefined;
    runLearningAgent.mockImplementation(
      (run, options) =>
        new Promise((resolve) => {
          observedSignal = options.signal;
          options.signal.addEventListener("abort", () =>
            resolve({
              run,
              result: {
                answer: "",
                endReason: "cancelled",
                explanation: "The run was cancelled.",
                proposals: [],
                sources: [],
                trace: [],
                turns: 1,
                toolCalls: 0,
              },
              deadline: { dispose: vi.fn(), signal: options.signal },
              durationMs: 1,
            })
          );
        })
    );
    const { rerender } = render(
      <AssistantPanel context={context} conversationKey="conv-a" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(observedSignal).toBeDefined());
    rerender(<AssistantPanel context={context} conversationKey="conv-b" />);
    await waitFor(() => expect(observedSignal?.aborted).toBe(true));
    expect(screen.queryByText("Learning Agent proposals")).toBeNull();
  });

  it("explains a blocked preflight without starting a run", async () => {
    preflightLearningAgent.mockResolvedValue({
      ok: false,
      status: "setup-required",
      capabilityRevision: "rev-1",
      blockers: [
        {
          code: "no-model",
          message: "No permitted AI generation route is ready.",
          recovery: "ai.providers",
        },
      ],
      limitations: [],
      destinationChangeRequiresConsent: false,
    });
    render(<AssistantPanel context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloze quiz on this paper" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByText(/No permitted AI generation route is ready/)).toBeInTheDocument()
    );
    expect(runLearningAgent).not.toHaveBeenCalled();
  });

  it("attaches sources from a searchable picker that stays inside the viewport", async () => {
    render(<AssistantPanel context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning Agent" }));
    fireEvent.click(screen.getByRole("button", { name: /Attach document/ }));

    const picker = await screen.findByRole("dialog", { name: "Attach document" });
    expect(picker).toHaveClass("adaptive-dialog-panel");
    // The current reader document is implicit and must not be duplicated.
    expect(document.querySelector('[data-agent-source-option="paper-a"]')).toBeNull();

    const search = screen.getByRole("searchbox", { name: /Search documents/ });
    fireEvent.change(search, { target: { value: "extended" } });
    expect(document.querySelector('[data-agent-source-option="paper-a"]')).toBeNull();

    const option = document.querySelector<HTMLButtonElement>(
      '[data-agent-source-option="paper-b"]'
    )!;
    fireEvent.click(option);
    expect(option).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector('[data-agent-source-chip="paper-b"]')).not.toBeNull();
    // Multi-select stays open so several sources can be added in one pass.
    expect(screen.getByRole("dialog", { name: "Attach document" })).toBeInTheDocument();

    // The same row toggles the source back off without closing the picker.
    fireEvent.click(option);
    expect(option).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('[data-agent-source-chip="paper-b"]')).toBeNull();

    fireEvent.click(option);
    expect(document.querySelector('[data-agent-source-chip="paper-b"]')).not.toBeNull();

    fireEvent.change(search, { target: { value: "no matching title" } });
    expect(screen.getByText("No documents found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Attach document" })).toBeNull();
  });
});
