import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel, type AssistantContext } from "../AssistantPanel";
import { useLLMProvidersStore, useSettingsStore } from "../../../stores";
import * as policyModule from "../../../api/llm/policy";

const mocks = vi.hoisted(() => ({
  turn: vi.fn().mockResolvedValue({
    scope: "document",
    answer: "Mock answer",
    rawContent: "Mock answer",
    toolCalls: [],
    diagnostics: {},
  }),
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

describe("AssistantPanel Global Context & Video Parity", () => {
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
    });
  });

  it("wires globalContextTokens into resolveRequestPolicy and propagates completeTranscriptSource for video context", async () => {
    const policySpy = vi.spyOn(policyModule, "resolveRequestPolicy");

    const videoContext: AssistantContext = {
      type: "video",
      documentId: "vid-1",
      content: "Full transcript text...",
      metadata: { title: "Test Video" },
      resolveForPrompt: async () => ({
        status: "ready",
        content: "Full transcript text...",
        source: "document",
        coverage: "full",
      }),
    };

    render(<AssistantPanel conversationKey="doc:vid-1" context={videoContext} />);

    // Switch to Document scope
    fireEvent.click(await screen.findByRole("button", { name: /^Answer from:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^This document only/ }));

    // Type a prompt and send
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Summarize this video" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(policySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          globalContextTokens: 50000,
        })
      );
    });

    await waitFor(() => {
      expect(mocks.turn).toHaveBeenCalledWith(
        expect.objectContaining({
          configuredContextTokens: 50000,
          completeTranscriptSource: true,
          explicitSourceContent: false,
        })
      );
    });
  });
});
