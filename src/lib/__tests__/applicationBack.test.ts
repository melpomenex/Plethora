import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabPane, useTabsStore } from "../../stores/tabsStore";
import { requestApplicationBack } from "../applicationBack";
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
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
      forwardTabHistory: [],
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
});
