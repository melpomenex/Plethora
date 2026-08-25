import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAssistantAppleFmChat } from "../assistantAppleFmChat";
import { useSettingsStore } from "../../../../stores/settingsStore";

const generateStreamMock = vi.fn();

vi.mock("../../providers/appleFoundationProvider", () => ({
  APPLE_FOUNDATION_PROVIDER_ID: "ondevice-apple-foundation",
  getAppleFoundationProvider: () => ({
    getCapabilities: vi.fn().mockResolvedValue({
      textGeneration: true,
      contextTokens: 4096,
    }),
    generateStream: generateStreamMock,
  }),
}));

function enableAppleFoundationModels() {
  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      features: { ...state.settings.features, appleFoundationModels: true },
    },
  }));
}

describe("runAssistantAppleFmChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableAppleFoundationModels();
    generateStreamMock.mockResolvedValue({
      requestId: "assistant-1",
      text: "The mitochondria is the powerhouse of the cell.",
    });
  });

  it("builds a prompt with history and document context", async () => {
    await runAssistantAppleFmChat({
      systemInstruction: "You are a helpful reading assistant.",
      userPrompt: "What is this about?",
      documentContext: "Cells contain mitochondria.",
      conversationHistory: [
        { role: "user", content: "Summarize this." },
        { role: "assistant", content: "It is about cells." },
      ],
    });

    expect(generateStreamMock).toHaveBeenCalledTimes(1);
    const request = generateStreamMock.mock.calls[0][0];
    expect(request.text).toContain("Document context:");
    expect(request.text).toContain("Cells contain mitochondria.");
    expect(request.text).toContain("Previous conversation:");
    expect(request.text).toContain("User: Summarize this.");
    expect(request.text).toContain("Assistant: It is about cells.");
    expect(request.text).toContain("Current question: What is this about?");
    expect(request.systemInstruction).toBe("You are a helpful reading assistant.");
  });

  it("returns content from generateStream", async () => {
    const result = await runAssistantAppleFmChat({
      systemInstruction: "You are a helpful reading assistant.",
      userPrompt: "Explain mitochondria.",
      documentContext: "Mitochondria generate ATP.",
      conversationHistory: [],
    });

    expect(result.content).toBe("The mitochondria is the powerhouse of the cell.");
  });
});
