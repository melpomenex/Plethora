import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";

vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    listen: vi.fn(),
  };
});

import { useGlobalShortcuts } from "../useKeyboardShortcuts";
import { useShortcutStore } from "../../components/common/KeyboardShortcuts";
import { useTabsStore } from "../../stores/tabsStore";

describe("global shortcuts", () => {
  afterEach(() => {
    useShortcutStore.getState().resetAll();
    cleanup();
  });

  it("routes the Dashboard shortcut through the shell navigation event", () => {
    const navigate = vi.fn();
    window.addEventListener("navigate", navigate);
    renderHook(() => useGlobalShortcuts());

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatchObject({ type: "navigate", detail: "/dashboard" });
    window.removeEventListener("navigate", navigate);
  });

  it("respects customized nav.command-palette and view.sidebar bindings", () => {
    const onPalette = vi.fn();
    const onSidebar = vi.fn();
    window.addEventListener("command-palette-open", onPalette);
    window.addEventListener("toggle-sidebar", onSidebar);

    useShortcutStore.getState().updateShortcut("nav.command-palette", { key: "j", ctrl: true, meta: true });
    useShortcutStore.getState().updateShortcut("view.sidebar", { key: "\\", ctrl: true, meta: true });

    renderHook(() => useGlobalShortcuts());

    // Old default Ctrl+K should not fire nav.command-palette after rebinding
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onPalette).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(onPalette).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(onSidebar).toHaveBeenCalledTimes(1);

    window.removeEventListener("command-palette-open", onPalette);
    window.removeEventListener("toggle-sidebar", onSidebar);
  });

  it("yields Ctrl/Cmd+E to Review/Queue tabs instead of intercepting extract-text", () => {
    const onExtract = vi.fn();
    window.addEventListener("extract-text", onExtract);

    useTabsStore.setState({
      tabs: [{ id: "tab-review", title: "Review", type: "review", icon: null, content: null as any, closable: true }],
      rootPane: { id: "pane-1", type: "tabs", tabIds: ["tab-review"], activeTabId: "tab-review" },
    });

    renderHook(() => useGlobalShortcuts());

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(onExtract).not.toHaveBeenCalled();

    window.removeEventListener("extract-text", onExtract);
  });
});
