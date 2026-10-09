import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabPane, useTabsStore } from "../../stores/tabsStore";
import { dispatchApplicationBack, requestApplicationBack, resetApplicationBackForTests } from "../applicationBack";
import {
  registerContextualBackHandler,
  resetContextualBackHandlersForTests,
} from "../contextualBack";
import {
  registerOverlayDismissal,
  resetOverlayStackForTests,
} from "../overlayStack";

describe("requestApplicationBack", () => {
  beforeEach(() => {
    resetOverlayStackForTests();
    resetContextualBackHandlersForTests();
    resetApplicationBackForTests();
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
    });
  });

  it("dispatches overlay, contextual, and workspace back in priority order", () => {
    const overlay = vi.fn();
    const contextual = vi.fn(() => true);
    const workspace = vi.spyOn(useTabsStore.getState(), "goToPreviousTab");
    registerOverlayDismissal(overlay);
    registerContextualBackHandler(contextual);

    expect(requestApplicationBack()).toBe(true);
    expect(overlay).toHaveBeenCalledOnce();
    expect(contextual).not.toHaveBeenCalled();
    expect(workspace).not.toHaveBeenCalled();
  });

  it("performs exactly one contextual transition when no overlay exists", () => {
    const contextual = vi.fn(() => true);
    registerContextualBackHandler(contextual);

    expect(requestApplicationBack()).toBe(true);
    expect(contextual).toHaveBeenCalledOnce();
  });

  it("returns false when no layer can navigate", () => {
    expect(requestApplicationBack()).toBe(false);
  });

  it("deduplicates request identities and consumes a throwing handler without falling through", () => {
    const throwing = vi.fn(() => { throw new Error("handler failed"); });
    registerContextualBackHandler(throwing);
    const input = { source: "android-system" as const, id: "epoch-1:4" };
    expect(dispatchApplicationBack(input)).toEqual({ kind: "consumed", outcome: "blocked" });
    expect(dispatchApplicationBack(input)).toEqual({ kind: "consumed", outcome: "blocked" });
    expect(throwing).toHaveBeenCalledOnce();
  });

  it("returns root only at Dashboard and creates a one-way Dashboard fallback otherwise", () => {
    const pane = createTabPane(["queue"], "queue");
    useTabsStore.setState({
      tabs: [{ id: "queue", title: "Queue", icon: null, type: "queue", content: () => null, closable: true }],
      rootPane: pane,
      navigationByPane: { [pane.id]: { back: [], current: "queue", forward: [] } },
      navigationPaneId: pane.id,
      navigationReady: true,
    });
    expect(dispatchApplicationBack({ source: "android-system", id: "epoch-2:1" })).toMatchObject({ kind: "consumed", outcome: "completed" });
    expect(useTabsStore.getState().tabs.find((tab) => tab.type === "dashboard")).toBeDefined();
    expect(useTabsStore.getState().navigationByPane[pane.id]).toMatchObject({ back: [] });
    expect(dispatchApplicationBack({ source: "android-system", id: "epoch-2:2" })).toEqual({ kind: "root" });
  });
});
