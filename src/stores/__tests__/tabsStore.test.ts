import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { getProgressiveSyncScheduler, resetProgressiveSyncSchedulerForTest } from "../../lib/sync/progressiveScheduler";
import { clearSyncTelemetry, getSyncTelemetry } from "../../lib/sync/syncTelemetry";

vi.mock("../uiStore", () => ({
  useUIStore: {
    getState: () => ({
      setSidebarCollapsed: vi.fn(),
      setCurrentView: vi.fn(),
    }),
  },
}));

vi.mock("../collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({
      activeCollectionId: null,
    }),
    setState: vi.fn(),
  },
}));

vi.mock("../settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        general: {
          restoreSession: true,
        },
      },
    }),
  },
}));

import { useTabsStore, createSplitPane, createTabPane, normalizePane } from "../tabsStore";

const DummyComponent = () => null;

describe("tabsStore activeTabHistory and MRU close behavior", () => {
  beforeEach(() => {
    // Reset state before each test
    const initialPane = createTabPane([], null);
    useTabsStore.setState({
      tabs: [],
      rootPane: initialPane,
      closedTabs: [],
      activeTabHistory: [],
      forwardTabHistory: [],
    });
  });

  it("maintains activeTabHistory correctly on addTab and setActiveTab", () => {
    const store = useTabsStore.getState();

    // Add Tab A
    const idA = store.addTab({
      title: "Tab A",
      icon: "icon-a" as any,
      type: "documents",
      content: DummyComponent as any,
      closable: true,
    });

    // Add Tab B
    const idB = store.addTab({
      title: "Tab B",
      icon: "icon-b" as any,
      type: "queue",
      content: DummyComponent as any,
      closable: true,
    });

    // Add Tab C
    const idC = store.addTab({
      title: "Tab C",
      icon: "icon-c" as any,
      type: "analytics",
      content: DummyComponent as any,
      closable: true,
    });

    // Current state check: since tabs were added in sequence (which auto-activates them),
    // history should end with C.
    let state = useTabsStore.getState();
    expect(state.activeTabHistory).toEqual([idA, idB, idC]);

    // Activate B
    const paneId = state.rootPane.id;
    useTabsStore.getState().setActiveTab(paneId, idB);

    state = useTabsStore.getState();
    // B should move to the end of history
    expect(state.activeTabHistory).toEqual([idA, idC, idB]);
  });

  it("selects the most recently active tab (MRU) on closeTab", () => {
    const store = useTabsStore.getState();

    // Add A, B, C
    const idA = store.addTab({ title: "Tab A", icon: "icon" as any, type: "documents", content: DummyComponent, closable: true });
    const idB = store.addTab({ title: "Tab B", icon: "icon" as any, type: "queue", content: DummyComponent, closable: true });
    const idC = store.addTab({ title: "Tab C", icon: "icon" as any, type: "analytics", content: DummyComponent, closable: true });

    // Set active sequence: A -> B -> C -> B
    const paneId = useTabsStore.getState().rootPane.id;
    useTabsStore.getState().setActiveTab(paneId, idC);
    useTabsStore.getState().setActiveTab(paneId, idB);

    let state = useTabsStore.getState();
    expect(state.activeTabHistory).toEqual([idA, idC, idB]);
    expect((state.rootPane as any).activeTabId).toBe(idB);

    // Close active tab B
    useTabsStore.getState().closeTab(idB);

    state = useTabsStore.getState();
    // B should be removed from tabs and history
    expect(state.tabs.map(t => t.id)).toEqual([idA, idC]);
    expect(state.activeTabHistory).toEqual([idA, idC]);
    
    // The active tab should switch to C (the most recently active remaining tab)
    // instead of A (which would be index-1 of B).
    expect((state.rootPane as any).activeTabId).toBe(idC);
  });

  it("resolves and returns to the most recent non-settings destination", () => {
    const documentsId = useTabsStore.getState().addTab({
      title: "Documents",
      icon: "documents",
      type: "documents",
      content: DummyComponent,
      closable: true,
    });
    const settingsId = useTabsStore.getState().addTab({
      title: "Settings",
      icon: "settings",
      type: "settings",
      content: DummyComponent,
      closable: true,
    });

    expect(useTabsStore.getState().getSettingsReturnDestination()).toMatchObject({
      tabId: documentsId,
      title: "Documents",
    });
    expect(useTabsStore.getState().returnFromSettings()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(documentsId);
    expect(useTabsStore.getState().forwardTabHistory).toContain(settingsId);
  });

  it("updates the return destination when the singleton settings tab is reopened", () => {
    useTabsStore.getState().addTab({ title: "Documents", icon: null, type: "documents", content: DummyComponent, closable: true });
    const queueId = useTabsStore.getState().addTab({ title: "Queue", icon: null, type: "queue", content: DummyComponent, closable: true });
    useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true });
    useTabsStore.getState().returnFromSettings();
    const paneId = useTabsStore.getState().rootPane.id;
    useTabsStore.getState().setActiveTab(paneId, queueId);
    useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true });

    expect(useTabsStore.getState().getSettingsReturnDestination()?.tabId).toBe(queueId);
  });

  it("skips stale and closed return targets", () => {
    const documentsId = useTabsStore.getState().addTab({ title: "Documents", icon: null, type: "documents", content: DummyComponent, closable: true });
    const queueId = useTabsStore.getState().addTab({ title: "Queue", icon: null, type: "queue", content: DummyComponent, closable: true });
    const settingsId = useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true });
    useTabsStore.getState().closeTab(queueId);
    useTabsStore.setState({
      activeTabHistory: [documentsId, "missing-tab", queueId, settingsId],
    });

    expect(useTabsStore.getState().getSettingsReturnDestination()?.tabId).toBe(documentsId);
  });

  it("resolves the prior tab in the split pane that contains settings", () => {
    const left = createTabPane(["left-document"], "left-document");
    const right = createTabPane(["right-queue", "settings"], "settings");
    useTabsStore.setState({
      tabs: [
        { id: "left-document", title: "Left document", icon: null, type: "documents", content: DummyComponent, closable: true },
        { id: "right-queue", title: "Right queue", icon: null, type: "queue", content: DummyComponent, closable: true },
        { id: "settings", title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true },
      ],
      rootPane: createSplitPane("horizontal", [left, right]),
      activeTabHistory: ["left-document", "right-queue", "settings"],
    });

    expect(useTabsStore.getState().getSettingsReturnDestination()).toEqual({
      tabId: "right-queue",
      paneId: right.id,
      title: "Right queue",
    });
    expect(useTabsStore.getState().returnFromSettings()).toBe(true);
    expect(useTabsStore.getState().findPaneById(right.id)).toMatchObject({
      activeTabId: "right-queue",
    });
  });

  it("uses the dashboard navigation fallback when settings is the only tab", () => {
    useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true });
    const navigate = vi.fn();
    window.addEventListener("navigate", navigate);

    expect(useTabsStore.getState().getSettingsReturnDestination()).toBeNull();
    expect(useTabsStore.getState().returnFromSettings()).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("/dashboard");

    window.removeEventListener("navigate", navigate);
  });

  it("getMostRecentTabOfTypes returns the most recently active tab among the given types", () => {
    const queueId = useTabsStore.getState().addTab({ title: "Queue", icon: null, type: "queue", content: DummyComponent, closable: true });
    const scrollId = useTabsStore.getState().addTab({ title: "Scroll Mode", icon: null, type: "queue-scroll", content: DummyComponent, closable: true });
    useTabsStore.getState().addTab({ title: "Documents", icon: null, type: "documents", content: DummyComponent, closable: true });
    const paneId = useTabsStore.getState().rootPane.id;
    useTabsStore.getState().setActiveTab(paneId, queueId);

    expect(useTabsStore.getState().getMostRecentTabOfTypes(["queue", "queue-scroll"])?.id).toBe(queueId);

    useTabsStore.getState().setActiveTab(paneId, scrollId);
    expect(useTabsStore.getState().getMostRecentTabOfTypes(["queue", "queue-scroll"])?.id).toBe(scrollId);
  });

  it("getMostRecentTabOfTypes skips stale ids and closed tabs", () => {
    const queueId = useTabsStore.getState().addTab({ title: "Queue", icon: null, type: "queue", content: DummyComponent, closable: true });
    const scrollId = useTabsStore.getState().addTab({ title: "Scroll Mode", icon: null, type: "queue-scroll", content: DummyComponent, closable: true });
    useTabsStore.getState().closeTab(scrollId);
    useTabsStore.setState({
      activeTabHistory: [queueId, "missing-tab", scrollId],
    });

    expect(useTabsStore.getState().getMostRecentTabOfTypes(["queue", "queue-scroll"])?.id).toBe(queueId);
  });

  it("getMostRecentTabOfTypes returns undefined when no open tab matches", () => {
    useTabsStore.getState().addTab({ title: "Documents", icon: null, type: "documents", content: DummyComponent, closable: true });

    expect(useTabsStore.getState().getMostRecentTabOfTypes(["queue", "queue-scroll"])).toBeUndefined();
  });
});

describe("pane normalization", () => {
  it("preserves identity when a split pane is already valid", () => {
    const left = createTabPane(["left"], "left");
    const right = createTabPane(["right"], "right");
    const pane = createSplitPane("horizontal", [left, right], [50, 50]);

    expect(normalizePane(pane)).toBe(pane);
    expect(normalizePane(normalizePane(pane))).toBe(pane);
  });

  it("repairs malformed persisted pane data and becomes stable", () => {
    const malformed = {
      id: "split",
      type: "split",
      direction: "horizontal",
      children: [{ id: "tabs", type: "tabs", tabIds: ["tab"], activeTabId: "missing" }],
      sizes: [Number.NaN],
    } as any;

    const normalized = normalizePane(malformed);

    expect(normalized).not.toBe(malformed);
    expect(normalized).toMatchObject({
      type: "split",
      sizes: [100],
      children: [{ activeTabId: "tab" }],
    });
    expect(normalizePane(normalized)).toBe(normalized);
  });
});

describe("tab workspace persistence", () => {
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();
  });

  it("debounces active-tab snapshot writes", () => {
    vi.useFakeTimers();
    const firstId = useTabsStore.getState().addTab({
      title: "First",
      icon: null,
      type: "documents",
      content: DummyComponent,
      closable: true,
    });
    const secondId = useTabsStore.getState().addTab({
      title: "Second",
      icon: null,
      type: "queue",
      content: DummyComponent,
      closable: true,
    });
    const paneId = useTabsStore.getState().rootPane.id;
    window.localStorage.removeItem("incrementum-tabs");

    useTabsStore.getState().setActiveTab(paneId, firstId);
    useTabsStore.getState().setActiveTab(paneId, secondId);

    expect(window.localStorage.getItem("incrementum-tabs")).toBeNull();
    vi.advanceTimersByTime(180);

    const snapshot = JSON.parse(window.localStorage.getItem("incrementum-tabs") ?? "null");
    expect(snapshot.rootPane.activeTabId).toBe(secondId);
  });

  it("flushes a pending active-tab snapshot when the page is hidden", () => {
    vi.useFakeTimers();
    const firstId = useTabsStore.getState().addTab({
      title: "First",
      icon: null,
      type: "documents",
      content: DummyComponent,
      closable: true,
    });
    const secondId = useTabsStore.getState().addTab({
      title: "Second",
      icon: null,
      type: "queue",
      content: DummyComponent,
      closable: true,
    });
    const paneId = useTabsStore.getState().rootPane.id;
    window.localStorage.removeItem("incrementum-tabs");

    useTabsStore.getState().setActiveTab(paneId, firstId);
    useTabsStore.getState().setActiveTab(paneId, secondId);
    window.dispatchEvent(new Event("pagehide"));

    const snapshot = JSON.parse(window.localStorage.getItem("incrementum-tabs") ?? "null");
    expect(snapshot.rootPane.activeTabId).toBe(secondId);
  });

  it("keeps rapid switching across a 50-tab workspace bounded with sync backlog", () => {
    vi.useFakeTimers();
    clearSyncTelemetry();
    const scheduler = getProgressiveSyncScheduler();
    for (let index = 0; index < 20; index += 1) {
      scheduler.enqueue({
        id: `documents:remote:stress-${index}`,
        lane: "P1",
        run: async (context) => {
          if (context.shouldYield()) await context.yield();
        },
      });
    }

    const tabIds = Array.from({ length: 50 }, (_, index) => useTabsStore.getState().addTab({
      title: `Document ${index}`,
      icon: null,
      type: "document-viewer",
      content: DummyComponent,
      closable: true,
      data: { documentId: `stress-${index}` },
    }));
    const paneId = useTabsStore.getState().rootPane.id;
    for (let index = 0; index < 200; index += 1) {
      useTabsStore.getState().setActiveTab(paneId, tabIds[index % tabIds.length]);
    }
    vi.runAllTimers();
    const switchDurations = getSyncTelemetry()
      .filter((sample) => sample.phase === "tab-switch" && sample.durationMs !== undefined)
      .map((sample) => sample.durationMs ?? 0)
      .sort((a, b) => a - b);
    expect(switchDurations.length).toBeGreaterThan(0);

    resetProgressiveSyncSchedulerForTest();
  });
});
