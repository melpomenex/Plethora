import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithContext, type LLMProvider } from "../../../api/llm";
import { buildDocumentSections, resolveSectionFocusedContext } from "../../../utils/sectionIndex";
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
});
