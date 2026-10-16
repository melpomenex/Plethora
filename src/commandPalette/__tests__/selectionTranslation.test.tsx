import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getPaletteSelection, translatePaletteSelection, usePaletteSelection, usePaletteSelectionStore } from "../selectionTranslation";
import { usePaletteActionListener } from "../paletteActionEvents";
import { useUIStore } from "../../stores/uiStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useState } from "react";
import { screen } from "@testing-library/react";

describe("reader selection capture", () => {
  beforeEach(() => {
    usePaletteSelectionStore.setState({ selection: null });
    useUIStore.setState({ commandPaletteOpen: false });
    useTabsStore.setState({ tabs: [], navigationPaneId: null });
  });
  it.each(["pdf", "epub", "html", "text"])("preserves %s reader text across palette focus and opens its result owner", () => {
    function Reader() {
      const [source, setSource] = useState("First sentence. Second sentence.");
      const [resultSource, setResultSource] = useState("");
      usePaletteSelection({ documentId: "owner", text: source }, true);
      usePaletteActionListener("document-viewer", { "doc.translateSelection": () => setResultSource(getPaletteSelection()!.text) });
      return <><button onClick={() => setSource("")}>Collapse native selection</button><output>{resultSource}</output></>;
    }
    render(<Reader />);
    act(() => useUIStore.getState().setCommandPaletteOpen(true));
    act(() => screen.getByText("Collapse native selection").click());
    act(() => translatePaletteSelection());
    expect(screen.getByRole("status")).toHaveTextContent("First sentence. Second sentence.");
  });
  it("invalidates a snapshot after its owner closes", () => {
    const hook = renderHook(() => usePaletteSelection({ documentId: "owner", text: "Captured" }, true));
    expect(getPaletteSelection()?.text).toBe("Captured");
    hook.unmount();
    expect(getPaletteSelection()).toBeNull();
  });
  it("never publishes text from an inactive reader", () => {
    renderHook(() => usePaletteSelection({ documentId: "other", text: "Inactive" }, false));
    expect(getPaletteSelection()).toBeNull();
  });
});
