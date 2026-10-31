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

  it("adds the card tool contract and caps the response budget", async () => {
    generateStreamMock.mockResolvedValueOnce({
      requestId: "cards-1",
      text: '```tool_calls\n[{"name":"create_qa_card","arguments":{"front":"Why?","back":"Because."}}]\n```',
    });

    const result = await runAssistantAppleFmChat({
      systemInstruction: "You are a helpful reading assistant.",
      userPrompt: "Make flashcards from this document.",
      documentContext: "The heart pumps blood.",
      conversationHistory: [],
      maxOutputTokens: 4096,
    });

    expect(generateStreamMock).toHaveBeenCalledTimes(1);
    const request = generateStreamMock.mock.calls[0][0];
    expect(request.systemInstruction).toContain("CARD TOOL CONTRACT");
    expect(request.maxOutputTokens).toBe(1024);
    expect(result.content).toContain('"name":"create_qa_card"');
  });

  it("repairs invalid card output with a tolerant line format", async () => {
    generateStreamMock
      .mockResolvedValueOnce({
        requestId: "cards-1",
        text: '```tool_calls\n[{"name":"create_cloze_card","arguments":{}}]\n```',
      })
      .mockResolvedValueOnce({
        requestId: "cards-2",
        text: "Q: What pumps blood?\nA: The heart.\nCLOZE: The {{c1::heart}} pumps blood.",
      });

    const result = await runAssistantAppleFmChat({
      systemInstruction: "You are a helpful reading assistant.",
      userPrompt: "/20rules Make five flashcards from this document.",
      documentContext: "The heart pumps blood.",
      conversationHistory: [],
    });

    expect(generateStreamMock).toHaveBeenCalledTimes(2);
    expect(generateStreamMock.mock.calls[1][0].systemInstruction).toContain("Output ONLY these lines");
    expect(result.content).toContain('"name":"batch_create_cards"');
    expect(result.content).toContain('"type":"qa"');
    expect(result.content).toContain('"type":"cloze"');
  });

  it("does not repair card output when the first response is usable", async () => {
    generateStreamMock.mockResolvedValueOnce({
      requestId: "cards-1",
      text: '```tool_calls\n[{"name":"create_qa_card","arguments":{"question":"Q","answer":"A"}}]\n```',
    });

    await runAssistantAppleFmChat({
      systemInstruction: "You are a helpful reading assistant.",
      userPrompt: "Make flashcards from this document.",
      documentContext: "The heart pumps blood.",
      conversationHistory: [],
    });

    expect(generateStreamMock).toHaveBeenCalledTimes(1);
  });
});
