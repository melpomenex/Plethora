import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useDocumentStore } from "../../../stores/documentStore";
import * as documentsApi from "../../../api/documents";
import { ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY } from "../../../features/assistant/assistantMessageFlashcards";

const llmMocks = vi.hoisted(() => ({
  chatWithContext: vi.fn(),
}));

const mcpMocks = vi.hoisted(() => ({
  getTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("../../../api/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/llm")>();
  return { ...actual, chatWithContext: llmMocks.chatWithContext };
});

vi.mock("../../../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...actual,
    getDocument: vi.fn().mockResolvedValue({ id: "doc-1", title: "Group Theory Video", content: "Full document text should not replace assistant answer." }),
    extractDocumentText: vi.fn().mockResolvedValue({ content: "Full document text should not replace assistant answer." }),
  };
});

vi.mock("../../../api/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/mcp")>();
  return {
    ...actual,
    getAppMCPTools: mcpMocks.getTools,
    callAppMCPTool: mcpMocks.callTool,
  };
});

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

const ASSISTANT_CONVERSATIONS_KEY = "assistant-panel-conversations-v1";

function seedProviders() {
  useLLMProvidersStore.setState({
    providers: [{
      id: "openai-test",
      provider: "openai",
      name: "OpenAI",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      enabled: true,
      temperature: 0.2,
      maxTokens: 4096,
    }],
  });
}

function seedConversation(
  messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; timestamp: number }>,
  conversationKey = "document:doc-1",
) {
  localStorage.setItem(ASSISTANT_CONVERSATIONS_KEY, JSON.stringify({
    [conversationKey]: {
      messages,
      input: "",
      updatedAt: Date.now(),
    },
  }));
}

describe("AssistantPanel message flashcard action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
    useDocumentStore.setState({
      documents: [{ id: "doc-1", title: "Group Theory Video", content: "doc" } as never],
      currentDocument: null,
    });
    mcpMocks.getTools.mockResolvedValue([
      { name: "create_qa_card", description: "Create Q&A", inputSchema: {} },
      { name: "create_cloze_card", description: "Create cloze", inputSchema: {} },
    ]);
    mcpMocks.callTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ success: true, id: "card-1" }) }],
    });
    llmMocks.chatWithContext.mockResolvedValue({
      content: '```tool_calls\n{"tool_calls":[{"name":"create_qa_card","arguments":{"question":"Q","answer":"A"}}]}\n```',
    });
  });

  it("shows Flashcards action for assistant answers but not user messages", () => {
    seedConversation([
      { id: "user-1", role: "user", content: "Explain RoPE", timestamp: 1 },
      { id: "assistant-1", role: "assistant", content: "RoPE uses rotations.", timestamp: 2 },
    ]);
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          metadata: { title: "Group Theory Video" },
          resolveForPrompt: async () => ({
            status: "ready",
            content: "Full document text should not replace assistant answer.",
            source: "document",
          }),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /create flashcards from this response/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy to clipboard/i, hidden: false })).toBeTruthy();
  });

  it("does not show Flashcards on confirmation messages", () => {
    seedConversation([
      { id: "assistant-confirm-1", role: "assistant", content: "Created 2 flashcards and saved to your library.", timestamp: 1 },
    ]);
    render(<AssistantPanel context={{ type: "document", documentId: "doc-1" }} />);
    expect(screen.queryByRole("button", { name: /create flashcards from this response/i })).not.toBeInTheDocument();
  });

  it("uses the clicked older assistant message as source with empty history", async () => {
    seedConversation([
      { id: "user-1", role: "user", content: "Explain RoPE", timestamp: 1 },
      { id: "assistant-rope", role: "assistant", content: "UNIQUE_ROPE_SOURCE_TEXT", timestamp: 2 },
      { id: "user-2", role: "user", content: "Explain group theory", timestamp: 3 },
      { id: "assistant-group", role: "assistant", content: "UNIQUE_GROUP_SOURCE_TEXT", timestamp: 4 },
    ]);

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          metadata: { title: "Group Theory Video" },
          resolveForPrompt: async () => ({
            status: "ready",
            content: "Full document text should not replace assistant answer.",
            source: "document",
          }),
        }}
      />,
    );

    const ropeRow = screen.getByText("UNIQUE_ROPE_SOURCE_TEXT").closest(".group");
    expect(ropeRow).toBeTruthy();
    const flashcardsButton = within(ropeRow as HTMLElement).getByRole("button", {
      name: /create flashcards from this response/i,
    });
    fireEvent.click(flashcardsButton);

    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalledTimes(1));
    const [provider, model, messages, llmContext] = llmMocks.chatWithContext.mock.calls[0];
    expect(provider).toBe("openai");
    expect(model).toBe("gpt-4o-mini");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toMatch(/20 Rules|Knowledge Formulation/i);
    expect(messages[1].role).toBe("user");
    expect(llmContext.content).toBe("UNIQUE_ROPE_SOURCE_TEXT");
    expect(llmContext.content).not.toContain("UNIQUE_GROUP_SOURCE_TEXT");
    expect(llmContext.documentId).toBe("doc-1");
    expect(String(messages[1].content)).toMatch(/source material|Assistant response context/i);
    expect(screen.getByText(/create flashcards from this response/i)).toBeInTheDocument();
  });

  it("preserves document deck tagging from captured context", async () => {
    seedConversation([
      { id: "assistant-1", role: "assistant", content: "Groups are sets with an operation.", timestamp: 1 },
    ]);

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          metadata: { title: "Group Theory Video" },
        }}
      />,
    );

    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /create flashcards from this response/i }));
    await waitFor(() => expect(mcpMocks.callTool).toHaveBeenCalled());
    expect(mcpMocks.callTool).toHaveBeenCalledWith("create_qa_card", expect.objectContaining({
      document_id: "doc-1",
      tags: ["deck:Group Theory Video"],
    }));
  });

  it("prevents duplicate generation while loading", async () => {
    let resolveLlm: (value: { content: string }) => void = () => {};
    llmMocks.chatWithContext.mockImplementation(() => new Promise((resolve) => {
      resolveLlm = resolve;
    }));

    seedConversation([
      { id: "assistant-1", role: "assistant", content: "Atomic answer.", timestamp: 1 },
    ], "general");
    render(<AssistantPanel />);

    const button = screen.getByRole("button", { name: /create flashcards from this response/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalledTimes(1));
    resolveLlm({ content: "No tools" });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("action row is visible without hover-only opacity on small screens", () => {
    seedConversation([
      { id: "assistant-1", role: "assistant", content: "Visible actions test.", timestamp: 1 },
    ], "general");
    const { container } = render(<AssistantPanel />);
    const actionRow = container.querySelector('[class*="opacity-100"][class*="sm:opacity-0"]');
    expect(actionRow).toBeTruthy();
  });

  it("normal composer send still works", async () => {
    render(<AssistantPanel context={{ type: "document", documentId: "doc-1", content: "Doc body" }} />);
    llmMocks.chatWithContext.mockResolvedValue({ content: "Composer reply" });
    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.change(textarea, { target: { value: "Hello assistant" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByText("Composer reply")).toBeInTheDocument());
  });

  it("typed /20rules still works", async () => {
    render(<AssistantPanel context={{ type: "document", documentId: "doc-1", content: "Photosynthesis details" }} />);
    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.change(textarea, { target: { value: "/20rules" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalled());
    const messages = llmMocks.chatWithContext.mock.calls[0][2] as Array<{ role: string; content: string }>;
    expect(messages.some((m) => String(m.content).toLowerCase().includes("20 rules") || String(m.content).includes("/20rules"))).toBe(true);
  });
});
