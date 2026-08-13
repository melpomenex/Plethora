import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import * as documentsApi from "../../../api/documents";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

const llmMocks = vi.hoisted(() => ({
  chatWithContext: vi.fn(),
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
});
