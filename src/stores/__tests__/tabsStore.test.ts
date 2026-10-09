import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

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
    expect(useTabsStore.getState().navigationByPane[useTabsStore.getState().rootPane.id]?.forward).toContain(settingsId);
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

  it("creates the canonical Dashboard synchronously when Settings is the only tab", () => {
    useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyComponent, closable: true });

    expect(useTabsStore.getState().getSettingsReturnDestination()).toBeNull();
    expect(useTabsStore.getState().returnFromSettings()).toBe(true);
    expect(useTabsStore.getState().tabs.find((tab) => tab.type === "dashboard")).toMatchObject({ title: "Dashboard", closable: false });
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(useTabsStore.getState().tabs.find((tab) => tab.type === "dashboard")?.id);
    expect(useTabsStore.getState().navigationByPane[useTabsStore.getState().rootPane.id]).toMatchObject({ back: [] });
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

describe("tabsStore chronological navigation regressions", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
    });
  });

  const add = (title: string, type: "documents" | "queue" | "analytics" | "settings") =>
    useTabsStore.getState().addTab({ title, icon: null, type, content: DummyComponent, closable: true });

  it("advances through every retained visit on repeated Back", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    const s = add("Settings", "settings");

    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(c);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(b);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(false);
    expect((useTabsStore.getState().rootPane as any).activeTabId).not.toBe(s);
  });

  it("retains nonadjacent visits when a singleton is reused", () => {
    const a = add("A", "settings");
    const b = add("B", "documents");
    expect(add("A reused", "settings")).toBe(a);
    const c = add("C", "queue");

    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(b);
    expect(useTabsStore.getState().tabs.filter((tab) => tab.id === a)).toHaveLength(1);
    expect((useTabsStore.getState().rootPane as any).activeTabId).not.toBe(c);
  });

  it("consumes Forward once and discards it after a new foreground visit", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect(useTabsStore.getState().goToNextTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(c);
    expect(useTabsStore.getState().goToNextTab()).toBe(false);

    useTabsStore.getState().goToPreviousTab();
    const paneId = useTabsStore.getState().rootPane.id;
    useTabsStore.getState().setActiveTab(paneId, b);
    expect(useTabsStore.getState().addTab({ title: "D", icon: null, type: "rss", content: DummyComponent, closable: true })).toBeTruthy();
    expect(useTabsStore.getState().goToNextTab()).toBe(false);
    expect((useTabsStore.getState().rootPane as any).activeTabId).not.toBe(a);
  });

  it("replays Back chronologically with Forward in the original order", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
    expect(useTabsStore.getState().goToNextTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(b);
    expect(useTabsStore.getState().goToNextTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(c);
    expect(useTabsStore.getState().goToNextTab()).toBe(false);
  });

  it("returns from Settings to its chronological predecessor and preserves older Back visits", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    add("Settings", "settings");
    expect(useTabsStore.getState().returnFromSettings()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(b);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
  });

  it("skips closed destinations while preserving older valid visits", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    useTabsStore.getState().closeTab(b);

    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
    expect((useTabsStore.getState().rootPane as any).activeTabId).not.toBe(c);
  });

  it("replaces a closed current entry and gives a reopened tab a fresh visit", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    useTabsStore.getState().closeTab(c);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(b);
    expect(useTabsStore.getState().navigationByPane[useTabsStore.getState().rootPane.id]).toMatchObject({ current: b, back: [a] });
    expect(useTabsStore.getState().goToPreviousTab()).toBe(true);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(a);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(false);

    useTabsStore.getState().reopenLastClosedTab();
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(c);
    expect(useTabsStore.getState().navigationByPane[useTabsStore.getState().rootPane.id]).toMatchObject({ current: c, back: [a] });
  });

  it("bounds each chronology stack and keeps its current entry at the selected pane", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const paneId = useTabsStore.getState().rootPane.id;
    for (let index = 0; index < 300; index++) {
      useTabsStore.getState().setActiveTab(paneId, index % 2 === 0 ? a : b);
    }
    const record = useTabsStore.getState().navigationByPane[paneId];
    expect(record.current).toBe((useTabsStore.getState().rootPane as any).activeTabId);
    expect(record.back).toHaveLength(256);
    expect(record.forward).toEqual([]);

    useTabsStore.setState({ rootPane: createTabPane([], null), tabs: [], navigationByPane: {} });
    expect(useTabsStore.getState().goToPreviousTab()).toBe(false);
    expect(useTabsStore.getState().goToNextTab()).toBe(false);
  });

  it("prunes closed bulk entries and preserves the surviving pane history through split moves and collapse", () => {
    const a = add("A", "documents");
    const b = add("B", "queue");
    const c = add("C", "analytics");
    const rootId = useTabsStore.getState().rootPane.id;

    useTabsStore.getState().closeOtherTabs(b);
    expect(useTabsStore.getState().navigationByPane[rootId]).toMatchObject({ current: b, back: [], forward: [] });
    expect(useTabsStore.getState().tabs.some((tab) => tab.id === c)).toBe(false);
    expect(useTabsStore.getState().goToPreviousTab()).toBe(false);

    useTabsStore.getState().addTab({ title: "A restored", icon: null, type: "documents", content: DummyComponent, closable: true });
    useTabsStore.getState().addTab({ title: "C restored", icon: null, type: "analytics", content: DummyComponent, closable: true });
    const stateBeforeSplit = useTabsStore.getState();
    const paneId = stateBeforeSplit.rootPane.id;
    const activeId = (stateBeforeSplit.rootPane as any).activeTabId;
    useTabsStore.getState().splitPane(paneId, activeId, "horizontal", "after");

    const splitState = useTabsStore.getState();
    const panes = splitState.getTabPaneIds().map((id) => splitState.findPaneById(id)).filter((pane) => pane?.type === "tabs");
    const left = panes.find((pane) => pane?.type === "tabs" && pane.tabIds.includes(b));
    const right = panes.find((pane) => pane?.type === "tabs" && pane.tabIds.includes(activeId));
    expect(left?.type).toBe("tabs");
    expect(right?.type).toBe("tabs");
    if (left?.type !== "tabs" || right?.type !== "tabs") throw new Error("split panes were not created");

    useTabsStore.getState().moveTabToPane(b, left.id, right.id);
    let movedState = useTabsStore.getState();
    expect(movedState.navigationByPane[left.id]?.back).not.toContain(b);
    expect(movedState.navigationByPane[right.id]?.current).toBe(activeId);

    const split = movedState.rootPane;
    if (split.type !== "split") throw new Error("expected a split root");
    const keepPane = split.children.find((child) => child.type === "tabs" && child.id === left.id);
    const removedPane = split.children.find((child) => child.type === "tabs" && child.id === right.id);
    if (!keepPane || !removedPane) throw new Error("expected both split children");
    useTabsStore.getState().collapseSplit(split.id, removedPane.id);

    movedState = useTabsStore.getState();
    expect(movedState.navigationByPane[left.id]).toBeDefined();
    expect(movedState.navigationByPane[right.id]).toBeUndefined();
    expect(movedState.rootPane.id).toBe(left.id);
    expect(movedState.tabs.some((tab) => tab.id === a)).toBe(false);
    expect(movedState.tabs.some((tab) => tab.id === activeId)).toBe(true);
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
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
      navigationByPane: {},
      navigationPaneId: null,
      navigationReady: false,
    });
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();
    window.localStorage.removeItem("plethora-tabs");
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
    window.localStorage.removeItem("plethora-tabs");

    useTabsStore.getState().setActiveTab(paneId, firstId);
    useTabsStore.getState().setActiveTab(paneId, secondId);

    expect(window.localStorage.getItem("plethora-tabs")).toBeNull();
    vi.advanceTimersByTime(180);

    const snapshot = JSON.parse(window.localStorage.getItem("plethora-tabs") ?? "null");
    expect(snapshot.rootPane.activeTabId).toBe(secondId);
    expect(snapshot.navigation.version).toBe(1);
    expect(snapshot.navigation.byPane[snapshot.rootPane.id]).toMatchObject({ current: secondId, back: [firstId, secondId, firstId], forward: [] });
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
    window.localStorage.removeItem("plethora-tabs");

    useTabsStore.getState().setActiveTab(paneId, firstId);
    useTabsStore.getState().setActiveTab(paneId, secondId);
    window.dispatchEvent(new Event("pagehide"));

    const snapshot = JSON.parse(window.localStorage.getItem("plethora-tabs") ?? "null");
    expect(snapshot.rootPane.activeTabId).toBe(secondId);
  });

  it("restores only validated entries from versioned navigation and bootstraps legacy snapshots", async () => {
    const pane = { id: "restore-pane", type: "tabs", tabIds: ["a", "b"], activeTabId: "b" };
    const tabs = [
      { id: "a", title: "A", icon: "A", type: "documents", closable: true },
      { id: "b", title: "B", icon: "B", type: "queue", closable: true },
    ];
    useTabsStore.setState({ tabs: [], rootPane: createTabPane([], null), navigationByPane: {}, activeTabHistory: [] });
    localStorage.setItem("plethora-tabs", JSON.stringify({
      tabs,
      rootPane: pane,
      navigation: { version: 1, byPane: { "restore-pane": { back: ["a", "missing", 2], current: "a", forward: ["a", "b", "wrong-pane"] } } },
    }));
    await useTabsStore.getState().loadTabs();
    expect(useTabsStore.getState().navigationByPane["restore-pane"]).toEqual({ back: ["a"], current: "b", forward: ["a", "b"] });

    useTabsStore.setState({ tabs: [], rootPane: createTabPane([], null), navigationByPane: {}, activeTabHistory: [] });
    localStorage.setItem("plethora-tabs", JSON.stringify({ tabs, rootPane: pane, navigation: { version: 99, byPane: { "restore-pane": { back: ["a"], forward: ["a"] } } } }));
    await useTabsStore.getState().loadTabs();
    expect(useTabsStore.getState().navigationByPane["restore-pane"]).toEqual({ back: [], current: "b", forward: [] });
  });

});
