import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerOverlayDismissal,
  requestOverlayBack,
  resetOverlayStackForTests,
} from "../overlayStack";
import { createSplitPane, createTabPane, useTabsStore } from "../../stores/tabsStore";

describe("overlayStack", () => {
  beforeEach(() => {
    resetOverlayStackForTests();
    useTabsStore.setState({ tabs: [], rootPane: createTabPane([], null), navigationByPane: {}, navigationPaneId: null, activeTabHistory: [] });
  });

  it("dismisses the newest overlay first at equal priority", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerOverlayDismissal(first);
    registerOverlayDismissal(second);

    expect(requestOverlayBack()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("dismisses higher-priority modal surfaces before lower layers", () => {
    const drawer = vi.fn();
    const modal = vi.fn();
    registerOverlayDismissal(drawer, 10);
    registerOverlayDismissal(modal, 100);

    requestOverlayBack();

    expect(modal).toHaveBeenCalledOnce();
    expect(drawer).not.toHaveBeenCalled();
  });

  it("returns false when no overlay owns the back action", () => {
    expect(requestOverlayBack()).toBe(false);
  });

  it("claims a closing overlay until it unregisters and skips hidden owners", () => {
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
    const hidden = vi.fn();
    const visible = vi.fn();
    registerOverlayDismissal(hidden, { priority: 100, owner: { scope: "view", paneId: left.id, tabId: "settings" } });
    const unregister = registerOverlayDismissal(visible, { priority: 10, owner: { scope: "view", paneId: left.id, tabId: "document" } });

    expect(requestOverlayBack()).toBe(true);
    expect(visible).toHaveBeenCalledOnce();
    expect(hidden).not.toHaveBeenCalled();
    expect(requestOverlayBack()).toBe(true);
    expect(visible).toHaveBeenCalledOnce();
    unregister();
    expect(requestOverlayBack()).toBe(false);
  });
});

