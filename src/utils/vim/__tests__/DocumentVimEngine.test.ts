import { afterEach, describe, expect, it, vi } from "vitest";
import { useVimModeStore } from "../../../stores/vimModeStore";
import type { VimActionContext } from "../actions";
import { DocumentVimEngine } from "../DocumentVimEngine";
import { orderDocumentRange, type PdfDocumentPosition } from "../documentModel";
import type { DocumentVimAdapter } from "../documentAdapter";

const pos = (itemIndex: number): PdfDocumentPosition => ({ kind: "pdf", pageNumber: 1, itemIndex, charOffset: itemIndex * 5, affinity: "forward", quote: { exact: `w${itemIndex}` } });

function adapter(): DocumentVimAdapter {
  return {
    documentId: "pdf-1",
    capabilities: async () => ({ textNavigation: true, visualSelection: true, crossBoundarySelection: true, exactSourceRange: true }),
    initialPosition: async () => pos(0), resolvePosition: async (position) => position,
    compare: (a, b) => (a as PdfDocumentPosition).itemIndex - (b as PdfDocumentPosition).itemIndex,
    move: async (from, request) => ({ position: pos(Math.max(0, (from as PdfDocumentPosition).itemIndex + (request.motion === "word-backward" ? -request.count : request.count))), desiredX: request.desiredX ?? 2 }),
    reveal: async () => {}, geometry: async () => ({ rect: new DOMRect(10, 20, 30, 15), mounted: true, surfaceId: "page-1" }),
    positionFromPoint: async () => pos(0),
    rangeContent: async () => ({ text: "selected", selectionContext: { type: "pdf", documentId: "pdf-1", pages: [] } }),
    lineRange: async (position) => orderDocumentRange(position, pos((position as PdfDocumentPosition).itemIndex + 2)),
    renderRange: async () => {},
    snapshot: async (range) => Object.freeze({ documentId: "pdf-1", text: "selected", range, selectionContext: { type: "pdf" as const, documentId: "pdf-1", pages: [] }, createdAt: 1 }),
    invalidate: () => {}, subscribeInvalidation: () => () => {}, dispose: () => {},
  };
}

function actionContext(createInstantExtract = vi.fn(async () => ({ id: "extract-1" }))): VimActionContext {
  return {
    documentId: "pdf-1", getSelectedText: () => "", getPageNumber: () => 1, getSelectionContext: () => null,
    createInstantExtract, openExtractDialog: vi.fn(), openFlashcardStudio: vi.fn(), clearTextSelection: vi.fn(), setLastExtractId: vi.fn(),
  };
}

const key = (value: string) => new KeyboardEvent("keydown", { key: value });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DocumentVimEngine", () => {
  afterEach(() => { useVimModeStore.getState().deactivate(); document.querySelectorAll(".vim-v2-caret").forEach((node) => node.remove()); });

  it("activates with a stable position and renders the caret", async () => {
    const engine = new DocumentVimEngine(adapter(), () => actionContext());
    expect(await engine.activate()).toBe(true);
    expect(useVimModeStore.getState().cursorPosition).toEqual(pos(0));
    expect(document.querySelector(".vim-v2-caret")).not.toBeNull();
    engine.dispose();
  });

  it("applies counts and preserves desired column for vertical motion", async () => {
    const engine = new DocumentVimEngine(adapter(), () => actionContext()); await engine.activate();
    engine.handleKeyDown(key("3")); engine.handleKeyDown(key("j")); await settle();
    expect(useVimModeStore.getState().cursorPosition).toEqual(pos(3));
    expect(useVimModeStore.getState().desiredColumn).toBe(2);
    engine.dispose();
  });

  it("creates a canonical visual snapshot and returns to range start", async () => {
    const create = vi.fn(async () => ({ id: "extract-1" }));
    const engine = new DocumentVimEngine(adapter(), () => actionContext(create)); await engine.activate();
    useVimModeStore.getState().setMode("visual");
    useVimModeStore.getState().setSelectionRange(orderDocumentRange(pos(0), pos(2)));
    engine.handleKeyDown(key("Enter")); await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ text: "selected", selectionContext: expect.objectContaining({ type: "pdf" }) }));
    expect(useVimModeStore.getState()).toMatchObject({ mode: "normal", cursorPosition: pos(0), selectionRange: null });
    engine.dispose();
  });

  it("preserves a visual range when an action fails", async () => {
    const engine = new DocumentVimEngine(adapter(), () => actionContext(vi.fn(async () => { throw new Error("Offline"); }))); await engine.activate();
    const range = orderDocumentRange(pos(0), pos(2)); useVimModeStore.getState().setMode("visual"); useVimModeStore.getState().setSelectionRange(range);
    engine.handleKeyDown(key("Enter")); await settle();
    expect(useVimModeStore.getState().selectionRange).toEqual(range);
    expect(useVimModeStore.getState().feedback).toMatchObject({ kind: "error" });
    engine.dispose();
  });

  it("ignores a stale slow motion after a newer motion commits", async () => {
    const mock = adapter();
    let resolveFirst!: (value: { position: PdfDocumentPosition; desiredX: number | null }) => void;
    let calls = 0;
    mock.move = async () => ++calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : { position: pos(4), desiredX: null };
    const engine = new DocumentVimEngine(mock, () => actionContext()); await engine.activate();
    engine.handleKeyDown(key("w")); engine.handleKeyDown(key("w")); await settle(); resolveFirst({ position: pos(1), desiredX: null }); await settle();
    expect(useVimModeStore.getState().cursorPosition).toEqual(pos(4)); engine.dispose();
  });

  it("adopts pointer clicks without disturbing reader chrome", async () => {
    const mock = adapter(); mock.positionFromPoint = async () => pos(5);
    const engine = new DocumentVimEngine(mock, () => actionContext()); await engine.activate();
    const surface = document.createElement("div"); document.body.appendChild(surface);
    await engine.handlePointerUp(new MouseEvent("mouseup", { clientX: 8, clientY: 8 }));
    expect(useVimModeStore.getState().cursorPosition).toEqual(pos(5));
    const button = document.createElement("button"); document.body.appendChild(button);
    await engine.handlePointerUp({ target: button, clientX: 0, clientY: 0 } as unknown as MouseEvent);
    expect(useVimModeStore.getState().cursorPosition).toEqual(pos(5));
    surface.remove(); button.remove(); engine.dispose();
  });

  it("routes highlight color and flashcard actions through snapshots", async () => {
    const create = vi.fn(async () => ({ id: "highlight" })); const context = actionContext(create);
    const engine = new DocumentVimEngine(adapter(), () => context); await engine.activate();
    useVimModeStore.getState().setMode("visual"); useVimModeStore.getState().setSelectionRange(orderDocumentRange(pos(0), pos(2)));
    engine.performExternalAction("highlight", "purple"); await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ color: "purple", text: "selected" }));
    useVimModeStore.getState().setMode("visual"); useVimModeStore.getState().setSelectionRange(orderDocumentRange(pos(0), pos(2)));
    engine.performExternalAction("flashcard"); await settle();
    expect(context.openFlashcardStudio).toHaveBeenCalledWith(expect.objectContaining({ excerpt: "selected" })); engine.dispose();
  });

  it("keeps the selection while slow persistence is pending", async () => {
    let finish!: (value: unknown) => void;
    const engine = new DocumentVimEngine(adapter(), () => actionContext(vi.fn(() => new Promise((resolve) => { finish = resolve; })))); await engine.activate();
    const range = orderDocumentRange(pos(0), pos(2)); useVimModeStore.getState().setMode("visual"); useVimModeStore.getState().setSelectionRange(range);
    engine.performExternalAction("extract"); await settle(); expect(useVimModeStore.getState().selectionRange).toEqual(range);
    finish({ id: "done" }); await settle(); expect(useVimModeStore.getState().selectionRange).toBeNull(); engine.dispose();
  });

  it("deactivates and clears document state when disposed", async () => {
    const engine = new DocumentVimEngine(adapter(), () => actionContext()); await engine.activate(); engine.dispose();
    expect(useVimModeStore.getState()).toMatchObject({ mode: "inactive", activeDocId: null, cursorPosition: null });
  });
});
