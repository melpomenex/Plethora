import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SectionNode } from "../../../utils/sectionIndex";

const sectionHookState = vi.hoisted(() => ({
  tree: [] as SectionNode[],
  flat: [] as SectionNode[],
}));

vi.mock("../../../hooks/useDocumentSections", () => ({
  useDocumentSections: () => ({
    tree: sectionHookState.tree,
    flat: sectionHookState.flat,
    getById: (id: string) => sectionHookState.flat.find((section) => section.id === id),
  }),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue({ content: "" }),
  extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
}));
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/mcp", () => ({
  getAppMCPTools: vi.fn().mockResolvedValue([]),
  callAppMCPTool: vi.fn(),
}));
vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: () => false, invokeCommand: vi.fn().mockResolvedValue(null) };
});

import { FlashcardStudioModal } from "../FlashcardStudioModal";
import { useDocumentStore } from "../../../stores/documentStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useStudyDeckStore } from "../../../stores/studyDeckStore";

const node = (
  id: string,
  title: string,
  options: Partial<SectionNode> & { children?: SectionNode[] } = {},
): SectionNode => ({
  id,
  documentId: "doc-1",
  title,
  level: options.level ?? 1,
  content: options.content ?? `content ${title}`,
  source: options.source ?? "text",
  preview: options.preview ?? `content ${title}`,
  parentId: options.parentId ?? null,
  breadcrumb: options.breadcrumb ?? [],
  children: options.children ?? [],
});

const chapter = node("chapter-1", "Chapter 1", {
  level: 2,
  parentId: "part-1",
  breadcrumb: ["Part One"],
});
const part = node("part-1", "Part One", { children: [chapter] });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  sectionHookState.tree = [part];
  sectionHookState.flat = [part, chapter];
  useDocumentStore.setState({
    documents: [{
      id: "doc-1",
      title: "The Moral Animal",
      filePath: "/fixture/moral-animal.md",
      fileType: "markdown",
      content: "# Part One\n\n## Chapter 1\n\nBody",
    } as never],
    currentDocument: null,
    hasCompletedFirstLoad: true,
    loadDocuments: (async () => {}) as never,
  });
  useLLMProvidersStore.setState({
    providers: [{
      id: "provider-1",
      provider: "openai",
      name: "Test provider",
      apiKey: "test-key",
      model: "test-model",
      enabled: true,
      temperature: 0.2,
      maxTokens: 1000,
    }],
  });
  useStudyDeckStore.setState({ decks: [], activeDeckIds: [] });
});

describe("Flashcard Studio section picker", () => {
  it("opens the # outline and keeps the Studio open when Escape dismisses it", async () => {
    const onClose = vi.fn();
    render(
      <FlashcardStudioModal
        isOpen
        onClose={onClose}
        seed={{ key: "section-picker-test", documentId: "doc-1" }}
      />,
    );

    const input = await screen.findByPlaceholderText(
      "What flashcards should I create from the selected context?",
    );
    fireEvent.change(input, { target: { value: "#", selectionStart: 1 } });

    const list = await screen.findByRole("listbox", { name: "Sections" });
    const picker = list.closest("[data-section-picker]") as HTMLElement;
    expect(picker.parentElement).toBe(document.body);
    expect(picker).toHaveStyle({ zIndex: "9991" });
    expect(within(list).getByText("Part One")).toBeInTheDocument();
    expect(within(list).queryByText("Chapter 1")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Sections" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
