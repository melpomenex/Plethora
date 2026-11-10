import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel, type AssistantContext } from "../AssistantPanel";
import { useLLMProvidersStore, useSettingsStore } from "../../../stores";

const mocks = vi.hoisted(() => ({
  turn: vi.fn(),
}));

vi.mock("../../../lib/ai/assistant/orchestrator", () => ({
  runAssistantTurn: mocks.turn,
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue({ id: "vid-1", title: "Test Video", content: "Full transcript" }),
  extractDocumentText: vi.fn().mockResolvedValue({ content: "Full transcript" }),
  getDocuments: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../api/mcp", () => ({
  getAppMCPTools: vi.fn().mockResolvedValue([]),
  callAppMCPTool: vi.fn(),
}));

describe("AssistantPanel Coverage Badge and Turn Diagnostics", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    vi.clearAllMocks();

    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          provider: "openai",
          maxTokens: 50000,
        },
      },
    }));

    useLLMProvidersStore.setState({
      providers: [
        {
          id: "openai",
          provider: "openai",
          name: "OpenAI",
          apiKey: "sk-test",
          model: "gpt-4o",
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096,
        },
      ],
      customProviders: [],
      activeProviderId: "openai",
    });
  });

  it("renders 'Full transcript · 2h 00m · Direct context' badge for direct full transcript turns", async () => {
    mocks.turn.mockResolvedValueOnce({
      scope: "document",
      answer: "Key takeaways from consciousness lecture.",
      rawContent: "Key takeaways from consciousness lecture.",
      toolCalls: [],
      sourceCoverage: "full",
      turnDiagnostics: {
        configuredContextTokens: 50000,
        effectiveContextTokens: 49000,
        promptBudgetTokens: 45000,
        reservedOutputTokens: 4000,
        estimatedSourceTokens: 25000,
        sourceTokensIncluded: 25000,
        sourceCoverage: "full",
        windowCount: 1,
        processingMode: "direct",
      },
      diagnostics: {
        scope: "document",
        provider: "openai",
        policy: { configuredContextTokens: 50000, promptBudgetTokens: 45000, outputReserveTokens: 4000 },
        tokenBreakdown: { systemTokens: 500, historyTokens: 0, memoryTokens: 0, sourceTokens: 25000, userTokens: 10 },
        sourceStatus: { type: "video", status: "ready", coverage: "full", chunkCount: 1 },
        historyCount: { verbatimMessages: 0, summarizedMessages: 0 },
      },
    });

    const videoContext: AssistantContext = {
      type: "video",
      documentId: "vid-1",
      content: "00:00 Introduction\nFull 2h transcript",
      status: "ready",
      transcriptStatus: "ready-full",
      metadata: {
        title: "Michael Pollan on Consciousness",
        duration: 7200,
      },
    };

    render(<AssistantPanel conversationKey="doc:vid-1" context={videoContext} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Key points of the lecture" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      const badge = screen.getByTestId("assistant-coverage-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("Full transcript · 2h 00m · Direct context");
    });
  });

  it("renders 'Full transcript · 2h 00m · Analyzed in sections' badge for hierarchical map-reduce turns", async () => {
    mocks.turn.mockResolvedValueOnce({
      scope: "document",
      answer: "Hierarchical summary of the long video.",
      rawContent: "Hierarchical summary of the long video.",
      toolCalls: [],
      sourceCoverage: "hierarchical-full",
      turnDiagnostics: {
        configuredContextTokens: 16384,
        effectiveContextTokens: 16000,
        promptBudgetTokens: 14000,
        reservedOutputTokens: 2000,
        estimatedSourceTokens: 35000,
        sourceTokensIncluded: 12000,
        sourceCoverage: "hierarchical-full",
        windowCount: 18,
        processingMode: "hierarchical",
      },
      diagnostics: {
        scope: "document",
        provider: "openai",
        policy: { configuredContextTokens: 16384, promptBudgetTokens: 14000, outputReserveTokens: 2000 },
        tokenBreakdown: { systemTokens: 500, historyTokens: 0, memoryTokens: 0, sourceTokens: 12000, userTokens: 10 },
        sourceStatus: { type: "video", status: "ready", coverage: "hierarchical-full", chunkCount: 18 },
        historyCount: { verbatimMessages: 0, summarizedMessages: 0 },
      },
    });

    const videoContext: AssistantContext = {
      type: "video",
      documentId: "vid-1",
      content: "00:00 Introduction\nFull 2h transcript",
      status: "ready",
      transcriptStatus: "ready-full",
      metadata: {
        title: "Michael Pollan on Consciousness",
        duration: 7200,
      },
    };

    render(<AssistantPanel conversationKey="doc:vid-1" context={videoContext} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Key points of the lecture" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      const badge = screen.getByTestId("assistant-coverage-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("Full transcript · 2h 00m · Analyzed in sections");
    });
  });
});
