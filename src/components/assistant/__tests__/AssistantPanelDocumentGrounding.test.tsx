import { AIError } from "../../../lib/ai/errors";
import { askLibrary } from "../../../lib/ai/tasks/definitions/libraryTask";
vi.mock("../../../lib/ai/tasks/definitions/libraryTask", () => ({ askLibrary: vi.fn() }));
/**
 * Document-scope grounding regression (`fix-document-mode-grounding`):
 * whole-document requests must use the document's own evidence — the canonical
 * full text when it fits the prompt budget, otherwise the resolved window with
 * honest partial-coverage disclosure — never a library-empty answer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel, type AssistantContext } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { chatWithContext } from "../../../api/llm";

const { fullDocumentText } = vi.hoisted(() => ({
  fullDocumentText:
    "The complete canonical document text about attention, queries, keys, and values.",
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

vi.mock("../../../api/llm", () => ({
  chatWithContext: vi.fn(),
  streamChatWithLLM: vi.fn(),
}));

vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue({ id: "doc-1", title: "Attention", content: fullDocumentText }),
  extractDocumentText: vi.fn().mockResolvedValue({ content: fullDocumentText }),
}));

vi.mock("../../../features/documentQa/sectionContextRequest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/documentQa/sectionContextRequest")>()),
  loadDocumentQaText: vi.fn().mockResolvedValue(fullDocumentText),
}));

function seedProviders() {
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
}

function windowedContext(contextWindowTokens: number): AssistantContext {
  return {
    type: "document",
    documentId: "doc-1",
    content: "Window-only text around the reader position.",
    contextWindowTokens,
    status: "ready",
    source: "document",
    metadata: { title: "Attention" },
    resolveForPrompt: async () => ({
      status: "ready",
      content: "Window-only text around the reader position.",
      source: "document",
      coverage: "window",
    }),
  };
}

async function askSummarizeDocument() {
  render(<AssistantPanel context={windowedContext(2000)} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Answer from:/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^This document only/ }));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "summarize this document" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

describe("AssistantPanel Document-scope grounding", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
    vi.mocked(chatWithContext).mockReset();
    vi.mocked(chatWithContext).mockResolvedValue({ content: "A grounded summary." } as never);
  });

  it("presents a library generation failure with existing retry and AI Settings actions", async () => {
    vi.mocked(askLibrary).mockRejectedValueOnce(new AIError("InvalidStructuredOutput", "PRIVATE", { generation: { stage: "generation", evidenceCount: 2, retrievalMode: "semantic" }, completion: { attemptCount: 2, terminalFailureKind: "empty-response" } }));
    render(<AssistantPanel context={windowedContext(2000)} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Answer from:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^My library/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "What are the main themes in my library?" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await screen.findByText(/Sources were found, but the AI model returned no answer/);
    expect(screen.getByRole("button", { name: "AI settings" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
  });

  it("answers a summary from the canonical full text when it fits the budget", async () => {
    await askSummarizeDocument();

    await waitFor(() => expect(chatWithContext).toHaveBeenCalled());
    const [provider, , messages, context] = vi.mocked(chatWithContext).mock.calls[0];
    expect(provider).toBe("openai");
    expect(context.scope).toBe("document");
    expect(String(context.content)).toContain("complete canonical document text");
    expect(String((messages as Array<{ content: string }>)[0].content)).not.toContain("SOURCE COVERAGE LIMIT");
    expect(screen.getByText("A grounded summary.")).toBeInTheDocument();
  });

  it("keeps the window and discloses partial coverage when the full text does not fit", async () => {
    render(<AssistantPanel context={windowedContext(5)} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Answer from:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^This document only/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "summarize this document" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(chatWithContext).toHaveBeenCalled());
    const [, , messages, context] = vi.mocked(chatWithContext).mock.calls[0];
    expect(String(context.content)).toContain("Window-only text around the reader position.");
    expect(String(context.content)).toContain("Source Coverage: window");
    expect(String((messages as Array<{ content: string }>)[0].content)).toContain("SOURCE COVERAGE LIMIT");
  });

  it("never returns the library-empty answer while the document text is available", async () => {
    await askSummarizeDocument();

    await waitFor(() => expect(chatWithContext).toHaveBeenCalled());
    expect(screen.queryByText(/library does not appear to contain material/i)).not.toBeInTheDocument();
  });
});
