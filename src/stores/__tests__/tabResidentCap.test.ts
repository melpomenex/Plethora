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
let configuredReaderCap: number | undefined = 2;

// Partial mock: only the live settings accessor is replaced, so the assertion
// that `DEFAULT_RESIDENT_TAB_CAP` matches the shipped default reads the real
// `defaultSettings` rather than a copy of itself.
vi.mock("../settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settingsStore")>();
  return {
    ...actual,
    useSettingsStore: {
      getState: () => ({
        settings: {
          general: {
            restoreSession: true,
            residentTabCap: configuredCap,
            readerTabCap: configuredReaderCap,
          },
        },
      }),
    },
  };
});

import {
  useTabsStore,
  createSplitPane,
  createTabPane,
  isTabTypeEvictable,
  isTabTypeReader,
  DEFAULT_RESIDENT_TAB_CAP,
  DEFAULT_READER_TAB_CAP,
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
    configuredReaderCap = 2;
  });

  it("agrees with the shipped default", () => {
    expect(DEFAULT_RESIDENT_TAB_CAP).toBe(defaultSettings.general.residentTabCap);
    expect(DEFAULT_READER_TAB_CAP).toBe(defaultSettings.general.readerTabCap);
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

  it("leaves the general cap exceeded rather than evicting a non-evictable tab", () => {
    configuredCap = 2;
    const tabs = [
      makeTab("viewer-1", PINNED),
      makeTab("viewer-2", PINNED),
      makeTab("viewer-3", PINNED),
    ];
    const pane = createTabPane(["viewer-1", "viewer-2", "viewer-3"], "viewer-2");
    seed(tabs, pane, ["viewer-1", "viewer-2"]);

    useTabsStore.getState().setActiveTab(pane.id, "viewer-3");

    // The GENERAL cap does not evict readers — but the READER cap does
    // (default 2, task 8.2): activating a third reader evicts the LRU one.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["viewer-1"]);
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

describe("reader tab cap (task 8.2)", () => {
  beforeEach(() => {
    configuredCap = 8;
    configuredReaderCap = 2;
  });

  it("classifies document viewers as readers and nothing else", () => {
    expect(isTabTypeReader("document-viewer")).toBe(true);
    expect(isTabTypeReader("dashboard")).toBe(false);
    expect(isTabTypeReader("queue")).toBe(false);
  });

  it("opening past the cap evicts the least recently used reader", () => {
    const tabs = ["r1", "r2", "r3"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2", "r3"], "r2");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r3");

    // r1 is the oldest reader and not active -> evicted; r2 stays warm.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["r1"]);
    // The evicted tab remains listed in the workspace.
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("alternating between two readers within the cap reloads neither", () => {
    const tabs = ["r1", "r2"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2"], "r1");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r1");
    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
    useTabsStore.getState().setActiveTab(pane.id, "r2");
    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("activating a non-reader tab evicts no reader", () => {
    configuredCap = 2; // general cap tight, so the non-reader side is stressed
    const tabs = [
      makeTab("r1", PINNED),
      makeTab("r2", PINNED),
      makeTab("dash", EVICTABLE),
      makeTab("dash2", EVICTABLE),
    ];
    const pane = createTabPane(["r1", "r2", "dash", "dash2"], "dash");
    seed(tabs, pane, ["r1", "r2", "dash"]);

    useTabsStore.getState().setActiveTab(pane.id, "dash2");

    // Readers are at the cap but the activated tab is not a reader: no reader
    // is evicted; only the general cap's evictable types may go.
    expect(useTabsStore.getState().evictedTabIds.has("r1")).toBe(false);
    expect(useTabsStore.getState().evictedTabIds.has("r2")).toBe(false);
  });

  it("a lowered reader cap applies on the next activation", () => {
    configuredReaderCap = 1;
    const tabs = ["r1", "r2"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2"], "r1");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r2");

    // Cap 1 = active reader only; the warm one is evicted.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["r1"]);
  });

  it("a reader cap of 0 keeps every reader mounted", () => {
    configuredReaderCap = 0;
    const tabs = ["r1", "r2", "r3"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2", "r3"], "r2");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r3");

    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });

  it("reactivating an evicted reader makes it resident again and re-evicts LRU", () => {
    const tabs = ["r1", "r2", "r3"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2", "r3"], "r2");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r3");
    expect(useTabsStore.getState().evictedTabIds.has("r1")).toBe(true);

    useTabsStore.getState().setActiveTab(pane.id, "r1");

    expect(useTabsStore.getState().evictedTabIds.has("r1")).toBe(false);
    // The cap still holds: r1 came back, so the next-oldest reader goes.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual(["r2"]);
  });

  it("closing a reader removes it from the evicted set", () => {
    const tabs = ["r1", "r2", "r3"].map((id) => makeTab(id, PINNED));
    const pane = createTabPane(["r1", "r2", "r3"], "r2");
    seed(tabs, pane, ["r1", "r2"]);

    useTabsStore.getState().setActiveTab(pane.id, "r3");
    expect(useTabsStore.getState().evictedTabIds.has("r1")).toBe(true);

    useTabsStore.getState().closeTab("r1");

    expect(useTabsStore.getState().evictedTabIds.has("r1")).toBe(false);
    // Only r2 + r3 remain: within the cap, nothing else is evicted.
    expect([...useTabsStore.getState().evictedTabIds]).toEqual([]);
  });
});
