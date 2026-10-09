import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerContextualBackHandler,
  requestContextualBack,
  resetContextualBackHandlersForTests,
} from "../contextualBack";
import { createSplitPane, createTabPane, useTabsStore } from "../../stores/tabsStore";

describe("contextualBack", () => {
  beforeEach(() => {
    resetContextualBackHandlersForTests();
    useTabsStore.setState({ tabs: [], rootPane: createTabPane([], null), navigationByPane: {}, navigationPaneId: null, activeTabHistory: [] });
  });

  it("uses priority and stops after the first handler consumes back", () => {
    const lower = vi.fn(() => true);
    const higher = vi.fn(() => true);
    registerContextualBackHandler(lower, 1);
    registerContextualBackHandler(higher, 10);

    expect(requestContextualBack()).toBe(true);
    expect(higher).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
  });

  it("continues past handlers that decline and unregisters cleanly", () => {
    const consuming = vi.fn(() => true);
    registerContextualBackHandler(consuming, 1);
    const unregister = registerContextualBackHandler(() => false, 10);

    expect(requestContextualBack()).toBe(true);
    expect(consuming).toHaveBeenCalledOnce();
    unregister();
    consuming.mockClear();
    expect(requestContextualBack()).toBe(true);
    expect(consuming).toHaveBeenCalledOnce();
  });

  it("checks a view owner's pane and active tab against live store state", () => {
    const left = createTabPane(["settings", "document"], "document");
    const right = createTabPane(["queue"], "queue");
    useTabsStore.setState({
      tabs: [
        { id: "settings", title: "Settings", icon: null, type: "settings", content: () => null, closable: true },
        { id: "document", title: "Document", icon: null, type: "documents", content: () => null, closable: true },
        { id: "queue", title: "Queue", icon: null, type: "queue", content: () => null, closable: true },
      ],
      rootPane: createSplitPane("horizontal", [left, right]),
      navigationPaneId: left.id,
    });
    const owned = vi.fn(() => true);
    registerContextualBackHandler(owned, {
      priority: 20,
      owner: { scope: "view", paneId: left.id, tabId: "settings" },
    });

    expect(requestContextualBack()).toBe(false);
    useTabsStore.getState().setActiveTab(left.id, "settings");
    expect(requestContextualBack()).toBe(true);
    expect(owned).toHaveBeenCalledOnce();
    useTabsStore.getState().setNavigationPane(right.id);
    expect(requestContextualBack()).toBe(false);
  });
});
