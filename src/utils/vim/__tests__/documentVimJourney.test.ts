import { afterEach, describe, expect, it, vi } from "vitest";
import { useVimModeStore } from "../../../stores/vimModeStore";
import type { VimActionContext } from "../actions";
import { DocumentVimEngine } from "../DocumentVimEngine";
import { EpubV2Adapter } from "../epubV2Adapter";
import { PdfV2Adapter } from "../pdfV2Adapter";
import type { EpubVimRuntime, PdfVimRuntime } from "../readerRuntimes";

const key = (value: string) => new KeyboardEvent("keydown", { key: value });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const context = (create: VimActionContext["createInstantExtract"]): VimActionContext => ({ documentId: "doc", getSelectedText: () => "", getPageNumber: () => 1, getSelectionContext: () => null, createInstantExtract: create, openExtractDialog: vi.fn(), openFlashcardStudio: vi.fn(), clearTextSelection: vi.fn() });

describe("EPUB/PDF V2 keyboard journeys", () => {
  afterEach(() => useVimModeStore.getState().deactivate());

  it("navigates across PDF pages, selects, extracts, and exits", async () => {
    const runtime: PdfVimRuntime = { documentId: "doc", pageCount: 2, currentPageNumber: () => 1, loadPageText: async (page) => [{ str: page === 1 ? "one two" : "three four", transform: [1,0,0,10,0,100], width: 40, height: 10 }], revealPage: async () => {}, textLayer: () => null, pageSelectionContext: () => null, subscribe: () => () => {} };
    const create = vi.fn(async () => ({ id: "extract" })); const engine = new DocumentVimEngine(new PdfV2Adapter(runtime), () => context(create));
    await engine.activate(); engine.handleKeyDown(key("2")); engine.handleKeyDown(key("w")); await settle();
    expect(useVimModeStore.getState().cursorPosition).toMatchObject({ kind: "pdf", pageNumber: 2 });
    engine.handleKeyDown(key("v")); engine.handleKeyDown(key("w")); await settle(); engine.handleKeyDown(key("Enter")); await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ selectionContext: expect.objectContaining({ type: "pdf" }) }));
    engine.handleKeyDown(key("Escape")); expect(useVimModeStore.getState().mode).toBe("inactive"); engine.dispose();
  });

  it("navigates across EPUB sections and creates an exact CFI extract", async () => {
    const docs = ["one two", "three four"].map((text) => new DOMParser().parseFromString(`<p>${text}</p>`, "text/html"));
    const runtime: EpubVimRuntime = { documentId: "doc", currentSpineIndex: () => 0, currentCfi: () => null, currentWindow: () => window, sections: docs.map((doc, spineIndex) => ({ spineIndex, href: `${spineIndex}`, load: async () => doc, cfiForElement: (_el, edge) => `cfi-${spineIndex}-${edge}`, cfiForTextOffset: (_el, offset) => `cfi-${spineIndex}-${offset}`, cfiForRange: async (start, end) => `range-${spineIndex}-${start}-${end}` })), reveal: async () => {}, rangeFromCfi: () => null, cfiFromRange: () => "range", subscribe: () => () => {} };
    const create = vi.fn(async () => ({ id: "extract" })); const engine = new DocumentVimEngine(new EpubV2Adapter(runtime), () => context(create));
    await engine.activate(); engine.handleKeyDown(key("2")); engine.handleKeyDown(key("w")); await settle();
    expect(useVimModeStore.getState().cursorPosition).toMatchObject({ kind: "epub", spineIndex: 1 });
    engine.handleKeyDown(key("v")); engine.handleKeyDown(key("w")); await settle(); engine.handleKeyDown(key("Enter")); await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ selectionContext: expect.objectContaining({ type: "epub", cfiRanges: expect.any(Array) }) })); engine.dispose();
  });
});
