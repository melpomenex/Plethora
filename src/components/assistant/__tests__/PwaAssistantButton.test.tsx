import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../../test/utils";
import { PwaAssistantButton } from "../PwaAssistantButton";
import { useSettingsStore, useLLMProvidersStore } from "../../../stores";
import { runAssistantTurn } from "../../../lib/ai/assistant/orchestrator";

vi.mock("../../../lib/ai/assistant/orchestrator", () => ({
  runAssistantTurn: vi.fn().mockResolvedValue({
    scope: "chat",
    answer: "Mock answer",
    rawContent: "Mock answer",
    toolCalls: [],
    diagnostics: {},
  }),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
}));

describe("PwaAssistantButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          pwaVoiceAssistant: true,
          maxTokens: 50000,
          provider: "openai",
        },
      },
    }));

    useLLMProvidersStore.setState({
      providers: [
        {
          id: "p-openai",
          provider: "openai",
          name: "OpenAI",
          model: "gpt-4o",
          apiKey: "sk-test",
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096,
        },
      ],
    });
  });

  it("passes globalContextTokens to runAssistantTurn from settings.ai.maxTokens", async () => {
    renderWithProviders(
      <PwaAssistantButton
        enabled={true}
        side="right"
        context={{
          type: "video",
          documentId: "vid-1",
          content: "Transcript content",
        }}
      />
    );

    // Open sheet
    const openBtn = screen.getByRole("button", { name: /open voice assistant/i });
    fireEvent.click(openBtn);

    // Find input textarea
    const input = screen.getByPlaceholderText(/ask about this document/i);
    fireEvent.change(input, { target: { value: "Summarize this video" } });

    // Click Send
    const sendBtn = screen.getByTitle("Send");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(runAssistantTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          globalContextTokens: 50000,
          userQuestion: "Summarize this video",
        })
      );
    });
  });
});
