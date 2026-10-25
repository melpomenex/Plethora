import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAssistantModelMenuBounds } from "../useAssistantModelMenuBounds";

it("observes menu geometry only while open and releases listeners on close", () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
  const panel = document.createElement("div");
  const toolbar = panel.appendChild(document.createElement("div"));
  toolbar.dataset.assistantToolbar = "";
  const anchor = toolbar.appendChild(document.createElement("div"));
  const menu = anchor.appendChild(document.createElement("div"));
  const panelRef = { current: panel };
  const menuRef = { current: menu };
  const removeListener = vi.spyOn(window, "removeEventListener");
  try {
    const { rerender, unmount } = renderHook(({ open }) => useAssistantModelMenuBounds(menuRef, panelRef, open, "right"), { initialProps: { open: false } });
    expect(observe).not.toHaveBeenCalled();
    rerender({ open: true });
    expect(observe.mock.calls.map(([element]) => element)).toEqual([panel, anchor, toolbar]);
    rerender({ open: false });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
