import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel, type AssistantContext } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useSettingsStore } from "../../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
  turn: vi.fn(),
  getDoc: vi.fn(),
  tools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("../../../lib/ai/assistant/orchestrator", () => ({
  runAssistantTurn: mocks.turn,
}));

vi.mock("../../../api/documents", () => ({
  getDocument: mocks.getDoc,
  extractDocumentText: vi.fn().mockResolvedValue(""),
  getDocuments: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../api/mcp", () => ({
  getAppMCPTools: mocks.tools,
  callAppMCPTool: mocks.callTool,
}));

vi.mock("../../../lib/tauri", async (original) => ({
  ...await original<typeof import("../../../lib/tauri")>(),
  isTauri: () => false,
  isNativeMobile: () => false,
  invokeCommand: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../hooks/useComposerDictation", () => ({
  useComposerDictation: () => ({ phase: "idle", cancel: vi.fn(), onEdit: vi.fn(), disabled: true }),
}));

vi.mock("../mobile/MobileAssistantCommands", () => ({
  useAssistantCommandMatches: () => [],
  MobileAssistantCommands: () => null,
}));

describe("AssistantPanel Key Points End-to-End Action", () => {
  const videoTranscript = [
    "[00:05] Welcome to the comprehensive lecture on neural consciousness.",
    "[00:20] Early historical background and foundational philosophy of mind.",
    "[58:30] Midway turning point: The default mode network regulates introspective awareness.",
    "[1:58:15] Concluding insights: Future directions in neurotechnology and ethics.",
  ].join("\n");

  const videoContext: AssistantContext = {
    type: "video",
    documentId: "doc-video-pollan",
    content: videoTranscript,
    status: "ready",
    transcriptStatus: "ready-full",
    metadata: {
      title: "Michael Pollan on Consciousness",
      duration: 7200,
      videoId: "yt-pollan",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();

    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          provider: "openrouter",
          maxTokens: 50000,
        },
      },
    }));

    useLLMProvidersStore.setState({
      providers: [
        {
          id: "openrouter",
          provider: "openrouter",
          name: "OpenRouter",
          enabled: true,
          model: "anthropic/claude-3.5-sonnet",
          apiKey: "sk-or-test",
          maxTokens: 4096,
          temperature: 0.2,
        },
      ],
      customProviders: [],
      activeProviderId: "openrouter",
    });

    useDocumentStore.setState({
      documents: [
        {
          id: "doc-video-pollan",
          title: "Michael Pollan on Consciousness",
          content: videoTranscript,
          filePath: "https://www.youtube.com/watch?v=yt-pollan",
          fileType: "youtube",
        } as never,
      ],
      currentDocument: null,
    });

    mocks.getDoc.mockResolvedValue({
      id: "doc-video-pollan",
      title: "Michael Pollan on Consciousness",
      content: videoTranscript,
      filePath: "https://www.youtube.com/watch?v=yt-pollan",
      fileType: "youtube",
    });

    mocks.tools.mockResolvedValue([]);

    const expectedAnswer = [
      "Key takeaways from across the entire 2-hour lecture:",
      "- [00:05] Opening foundations: Historical perspectives on consciousness.",
      "- [58:30] Mid-lecture insight: Default mode network (DMN) function in ego boundaries.",
      "- [1:58:15] Concluding takeaway: Future ethical horizons in consciousness research.",
    ].join("\n");

    mocks.turn.mockResolvedValue({
      scope: "document",
      answer: expectedAnswer,
      rawContent: expectedAnswer,
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
    });
  });

  it("clicking 'Key points' in AssistantPanel runs whole-source action and renders takeaways from beginning, middle, and end of video", async () => {
    render(
      <AssistantPanel
        conversationKey="doc:video-pollan"
        selectedProvider="openrouter"
        context={videoContext}
        mobilePresentation={{ visible: true }}
        fillContainer={true}
        appendContextMessages={false}
      />
    );

    // Open context action menu ("Add to your message" / "+" button)
    const addActionBtn = screen.getByRole("button", { name: /add to your message/i });
    fireEvent.click(addActionBtn);

    // Find and click "Key points"
    const keyPointsBtn = screen.getByRole("button", { name: /^Key points ·/i });
    fireEvent.click(keyPointsBtn);

    // Verify runAssistantTurn was called with complete transcript source
    await waitFor(() => {
      expect(mocks.turn).toHaveBeenCalledOnce();
    });

    const callArgs = mocks.turn.mock.calls[0][0];
    expect(callArgs.action.actionId).toBe("key-points");
    expect(callArgs.completeTranscriptSource).toBe(true);
    expect(callArgs.globalContextTokens).toBe(50000);

    // Verify response text contains takeaways from beginning, middle, and end
    await waitFor(() => {
      expect(screen.getByText(/Key takeaways from across the entire 2-hour lecture/i)).toBeInTheDocument();
      expect(screen.getByText(/Opening foundations/i)).toBeInTheDocument();
      expect(screen.getByText(/Mid-lecture insight/i)).toBeInTheDocument();
      expect(screen.getByText(/Concluding takeaway/i)).toBeInTheDocument();
    });
  });
});
