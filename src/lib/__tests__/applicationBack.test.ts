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

  it("emits one injectable completion haptic for an overlay or contextual action", () => {
    const emitFeedback = vi.fn(() => true);
    registerOverlayDismissal(vi.fn());
    expect(dispatchApplicationBack({ source: "ui", id: "overlay-back" }, { emitFeedback })).toMatchObject({
      kind: "consumed",
    });
    expect(emitFeedback).toHaveBeenCalledOnce();

    resetOverlayStackForTests();
    resetApplicationBackForTests();
    registerContextualBackHandler(vi.fn(() => true));
    expect(dispatchApplicationBack({ source: "ui", id: "context-back" }, { emitFeedback })).toMatchObject({
      kind: "consumed",
    });
    expect(emitFeedback).toHaveBeenCalledTimes(2);
  });

  it("haptically completes workspace history without letting failed delivery block dispatch", () => {
    const emitFeedback = vi.fn(() => true);
    const pane = createTabPane(["first", "second"], "second");
    useTabsStore.setState({
      tabs: [
        { id: "first", title: "First", icon: null, type: "documents", content: () => null, closable: true },
        { id: "second", title: "Second", icon: null, type: "queue", content: () => null, closable: true },
      ],
      rootPane: pane,
      navigationByPane: { [pane.id]: { back: ["first", "second"], current: "second", forward: [] } },
      navigationPaneId: pane.id,
      navigationReady: true,
    });
    const previous = vi.spyOn(useTabsStore.getState(), "goToPreviousTab").mockReturnValue(true);
    expect(dispatchApplicationBack({ source: "ui", id: "workspace-back" }, { emitFeedback })).toMatchObject({
      kind: "consumed",
      outcome: "completed",
    });
    expect(emitFeedback).toHaveBeenCalledOnce();

    resetApplicationBackForTests();
    registerOverlayDismissal(vi.fn());
    const brokenDelivery = vi.fn(() => { throw new Error("haptic unavailable"); });
    expect(dispatchApplicationBack({ source: "ui", id: "unblocked-back" }, { emitFeedback: brokenDelivery })).toMatchObject({
      kind: "consumed",
    });
    expect(brokenDelivery).toHaveBeenCalledOnce();
    previous.mockRestore();
  });

  it("waits for guarded contextual completion and stays silent at the root", () => {
    const emitFeedback = vi.fn(() => true);
    let complete: (() => void) | undefined;
    registerContextualBackHandler((_input, completion) => {
      completion?.defer();
      complete = () => completion?.complete();
      return true;
    });
    dispatchApplicationBack({ source: "ui", id: "guarded-back" }, { emitFeedback });
    expect(emitFeedback).not.toHaveBeenCalled();
    complete?.();
    expect(emitFeedback).toHaveBeenCalledOnce();

    resetContextualBackHandlersForTests();
    resetApplicationBackForTests();
    useTabsStore.setState({ navigationReady: true });
    expect(dispatchApplicationBack({ source: "ui", id: "root-back" }, { emitFeedback })).toEqual({ kind: "root" });
    expect(emitFeedback).toHaveBeenCalledOnce();
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
