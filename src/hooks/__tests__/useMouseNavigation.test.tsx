import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createTabPane, useTabsStore } from "../../stores/tabsStore";
import { resetApplicationBackForTests } from "../../lib/applicationBack";
import { resetContextualBackHandlersForTests } from "../../lib/contextualBack";
import { resetContextualForwardHandlersForTests } from "../../lib/contextualForward";
import { resetOverlayStackForTests } from "../../lib/overlayStack";
import { attachMouseNavigationToWindow, useMouseNavigation } from "../useMouseNavigation";

describe("useMouseNavigation", () => {
  beforeEach(() => {
    resetOverlayStackForTests();
    resetContextualBackHandlersForTests();
    resetContextualForwardHandlersForTests();
    resetApplicationBackForTests();
    const pane = createTabPane(["first", "second"], "second");
    useTabsStore.setState({
      tabs: [
        { id: "first", title: "First", icon: null, type: "documents", content: () => null, closable: true },
        { id: "second", title: "Second", icon: null, type: "queue", content: () => null, closable: true },
      ],
      rootPane: pane,
      navigationByPane: { [pane.id]: { back: ["first"], current: "second", forward: [] } },
      navigationPaneId: pane.id,
      navigationReady: true,
    });
  });

  it("navigates back on mouse button 3 and forward on mouse button 4", () => {
    const { unmount } = renderHook(() => useMouseNavigation());

    const backDown = new MouseEvent("mousedown", { button: 3, bubbles: true, cancelable: true });
    const backUp = new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true });
    window.dispatchEvent(backDown);
    window.dispatchEvent(backUp);

    expect(backDown.defaultPrevented).toBe(true);
    expect(backUp.defaultPrevented).toBe(true);

    const paneId = useTabsStore.getState().navigationPaneId!;
    expect(useTabsStore.getState().findPaneById(paneId)).toMatchObject({ activeTabId: "first" });

    const fwdAux = new MouseEvent("auxclick", { button: 4, bubbles: true, cancelable: true });
    const fwdUp = new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true });
    window.dispatchEvent(fwdAux);
    window.dispatchEvent(fwdUp);

    expect(fwdAux.defaultPrevented).toBe(true);
    expect(fwdUp.defaultPrevented).toBe(true);
    expect(useTabsStore.getState().findPaneById(paneId)).toMatchObject({ activeTabId: "second" });

    unmount();
  });

  it("ignores primary/middle/right mouse buttons and modified clicks", () => {
    const { unmount } = renderHook(() => useMouseNavigation());
    const paneId = useTabsStore.getState().navigationPaneId!;

    const leftUp = new MouseEvent("mouseup", { button: 0, bubbles: true, cancelable: true });
    window.dispatchEvent(leftUp);
    expect(leftUp.defaultPrevented).toBe(false);

    const ctrlBackUp = new MouseEvent("mouseup", { button: 3, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ctrlBackUp);
    expect(ctrlBackUp.defaultPrevented).toBe(true);
    expect(useTabsStore.getState().findPaneById(paneId)).toMatchObject({ activeTabId: "second" });

    unmount();
  });

  it("attaches at most once per window and cleans up on detach", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const detach1 = attachMouseNavigationToWindow(window);
    const detach2 = attachMouseNavigationToWindow(window);

    expect(addSpy).toHaveBeenCalledTimes(3);
    detach2();
    detach1();
    addSpy.mockRestore();
  });
});
