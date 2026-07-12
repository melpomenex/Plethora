import { beforeEach, describe, expect, it } from "vitest";
import { orderDocumentRange, type PdfDocumentPosition } from "../../utils/vim/documentModel";
import { useVimModeStore } from "../vimModeStore";

const position = (pageNumber: number): PdfDocumentPosition => ({
  kind: "pdf", pageNumber, itemIndex: 0, charOffset: 0, affinity: "forward",
});

describe("vimModeStore stable positions", () => {
  beforeEach(() => useVimModeStore.getState().deactivate());

  it("tracks a stable caret independently from the legacy mounted index", () => {
    const store = useVimModeStore.getState();
    store.activate("pdf-1");
    store.moveToPosition(position(7));
    expect(useVimModeStore.getState().cursorPosition).toMatchObject({ pageNumber: 7 });
    expect(useVimModeStore.getState().cursorIndex).toBe(0);
  });

  it("tracks range, count, resolving, and feedback state", () => {
    const store = useVimModeStore.getState();
    store.activate("pdf-1");
    store.setMode("visual");
    store.setSelectionRange(orderDocumentRange(position(1), position(3)));
    store.setCountPrefix("12");
    store.setResolving(true);
    store.setFeedback({ kind: "success", message: "Copied" });
    const state = useVimModeStore.getState();
    expect(state.selectionRange?.end).toMatchObject({ pageNumber: 3 });
    expect(state.countPrefix).toBe("12");
    expect(state.isResolving).toBe(true);
    expect(state.feedback?.message).toBe("Copied");
  });

  it("clears document-bound state on deactivation", () => {
    const store = useVimModeStore.getState();
    store.activate("pdf-1");
    store.moveToPosition(position(2));
    store.setCountPrefix("3");
    store.deactivate();
    expect(useVimModeStore.getState()).toMatchObject({
      mode: "inactive", cursorPosition: null, selectionRange: null, countPrefix: "",
    });
  });
});
