import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithContext, type LLMProvider } from "../../../api/llm";
import {
  buildDocumentSections,
  convertEpubTocToSectionNodes,
  resolveSectionFocusedContext,
} from "../../../utils/sectionIndex";
import { createDocumentQaRequestContent, loadDocumentQaText } from "../sectionContextRequest";

const { mockInvokeCommand } = vi.hoisted(() => ({ mockInvokeCommand: vi.fn() }));

vi.mock("../../../lib/tauri", () => ({ invokeCommand: mockInvokeCommand }));

describe("Document Q&A focused-section provider boundary", () => {
  beforeEach(() => {
    mockInvokeCommand.mockReset();
    mockInvokeCommand.mockResolvedValue({ content: "grounded answer" });
  });

  it("falls back to extracted document text before section resolution", async () => {
    const getDocument = vi.fn().mockResolvedValue({ content: "" });
    const extractDocumentText = vi.fn().mockResolvedValue({ content: "# Extracted\nRecovered extraction body." });
    const content = await loadDocumentQaText("doc-pdf", { getDocument, extractDocumentText });
    expect(content).toContain("Recovered extraction body");
    expect(extractDocumentText).toHaveBeenCalledWith("doc-pdf");
  });

  it("uses persisted browser document text after restart without extraction fallback", async () => {
    const getDocument = vi.fn().mockResolvedValue({ content: "Persisted browser article body." });
    const extractDocumentText = vi.fn().mockResolvedValue({ content: "" });

    const content = await loadDocumentQaText("browser-doc", { getDocument, extractDocumentText });

    expect(content).toBe("Persisted browser article body.");
    expect(content).not.toContain("No text content available");
    expect(extractDocumentText).not.toHaveBeenCalled();
  });

  it("does not call a provider when focused context is unresolved", async () => {
    const fullContent = "# Available\nAvailable body.";
    const { flat } = buildDocumentSections(fullContent);
    const unresolved = {
      ...flat[0],
      id: "stale-missing",
      title: "Missing section",
      content: "",
      hasAuthoritativeRange: false,
    };
    const focused = resolveSectionFocusedContext([unresolved], flat, fullContent, { documentId: "doc-1" });
    if (focused.ok) {
      const request = createDocumentQaRequestContent({ documentContext: focused.content, userQuestion: "Question" });
      await chatWithContext("openai", "test-model", [{ role: "user", content: request.userPromptContent }], {
        type: "document",
        content: request.contextContent,
      });
    }
    expect(focused.ok).toBe(false);
    expect(mockInvokeCommand).not.toHaveBeenCalled();
  });

  it.each(["openai", "anthropic"] as LLMProvider[])(
    "sends the canonical section body in both LLM-facing fields for %s",
    async (provider) => {
      const fullContent = "# Overview\nGeneral material.\n# Evidence\nThe decisive body phrase is forty-two.\n# Appendix\nUnrelated notes.";
      const { flat } = buildDocumentSections(fullContent);
      const selected = flat.find((section) => section.title === "Evidence")!;
      const focused = resolveSectionFocusedContext([selected], flat, fullContent, {
        documentId: "doc-1",
        maxTokens: 1000,
      });
      expect(focused.ok).toBe(true);

      const documentContext = `Document: Test Paper\nFocused Section(s): ${focused.labels.join(", ")}\n\n${focused.content}`;
      const request = createDocumentQaRequestContent({
        documentContext,
        userQuestion: "What is the decisive result?",
        focusLabel: focused.labels.join(", "),
      });

      await chatWithContext(
        provider,
        "test-model",
        [{ role: "user", content: request.userPromptContent }],
        { type: "document", documentId: "doc-1", content: request.contextContent },
        "test-key",
      );

      expect(mockInvokeCommand).toHaveBeenCalledOnce();
      const [, args] = mockInvokeCommand.mock.calls[0];
      expect(args.provider).toBe(provider);
      expect(args.messages.at(-1).content).toContain("The decisive body phrase is forty-two.");
      expect(args.context.content).toContain("The decisive body phrase is forty-two.");
      expect(args.context.content).not.toBe("Evidence");
      expect(args.messages.at(-1).content.match(/The decisive body phrase is forty-two\./g)).toHaveLength(1);
      expect(args.context.content.match(/The decisive body phrase is forty-two\./g)).toHaveLength(1);
    },
  );

  it("keeps a non-opening EPUB chapter isolated for card creation", () => {
    const epubText = "<h1>Chapter One</h1><p>Opening material.</p><h1>Chapter Two</h1><p>Unique EPUB card source.</p><h1>Chapter Three</h1><p>Closing material.</p>";
    const { flat } = buildDocumentSections(epubText);
    const chapterTwo = flat.find((section) => section.title === "Chapter Two")!;
    const focused = resolveSectionFocusedContext([chapterTwo], flat, epubText, {
      documentId: "epub-1",
      maxTokens: 1000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(true);
    const request = createDocumentQaRequestContent({
      documentContext: focused.content,
      userQuestion: "Create Q&A and cloze cards",
      focusLabel: focused.labels.join(", "),
    });
    expect(request.userPromptContent).toContain("Unique EPUB card source");
    expect(request.contextContent).toContain("Unique EPUB card source");
    expect(request.contextContent).not.toContain("Opening material");
    expect(request.contextContent).not.toContain("Closing material");
  });

  it("resolves a deep EPUB outline chapter past a front-matter table of contents", () => {
    // Reproduces the reported bug: the user focuses
    // "Part Three > Chapter 11: DARWIN'S DELAY", but the chapter title also
    // appears in the book's front-matter table of contents. The model must
    // receive the chapter body, not the title-page/TOC text, and the request
    // must succeed on the first send (no "stale or ambiguous" abort).
    const fullText = [
      "Contents",
      "Part One: SEX, ROMANCE, AND LOVE",
      "Part Two: NATURAL SELECTION",
      "Part 3: SOCIAL STRIFE",
      "Chapter 11: DARWIN'S DELAY",
      "Chapter 12: A SECULAR PRIESTHOOD",
      "",
      "Part 3",
      "Chapter 11: DARWIN'S DELAY",
      "Darwin delayed publishing his theory for more than two decades. This is the real chapter body that the model must receive.",
      "Chapter 12: A SECULAR PRIESTHOOD",
      "Huxley and the clergy clashed over the implications of selection.",
    ].join("\n");
    const toc = convertEpubTocToSectionNodes([
      {
        label: "Part 3: SOCIAL STRIFE",
        subitems: [
          { label: "Chapter 11: DARWIN'S DELAY" },
          { label: "Chapter 12: A SECULAR PRIESTHOOD" },
        ],
      },
    ] as never);
    const { flat } = buildDocumentSections(fullText, toc);
    const chapter = flat.find((section) => section.title === "Chapter 11: DARWIN'S DELAY")!;

    const focused = resolveSectionFocusedContext([chapter], flat, fullText, {
      documentId: "epub-deep",
      maxTokens: 2000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(true);
    const request = createDocumentQaRequestContent({
      documentContext: focused.content,
      userQuestion: "Summarize this chapter.",
      focusLabel: focused.labels.join(", "),
    });
    expect(request.userPromptContent).toContain("Darwin delayed publishing his theory");
    expect(request.contextContent).toContain("Darwin delayed publishing his theory");
    // The front-matter table of contents must not be what the model receives.
    expect(request.contextContent).not.toMatch(/^Contents$/m);
  });
});
