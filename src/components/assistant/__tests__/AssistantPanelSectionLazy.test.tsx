import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import * as documentsApi from "../../../api/documents";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useStudyDeckStore } from "../../../stores/studyDeckStore";

const llmMocks = vi.hoisted(() => ({
  chatWithContext: vi.fn(),
}));

const mcpMocks = vi.hoisted(() => ({
  getTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("../../../api/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/llm")>();
  return {
    ...actual,
    chatWithContext: llmMocks.chatWithContext,
  };
});

vi.mock("../../../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...actual,
    getDocument: vi.fn().mockResolvedValue({ id: "doc-1", content: "# One\nbody" }),
    extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
  };
});

vi.mock("../../../api/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/mcp")>();
  return {
    ...actual,
    getIncrementumMCPTools: mcpMocks.getTools,
    callIncrementumMCPTool: mcpMocks.callTool,
  };
});

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn().mockResolvedValue([]) };
});

describe("AssistantPanel # section index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    llmMocks.chatWithContext.mockResolvedValue({ content: "Scoped answer" });
    mcpMocks.getTools.mockResolvedValue([
      { name: "create_qa_card", description: "Create a Q&A card", inputSchema: {} },
    ]);
    mcpMocks.callTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ success: true, id: "card-008" }) }],
    });
    useDocumentStore.setState({ documents: [], currentDocument: null });
    useStudyDeckStore.setState({ decks: [], activeDeckIds: [] });
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
  });

  it("does not fetch full document text until the input is focused", async () => {
    const { container } = render(
      <AssistantPanel context={{ type: "document", documentId: "doc-1", content: "# One\nbody" }} />,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(documentsApi.getDocument).not.toHaveBeenCalled();

    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    await waitFor(() => expect(documentsApi.getDocument).toHaveBeenCalledWith("doc-1"));
  });

  it("lists authoritative transcript-backed chapters without parsing document headings", async () => {
    const chapter = {
      id: "media-section-origins",
      title: "The First Principle",
      level: 1,
      breadcrumb: ["Transcript"],
      preview: "Chapter-scoped transcript evidence",
      content: "Chapter-scoped transcript evidence only.",
      children: [],
      parentId: null,
      source: "media-transcript" as const,
      documentId: "doc-1",
    };
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "unstructured full transcript",
          sections: [chapter],
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "#" } });

    expect(await screen.findByText("The First Principle")).toBeTruthy();
    expect(documentsApi.getDocument).not.toHaveBeenCalled();
  });

  it("sends only the selected transcript chapter as LLM context", async () => {
    const sections = [
      {
        id: "media-section-first",
        title: "The First Principle",
        level: 1,
        breadcrumb: ["Transcript"],
        preview: "First chapter evidence",
        content: "FIRST_CHAPTER_ONLY evidence for the answer.",
        children: [],
        parentId: null,
        source: "media-transcript" as const,
        documentId: "doc-1",
      },
      {
        id: "media-section-second",
        title: "A Different Chapter",
        level: 1,
        breadcrumb: ["Transcript"],
        preview: "Other evidence",
        content: "SECOND_CHAPTER_MUST_NOT_LEAK.",
        children: [],
        parentId: null,
        source: "media-transcript" as const,
        documentId: "doc-1",
      },
    ];
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "WHOLE_TRANSCRIPT_MUST_NOT_REPLACE_THE_SELECTION",
          sections,
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "#" } });
    fireEvent.click(await screen.findByText("The First Principle"));
    fireEvent.change(textarea, {
      target: { value: "#{The First Principle} What claim is made?" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalledTimes(1));
    const llmContext = llmMocks.chatWithContext.mock.calls[0][3] as { content: string };
    expect(llmContext.content).toContain("FIRST_CHAPTER_ONLY");
    expect(llmContext.content).not.toContain("SECOND_CHAPTER_MUST_NOT_LEAK");
    expect(llmContext.content).not.toContain("WHOLE_TRANSCRIPT_MUST_NOT_REPLACE_THE_SELECTION");
  });

  it("keeps audiobook chapter 008 focused while the user continues typing", async () => {
    const chapter = {
      id: "media-section-008",
      title: "008",
      level: 1,
      breadcrumb: ["Transcript"],
      preview: "Chapter eight evidence",
      content: "CHAPTER_008_ONLY neocortex evidence for the cards.",
      children: [],
      parentId: null,
      source: "media-transcript" as const,
      documentId: "doc-1",
    };
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "FOREWORD_MUST_NOT_REPLACE_CHAPTER_008",
          sections: [chapter],
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "#008" } });
    fireEvent.click(await screen.findByText("008"));

    // Two ordinary edits after insertion reproduce the global-RegExp lastIndex
    // failure: the first test() found the token and the second used to resume
    // after it, falsely clearing the selected SectionNode.
    fireEvent.change(textarea, { target: { value: "#{008} Create" } });
    fireEvent.change(textarea, { target: { value: "#{008} Create flashcards" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalledTimes(1));
    const llmContext = llmMocks.chatWithContext.mock.calls[0][3] as { content: string };
    expect(llmContext.content).toContain("CHAPTER_008_ONLY");
    expect(llmContext.content).not.toContain("FOREWORD_MUST_NOT_REPLACE_CHAPTER_008");
  });

  it("uses the submitted 008 chip even if pick-time selection state is missing", async () => {
    const chapter = {
      id: "media-section-008",
      title: "008",
      level: 1,
      breadcrumb: ["Transcript"],
      preview: "Chapter eight evidence",
      content: "CHAPTER_008_ONLY cortical-column evidence for the cards.",
      children: [],
      parentId: null,
      source: "media-transcript" as const,
      documentId: "doc-1",
    };
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "FOREWORD_MUST_NEVER_BE_THE_FALLBACK",
          sections: [chapter],
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    // Enter the serialized chip directly to model the exact production state:
    // the message renders Transcript > 008, but selectedSectionNodes is empty.
    fireEvent.change(textarea, {
      target: { value: "#{008} create a set of flashcards for this section" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(llmMocks.chatWithContext).toHaveBeenCalledTimes(1));
    const llmContext = llmMocks.chatWithContext.mock.calls[0][3] as { content: string };
    expect(llmContext.content).toContain("CHAPTER_008_ONLY");
    expect(llmContext.content).not.toContain("FOREWORD_MUST_NEVER_BE_THE_FALLBACK");
  });

  it("saves generated cards into the database-resolved audiobook title deck", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      id: "doc-1",
      title: "A New Theory of Intelligence",
      content: "Chapter-scoped transcript",
    } as never);
    llmMocks.chatWithContext.mockResolvedValue({
      content: `\`\`\`tool_calls\n{"tool_calls":[{"name":"create_qa_card","arguments":{"question":"What is a cortical column?","answer":"A repeating neocortical processing unit."}}]}\n\`\`\``,
    });

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "Chapter-scoped transcript",
          // Intentionally omit metadata.title: this was the audiobook bug.
        }}
      />,
    );

    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());
    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.change(textarea, { target: { value: "Create one flashcard" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(mcpMocks.callTool).toHaveBeenCalledTimes(1));
    expect(mcpMocks.callTool).toHaveBeenCalledWith("create_qa_card", expect.objectContaining({
      document_id: "doc-1",
      tags: ["deck:A New Theory of Intelligence"],
    }));
    await waitFor(() => {
      expect(useStudyDeckStore.getState().decks).toContainEqual(expect.objectContaining({
        name: "A New Theory of Intelligence",
        documentId: "doc-1",
        filterType: "all",
      }));
    });
  });

  it("does not save a document card unassigned when its deck title cannot be resolved", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      id: "doc-1",
      content: "Chapter-scoped transcript",
    } as never);
    llmMocks.chatWithContext.mockResolvedValue({
      content: `\`\`\`tool_calls\n{"tool_calls":[{"name":"create_qa_card","arguments":{"question":"Q","answer":"A"}}]}\n\`\`\``,
    });

    render(
      <AssistantPanel context={{ type: "document", documentId: "doc-1", content: "Chapter-scoped transcript" }} />,
    );
    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());
    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.change(textarea, { target: { value: "Create one flashcard" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect((await screen.findAllByText(/card was not saved without its document deck/i)).length).toBeGreaterThan(0);
    expect(mcpMocks.callTool).not.toHaveBeenCalled();
  });

  it("renders Podcast-style batch cards as the shared collection with a deck action", async () => {
    mcpMocks.getTools.mockResolvedValue([
      { name: "batch_create_cards", description: "Create multiple flashcards", inputSchema: {} },
    ]);
    llmMocks.chatWithContext.mockResolvedValue({
      content: `\`\`\`tool_calls\n${JSON.stringify({
        tool_calls: [{
          name: "batch_create_cards",
          arguments: {
            cards: [
              { type: "qa", question: "Question one?", answer: "Answer one." },
              { type: "qa", question: "Question two?", answer: "Answer two." },
            ],
          },
        }],
      })}\n\`\`\``,
    });
    mcpMocks.callTool.mockResolvedValue({
      isError: false,
      content: [{
        type: "text",
        text: JSON.stringify({
          created: 2,
          results: [
            { success: true, id: "podcast-card-1" },
            { success: true, id: "podcast-card-2" },
          ],
        }),
      }],
    });

    render(
      <AssistantPanel
        context={{
          type: "document",
          content: "Podcast transcript content",
          metadata: { title: "Podcast Episode" },
        }}
      />,
    );
    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());
    const textarea = screen.getByPlaceholderText(/Ask about your document/i);
    fireEvent.change(textarea, { target: { value: "Create two flashcards" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("region", { name: "2 created flashcards" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open deck Podcast Episode" })).toBeInTheDocument();
    expect(screen.getByText(/Created 2 flashcards and saved to your library/i)).toBeInTheDocument();
    expect(screen.queryByText("batch_create_cards")).not.toBeInTheDocument();
  });

  it("repairs the document deck for previously saved untagged Assistant cards", async () => {
    localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify({
      "document:doc-1": {
        input: "",
        updatedAt: 1,
        messages: [{
          id: "assistant-old",
          role: "assistant",
          content: "Created cards",
          timestamp: 1,
          toolCalls: [{
            name: "create_qa_card",
            parameters: { question: "Q", answer: "A", document_id: "doc-1" },
            status: "success",
            result: { id: "legacy-untagged-card" },
          }],
        }],
      },
    }));

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-1",
          content: "Transcript",
          metadata: { title: "A New Theory of Intelligence" },
        }}
      />,
    );

    await waitFor(() => {
      expect(useStudyDeckStore.getState().decks).toContainEqual(expect.objectContaining({
        name: "A New Theory of Intelligence",
        documentId: "doc-1",
        filterType: "all",
      }));
    });
  });

  it("resizes through the shared accessible handle and reports the host width", async () => {
    const onWidthChange = vi.fn();
    localStorage.setItem("assistant-panel-width", "400");
    render(<AssistantPanel onWidthChange={onWidthChange} />);
    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());

    const separator = screen.getByRole("separator", { name: "Resize Assistant panel" });
    expect(separator).toHaveAttribute("aria-valuenow", "400");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });

    expect(onWidthChange).toHaveBeenCalledWith(424);
    expect(separator).toHaveAttribute("aria-valuenow", "424");
    expect(localStorage.getItem("assistant-panel-width")).toBe("424");
  });

  it("fills a mobile host without exposing a desktop resize handle", async () => {
    const { container } = render(<AssistantPanel fillContainer />);
    await waitFor(() => expect(mcpMocks.getTools).toHaveBeenCalled());

    expect(screen.queryByRole("separator", { name: "Resize Assistant panel" })).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveStyle({ width: "100%" });
  });
});
