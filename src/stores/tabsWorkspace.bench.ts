/**
 * Tab workspace store benchmarks — the Node lane of the tab performance gate.
 *
 * These measure the four store-level costs that sit on a user interaction:
 * activating a tab, serializing the workspace for session restore, normalizing
 * a nested split-pane tree, and the reuse scan performed when a tab is opened.
 * The render-level costs live in the jsdom lane
 * (`src/components/common/Tabs/tabWorkspace.bench.tsx`).
 *
 * Two modules are stubbed so the benchmark measures the *production* path:
 *
 * - `../lib/sync/syncTelemetry` — `measureTabSwitch` is a pass-through in
 *   release builds but allocates a telemetry sample and schedules a callback
 *   whenever `DEV` or `VITEST` is set, which is always true under this runner.
 *   Measuring it would price the diagnostics, not the reducer.
 * - `../lib/sync/progressiveScheduler` — only reachable from the telemetry
 *   callback above, and it pulls in the whole sync subsystem at import time.
 *
 * `localStorage` is stubbed to a Map so `saveTabs` measures the snapshot build
 * rather than a host storage implementation that does not exist in Node.
 *
 * Inputs are built from fixed constants and the shared seeded PRNG (see
 * `src/test/bench-support.ts`) — never `Math.random()`, never the clock.
 */
import { bench, describe, vi } from "vitest";
import type { ComponentType } from "react";
import { seededRandom } from "../test/bench-support";
import {
  useTabsStore,
  normalizePane,
  createTabPane,
  createSplitPane,
  type Tab,
  type Pane,
  type TabType,
} from "./tabsStore";

vi.mock("../lib/sync/syncTelemetry", () => ({
  measureTabSwitch: <T,>(work: () => T) => work(),
}));

vi.mock("../lib/sync/progressiveScheduler", () => ({
  getProgressiveSyncScheduler: () => ({ stats: () => ({ queued: 0 }) }),
}));

// `saveTabs` writes to `localStorage`, which Node does not implement. A Map is
// enough: the benchmark is about building the snapshot, not storing it.
class BenchStorage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  getItem(key: string): string | null {
    return this.entries.has(key) ? this.entries.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new BenchStorage(),
  });
}

/** Placeholder content: the workspace never renders in this lane. */
const PlaceholderContent = (() => null) as ComponentType;

/**
 * Tab types cycled through when building a workspace. Half are single-instance
 * types (a `Set` lookup in the reuse scan) and half are not (a data comparison
 * per candidate), so the reuse benchmark exercises both branches.
 */
const CYCLED_TYPES: TabType[] = [
  "dashboard",
  "document-viewer",
  "queue",
  "extract-reader",
  "documents",
  "document-extracts",
  "analytics",
  "web-browser",
];

const TAB_COUNT = 20;

function buildTabs(count: number, seed: number): Tab[] {
  const random = seededRandom(seed);
  const tabs: Tab[] = [];
  for (let index = 0; index < count; index += 1) {
    const type = CYCLED_TYPES[index % CYCLED_TYPES.length];
    tabs.push({
      id: `bench-tab-${index}`,
      title: `Benchmark tab ${index}`,
      icon: null,
      type,
      content: PlaceholderContent,
      closable: index > 0,
      data: {
        documentId: `doc-${Math.floor(random() * 1_000_000)}`,
        scrollOffset: Math.floor(random() * 10_000),
        label: `restore-payload-${index}`,
      },
    });
  }
  return tabs;
}

/** A four-level split tree whose leaves hold the given tabs, round-robin. */
function buildDeepPaneTree(tabs: Tab[]): Pane {
  const leaves = Array.from({ length: 8 }, (_unused, leafIndex) => {
    const leafTabs = tabs.filter((_tab, index) => index % 8 === leafIndex);
    return createTabPane(
      leafTabs.map((tab) => tab.id),
      leafTabs[0]?.id ?? null,
    );
  });
  const level3 = [
    createSplitPane("horizontal", [leaves[0], leaves[1]]),
    createSplitPane("horizontal", [leaves[2], leaves[3]]),
    createSplitPane("horizontal", [leaves[4], leaves[5]]),
    createSplitPane("horizontal", [leaves[6], leaves[7]]),
  ];
  const level2 = [
    createSplitPane("vertical", [level3[0], level3[1]]),
    createSplitPane("vertical", [level3[2], level3[3]]),
  ];
  return createSplitPane("horizontal", [level2[0], level2[1]]);
}

/** Reset the store to a single-pane workspace of `TAB_COUNT` tabs. */
function seedFlatWorkspace(): { paneId: string; tabs: Tab[] } {
  const tabs = buildTabs(TAB_COUNT, 0x7ab5);
  const pane = createTabPane(
    tabs.map((tab) => tab.id),
    tabs[0].id,
  );
  useTabsStore.setState({
    tabs,
    rootPane: pane,
    closedTabs: [],
    activeTabHistory: [tabs[0].id],
    forwardTabHistory: [],
  });
  return { paneId: pane.id, tabs };
}

describe("tabs workspace store", () => {
  const { paneId, tabs } = seedFlatWorkspace();
  const deepTree = buildDeepPaneTree(tabs);
  const reuseCandidate = tabs.find((tab) => tab.type === "documents")!;

  let activationCursor = 0;

  bench("tabs/activate-in-20-tab-workspace", () => {
    // Walk the tabs in order so every iteration performs a real activation
    // (a re-activation of the already-active tab would still do the work, but
    // rotating keeps the history filter honest at full length).
    activationCursor = (activationCursor + 1) % tabs.length;
    useTabsStore.getState().setActiveTab(paneId, tabs[activationCursor].id);
  });

  bench("tabs/serialize-20-tab-workspace", () => {
    useTabsStore.getState().saveTabs();
  });

  bench("tabs/normalize-pane-tree-depth-4", () => {
    normalizePane(deepTree);
  });

  bench("tabs/find-reusable-tab-20-tabs", () => {
    // A single-instance type that is already open: the scan finds it and
    // `addTab` returns through the reuse branch without creating a tab, so the
    // workspace stays at 20 tabs for every iteration.
    useTabsStore.getState().addTab({
      title: reuseCandidate.title,
      icon: reuseCandidate.icon,
      type: reuseCandidate.type,
      content: reuseCandidate.content,
      closable: reuseCandidate.closable,
      data: reuseCandidate.data,
    });
  });
});
