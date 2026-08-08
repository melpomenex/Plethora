/**
 * The resident-tab cap: how many tabs stay mounted, and which one goes.
 *
 * The rules being pinned here are all conservative on purpose. Eviction is
 * opt-in per tab type, never touches a tab that is active in any pane, and does
 * nothing at all when no eligible candidate exists — a workspace that holds
 * more tabs than requested is always preferable to one that discards state a
 * tab cannot rebuild.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../uiStore", () => ({
  useUIStore: {
    getState: () => ({ setSidebarCollapsed: vi.fn(), setCurrentView: vi.fn() }),
  },
}));

vi.mock("../collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({ activeCollectionId: null }),
    setState: vi.fn(),
  },
}));

let configuredCap: number | undefined = 8;

// Partial mock: only the live settings accessor is replaced, so the assertion
// that `DEFAULT_RESIDENT_TAB_CAP` matches the shipped default reads the real
// `defaultSettings` rather than a copy of itself.
vi.mock("../settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settingsStore")>();
  return {
    ...actual,
    useSettingsStore: {
      getState: () => ({
        settings: { general: { restoreSession: true, residentTabCap: configuredCap } },
      }),
    },
  };
});

import {
  useTabsStore,
  createSplitPane,
  createTabPane,
  isTabTypeEvictable,
  DEFAULT_RESIDENT_TAB_CAP,
  type Pane,
  type Tab,
  type TabType,
} from "../tabsStore";
import { defaultSettings } from "../settingsStore";

const DummyComponent = () => null;

function makeTab(id: string, type: TabType): Tab {
  return {
    id,
    title: id,
    icon: null,
    type,
    content: DummyComponent,
    closable: true,
  };
}

/**
 * Seed a workspace and mark `history` as the activation order (oldest first),
 * i.e. every one of those tabs is resident.
 */
function seed(tabs: Tab[], rootPane: Pane, history: string[]) {
  useTabsStore.setState({
    tabs,
    rootPane,
    closedTabs: [],
    activeTabHistory: history,
    forwardTabHistory: [],
    evictedTabIds: new Set<string>(),
  });
}

/** An evictable tab type (a read-only view) and a non-evictable one. */
const EVICTABLE: TabType = "dashboard";
const PINNED: TabType = "document-viewer";

describe("resident tab cap", () => {
  beforeEach(() => {
    configuredCap = 8;
  });

  it("agrees with the shipped default", () => {
    expect(DEFAULT_RESIDENT_TAB_CAP).toBe(defaultSettings.general.residentTabCap);
  });

  it("only treats the opted-in tab types as evictable", () => {
    expect(isTabTypeEvictable(EVICTABLE)).toBe(true);
    expect(isTabTypeEvictable(PINNED)).toBe(false);
    // Anything holding unsaved user work must stay resident.
    expect(isTabTypeEvictable("doc-qa")).toBe(false);
    expect(isTabTypeEvictable("extract-reader")).toBe(false);
  });

  it("evicts the least recently active eligible tab when the cap is exceeded", () => {
    configuredCap = 3;
    const tabs = ["a", "b", "c", "d"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b", "c", "d"], "c");
    seed(tabs, pane, ["a", "b", "c"]);

    useTabsStore.getState().setActiveTab(pane.id, "d");

    // a, b, c, d would be four resident tabs against a cap of three; "a" is the
    // oldest activation and is not active anywhere.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["a"]);
  });

  it("never evicts a tab that is active in any pane", () => {
    configuredCap = 1;
    const tabs = ["left", "right"].map((id) => makeTab(id, EVICTABLE));
    const leftPane = createTabPane(["left"], "left");
    const rightPane = createTabPane(["right"], "right");
    const root = createSplitPane("horizontal", [leftPane, rightPane]);
    seed(tabs, root, ["left", "right"]);

    // Re-activating the right pane's tab runs the cap with two resident tabs
    // against a cap of one — but both are their pane's active tab.
    useTabsStore.getState().setActiveTab(rightPane.id, "right");

    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("leaves the cap exceeded rather than evicting a non-evictable tab", () => {
    configuredCap = 2;
    const tabs = [
      makeTab("viewer-1", PINNED),
      makeTab("viewer-2", PINNED),
      makeTab("viewer-3", PINNED),
    ];
    const pane = createTabPane(["viewer-1", "viewer-2", "viewer-3"], "viewer-2");
    seed(tabs, pane, ["viewer-1", "viewer-2"]);

    useTabsStore.getState().setActiveTab(pane.id, "viewer-3");

    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("skips ineligible candidates and evicts the oldest eligible one", () => {
    configuredCap = 2;
    const tabs = [
      makeTab("old-viewer", PINNED),
      makeTab("old-dashboard", EVICTABLE),
      makeTab("recent", EVICTABLE),
    ];
    const pane = createTabPane(["old-viewer", "old-dashboard", "recent"], "recent");
    seed(tabs, pane, ["old-viewer", "old-dashboard", "recent"]);

    useTabsStore.getState().setActiveTab(pane.id, "recent");

    // "old-viewer" is older but cannot restore; the next-oldest eligible one goes.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["old-dashboard"]);
  });

  it("does nothing when the cap is disabled", () => {
    configuredCap = 0;
    const tabs = ["a", "b", "c", "d", "e"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b", "c", "d", "e"], "d");
    seed(tabs, pane, ["a", "b", "c", "d"]);

    useTabsStore.getState().setActiveTab(pane.id, "e");

    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("applies a lowered cap on the next activation", () => {
    configuredCap = 0;
    const tabs = ["a", "b", "c", "d"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b", "c", "d"], "c");
    seed(tabs, pane, ["a", "b", "c"]);

    useTabsStore.getState().setActiveTab(pane.id, "d");
    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);

    configuredCap = 2;
    useTabsStore.getState().setActiveTab(pane.id, "c");

    // Four resident against a cap of two, with "c" now exempt as the active tab.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["a", "b"]);
  });

  it("makes an evicted tab resident again when it is reactivated", () => {
    configuredCap = 3;
    const tabs = ["a", "b", "c", "d"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b", "c", "d"], "c");
    seed(tabs, pane, ["a", "b", "c"]);

    useTabsStore.getState().setActiveTab(pane.id, "d");
    expect(useTabsStore.getState().evictedTabIds.has("a")).toBe(true);

    useTabsStore.getState().setActiveTab(pane.id, "a");

    expect(useTabsStore.getState().evictedTabIds.has("a")).toBe(false);
    // ...and the cap still holds: "a" came back, so the next-oldest goes.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["b"]);
  });

  it("keeps the evicted set identity stable when nothing is evicted", () => {
    configuredCap = 8;
    const tabs = ["a", "b"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b"], "a");
    seed(tabs, pane, ["a"]);

    const before = useTabsStore.getState().evictedTabIds;
    useTabsStore.getState().setActiveTab(pane.id, "b");

    // TabContent subscribes to this set; a fresh one per switch would re-render
    // every pane on every tab switch.
    expect(useTabsStore.getState().evictedTabIds).toBe(before);
  });

  it("does not evict anything when a tab is moved between panes", () => {
    configuredCap = 2;
    const tabs = ["a", "b", "c"].map((id) => makeTab(id, EVICTABLE));
    const leftPane = createTabPane(["a", "b"], "b");
    const rightPane = createTabPane(["c"], "c");
    const root = createSplitPane("horizontal", [leftPane, rightPane]);
    seed(tabs, root, ["a", "b", "c"]);

    // Three resident tabs against a cap of two — but a move is not an
    // activation, so the cap is not evaluated and nothing is unmounted.
    useTabsStore.getState().moveTabToPane("a", leftPane.id, rightPane.id);

    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("drops closed tabs out of the evicted set", () => {
    configuredCap = 3;
    const tabs = ["a", "b", "c", "d"].map((id) => makeTab(id, EVICTABLE));
    const pane = createTabPane(["a", "b", "c", "d"], "c");
    seed(tabs, pane, ["a", "b", "c"]);

    useTabsStore.getState().setActiveTab(pane.id, "d");
    expect(useTabsStore.getState().evictedTabIds.has("a")).toBe(true);

    useTabsStore.getState().closeTab("a");

    expect(useTabsStore.getState().evictedTabIds.has("a")).toBe(false);
  });
});
