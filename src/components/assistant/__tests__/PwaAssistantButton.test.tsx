import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, renderWithProviders, screen, waitFor } from "../../../test/utils";
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
    vi.mocked(runAssistantTurn).mockResolvedValue({
      scope: "chat",
      answer: "Mock answer",
      rawContent: "Mock answer",
      toolCalls: [],
      diagnostics: {},
    } as never);
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

  it("shows a live reply before completion and ignores a stopped late result", async () => {
    let finish!: (value: Awaited<ReturnType<typeof runAssistantTurn>>) => void;
    let signal!: AbortSignal;
    let turnCount = 0;
    const result = new Promise<Awaited<ReturnType<typeof runAssistantTurn>>>(resolve => { finish = resolve; });
    vi.mocked(runAssistantTurn).mockImplementation(async request => {
      turnCount += 1;
      signal = request.signal!;
      if (turnCount === 1) {
        request.onProgress?.("model");
        request.onPreview?.("Visible fragment");
        return result;
      }
      return { scope: "chat", answer: "Retry final response", rawContent: "Retry final response", toolCalls: [], diagnostics: {} } as Awaited<ReturnType<typeof runAssistantTurn>>;
    });

    renderWithProviders(
      <PwaAssistantButton enabled={true} side="right" context={{ type: "general", content: "" }} />
    );
    fireEvent.click(screen.getByRole("button", { name: /open voice assistant/i }));
    const input = screen.getByPlaceholderText(/ask about this document/i);
    fireEvent.change(input, { target: { value: "A general question" } });
    fireEvent.click(screen.getByTitle("Send"));

    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the model…");
    expect(screen.getByText("Visible fragment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal.aborted).toBe(true);

    await act(async () => {
      finish({ scope: "chat", answer: "Late final response", rawContent: "Late final response", toolCalls: [], diagnostics: {} } as Awaited<ReturnType<typeof runAssistantTurn>>);
    });
    expect(screen.queryByText("Late final response")).not.toBeInTheDocument();
    expect(document.querySelector("[data-pending-reply]")).toBeNull();

    fireEvent.change(input, { target: { value: "Retry question" } });
    fireEvent.click(screen.getByTitle("Send"));
    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Retry final response")).toBeInTheDocument();
    expect(screen.getAllByText("Retry final response")).toHaveLength(1);
  });
});
