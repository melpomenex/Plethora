import { create } from "zustand";
import type { ComponentType, ReactNode } from "react";
import { generateId } from "../utils/id";
import { useUIStore } from "./uiStore";
import { useCollectionStore } from "./collectionStore";
import { useSettingsStore } from "./settingsStore";

export type TabType =
  | "continue-reading"
  | "dashboard"
  | "queue"
  | "queue-scroll"
  | "review"
  | "documents"
  | "document-viewer"
  | "analytics"
  | "settings"
  | "knowledge-sphere"
  | "knowledge-network"
  | "rss"
  | "newsletter"
  | "web-browser"
  | "doc-qa"
  | "notebooklm"
  | "image-registry"
  | "podcast"
  | "audiobook-epub-sync"
  | "audiobook"
  | "extract-reader"
  | "document-extracts"
  | "extracts";

export interface Tab {
  id: string;
  title: string;
  icon: ReactNode;
  type: TabType;
  content: ComponentType;
  closable: boolean;
  data?: Record<string, unknown>;
}

export interface WorkspaceTabInfo {
  tab: Tab;
  paneId: string | null;
  isActive: boolean;
}

export interface SettingsReturnDestination {
  tabId: string;
  paneId: string;
  title: string;
}

// Split direction for panes
export type SplitDirection = "horizontal" | "vertical";

// Pane can either contain tabs or be split into more panes
export interface TabPane {
  id: string;
  type: "tabs";
  tabIds: string[];
  activeTabId: string | null;
}

export interface SplitPane {
  id: string;
  type: "split";
  direction: SplitDirection;
  sizes: number[]; // Percentages for each child
  children: Pane[];
}

export type Pane = TabPane | SplitPane;

export function normalizePane(pane: Pane | null | undefined): Pane {
  if (!pane || typeof pane !== "object") {
    return createTabPane();
  }

  if (pane.type === "tabs") {
    const tabIds = Array.isArray(pane.tabIds) ? pane.tabIds : [];
    const activeTabId =
      pane.activeTabId && tabIds.includes(pane.activeTabId) ? pane.activeTabId : tabIds[0] ?? null;
    const changed = tabIds !== pane.tabIds || activeTabId !== pane.activeTabId;
    return changed ? { ...pane, tabIds, activeTabId } : pane;
  }

  const children = Array.isArray(pane.children) ? pane.children : [];
  const normalizedChildren = children.map(normalizePane);
  const childrenChanged =
    !Array.isArray(pane.children) ||
    normalizedChildren.length !== children.length ||
    normalizedChildren.some((child, index) => child !== children[index]);
  const sizes = Array.isArray(pane.sizes) ? pane.sizes : [];
  const sizesValid =
    sizes.length === normalizedChildren.length &&
    sizes.every((size) => typeof size === "number" && Number.isFinite(size));
  const normalizedSizes = sizesValid
    ? sizes
    : (() => {
        const count = normalizedChildren.length || 1;
        const equal = 100 / count;
        return Array.from({ length: count }, () => equal);
      })();

  return childrenChanged || !sizesValid
    ? { ...pane, children: normalizedChildren, sizes: normalizedSizes }
    : pane;
}

// Helper to create a new tab pane
export function createTabPane(tabIds: string[] = [], activeTabId: string | null = null): TabPane {
  return {
    id: generateId(),
    type: "tabs",
    tabIds,
    activeTabId,
  };
}

// Helper to create a new split pane
export function createSplitPane(
  direction: SplitDirection,
  children: Pane[],
  sizes?: number[]
): SplitPane {
  const defaultSizes = children.map(() => 100 / children.length);
  return {
    id: generateId(),
    type: "split",
    direction,
    sizes: sizes || defaultSizes,
    children,
  };
}

export interface TabsState {
  // State
  tabs: Tab[];
  rootPane: Pane;
  closedTabs: Tab[];
  activeTabHistory: string[];
  // Tabs the user navigated "back" past — consumed by goToNextTab() (the
  // forward counterpart to the edge-swipe-back gesture). Mirrors the back
  // history's most-recent-last ordering.
  forwardTabHistory: string[];
  // Tabs unmounted by the resident-tab cap. Runtime-only and never persisted:
  // it describes what is currently in memory, not what the workspace contains.
  //
  // A tab is *resident* (mounted) when it has been activated at least once and
  // has not since been evicted — which is `activeTabHistory` (restricted to
  // still-open tabs) minus this set. Both halves already exist, so residency
  // needs no separate bookkeeping to drift out of sync: `setActiveTab` is the
  // only thing that adds to the history, and it also clears the tab from here.
  //
  // `TabContent` reads this to know what to unmount. It does not read a
  // "mounted" set, because it tracks activations it has actually rendered —
  // which keeps it drivable from plain props (see its own comment).
  evictedTabIds: ReadonlySet<string>;

  // Actions
  addTab: (tab: Omit<Tab, "id">, targetPaneId?: string) => string;
  addTabInBackground: (tab: Omit<Tab, "id">, targetPaneId?: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  reopenLastClosedTab: () => void;
  // Navigate to the previous tab (edge-swipe back). Returns true if navigation
  // happened — useful for callers that want to confirm a gesture was consumed.
  goToPreviousTab: () => boolean;
  // Navigate forward (edge-swipe forward). Returns true if navigation happened.
  goToNextTab: () => boolean;
  getSettingsReturnDestination: () => SettingsReturnDestination | null;
  returnFromSettings: () => boolean;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  moveTab: (fromIndex: number, toIndex: number, paneId?: string) => void;
  moveTabToPane: (tabId: string, fromPaneId: string, toPaneId: string, targetIndex?: number) => void;
  
  // Split actions
  splitPane: (paneId: string, tabId: string, direction: SplitDirection, side: "before" | "after") => void;
  spawnTabInSplit: (paneId: string, tabId: string, direction: SplitDirection, side: "before" | "after") => void;
  moveTabToSplit: (tabId: string, fromPaneId: string, targetPaneId: string, direction: SplitDirection, side: "before" | "after") => void;
  resizeSplit: (splitPaneId: string, newSizes: number[]) => void;
  collapseSplit: (splitPaneId: string, childPaneId: string) => void;
  
  // Pane queries
  findPaneById: (paneId: string) => Pane | null;
  findPaneContainingTab: (tabId: string) => TabPane | null;
  getAllPaneIds: () => string[];
  getTabPaneIds: () => string[];
  getWorkspaceTabs: () => WorkspaceTabInfo[];
  // Returns the most recently active open tab whose type is in `types`,
  // based on activeTabHistory order, or undefined if none is currently open.
  getMostRecentTabOfTypes: (types: TabType[]) => Tab | undefined;

  // Persistence
  saveTabs: () => void;
  loadTabs: () => Promise<boolean>;
  getDefaultTabs: () => Tab[];
}

const STORAGE_KEY = "incrementum-tabs";
const TAB_SAVE_DEBOUNCE_MS = 180;

/** Shared empty set, so a workspace that never evicts keeps one identity. */
const EMPTY_EVICTED: ReadonlySet<string> = new Set<string>();

/**
 * Drop ids from the evicted set, returning the *same* set when nothing changed.
 *
 * Identity stability is the point: `TabContent` subscribes to this set, so
 * allocating a fresh one on every activation would re-render every pane on
 * every tab switch — precisely the cost this area exists to avoid.
 */
function clearEvicted(
  current: ReadonlySet<string>,
  ids: Iterable<string>,
): ReadonlySet<string> {
  if (current.size === 0) return current;
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (!current.has(id)) continue;
    if (!next) next = new Set(current);
    next.delete(id);
  }
  if (!next) return current;
  return next.size === 0 ? EMPTY_EVICTED : next;
}
let pendingTabsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTabsSave: (() => void) | null = null;
let tabsPersistenceListenersInstalled = false;

// Rapid-switch profiling identified two synchronous contributors on the tab
// activation path: serializing the complete workspace snapshot in saveTabs()
// and JSON-stringifying every mounted tab's restore data in TabContent's memo
// comparator. Keep this note next to the persistence fix so future changes do
// not move serialization back into the interaction hot path.

function flushPendingTabsSave(): void {
  if (pendingTabsSaveTimer) {
    clearTimeout(pendingTabsSaveTimer);
    pendingTabsSaveTimer = null;
  }
  const save = pendingTabsSave;
  pendingTabsSave = null;
  save?.();
}

/**
 * Whether a debounced workspace-persistence save is currently pending. Exposed
 * for the memory-benchmark harness's quiescence signal (a pending save is an
 * in-flight position-persistence task); harmless and unused otherwise.
 */
export function hasPendingTabsSave(): boolean {
  return pendingTabsSaveTimer !== null || pendingTabsSave !== null;
}

function installTabsPersistenceListeners(): void {
  if (tabsPersistenceListenersInstalled || typeof window === "undefined") return;
  tabsPersistenceListenersInstalled = true;
  const flushWhenHidden = () => {
    if (document.visibilityState === "hidden") flushPendingTabsSave();
  };
  window.addEventListener("pagehide", flushPendingTabsSave);
  document.addEventListener("visibilitychange", flushWhenHidden);
}

function scheduleTabsSave(save: () => void): void {
  installTabsPersistenceListeners();
  pendingTabsSave = save;
  if (pendingTabsSaveTimer) clearTimeout(pendingTabsSaveTimer);
  pendingTabsSaveTimer = setTimeout(() => {
    pendingTabsSaveTimer = null;
    const pending = pendingTabsSave;
    pendingTabsSave = null;
    pending?.();
  }, TAB_SAVE_DEBOUNCE_MS);
}
const SINGLE_INSTANCE_TAB_TYPES: ReadonlySet<TabType> = new Set([
  "continue-reading",
  "dashboard",
  "queue",
  "queue-scroll",
  "review",
  "documents",
  "analytics",
  "settings",
  "knowledge-sphere",
  "knowledge-network",
  "rss",
  "newsletter",
  "doc-qa",
  "notebooklm",
  "audiobook",
  "extracts",
]);

/**
 * Tab types the resident cap is allowed to unmount.
 *
 * Opt-in, and deliberately small. A tab is listed here only once its whole
 * state is known to survive an unmount — because it is a read-only view over
 * stores or a fetch it repeats on mount. Anything holding state the user
 * created and has not saved (a viewer's pending annotation, a Q&A draft, an
 * in-flight rename in the image registry) stays off the list, so the worst case
 * of getting the cap wrong is a workspace that keeps more tabs than requested,
 * never a workspace that throws away someone's work.
 *
 * Lives here rather than in `tabContentRegistry` on purpose: this module must
 * not import `TabRegistry` at module scope (see the lazy import in `loadTabs`),
 * and this is the same kind of per-type policy as SINGLE_INSTANCE_TAB_TYPES.
 */
const EVICTABLE_TAB_TYPES: ReadonlySet<TabType> = new Set([
  "dashboard",
  "analytics",
  "continue-reading",
]);

export function isTabTypeEvictable(type: TabType): boolean {
  return EVICTABLE_TAB_TYPES.has(type);
}

/**
 * Tab types that are expensive document readers (design D11, task 8.1).
 *
 * These are governed by the separate `general.readerTabCap` (default 2:
 * active plus one warm) and are NOT in `EVICTABLE_TAB_TYPES`, so the general
 * resident cap never unmounts them; only the reader cap may. Non-reader tabs
 * are never evicted on account of the reader cap.
 */
const READER_TAB_TYPES: ReadonlySet<TabType> = new Set(["document-viewer"]);

export function isTabTypeReader(type: TabType): boolean {
  return READER_TAB_TYPES.has(type);
}

/**
 * Fallback resident cap, used when a persisted settings blob predates the
 * setting (or when a test mocks the settings store without it). Kept as a local
 * constant rather than read from `defaultSettings` so this module does not
 * depend on the shape of a commonly-mocked import; `DEFAULT_RESIDENT_TAB_CAP`
 * is pinned equal to the shipped default by a test.
 */
export const DEFAULT_RESIDENT_TAB_CAP = 8;

/**
 * Fallback reader cap (task 8.1), pinned equal to the shipped default (2:
 * active reader plus one warm) by a test.
 */
export const DEFAULT_READER_TAB_CAP = 2;

/** The configured resident cap, or the default when settings do not carry one. */
function residentTabCap(): number {
  const configured = useSettingsStore.getState().settings?.general?.residentTabCap;
  return typeof configured === "number" ? configured : DEFAULT_RESIDENT_TAB_CAP;
}

/** The configured reader cap, or the default when settings do not carry one. */
function readerTabCap(): number {
  const configured = useSettingsStore.getState().settings?.general?.readerTabCap;
  return typeof configured === "number" ? configured : DEFAULT_READER_TAB_CAP;
}

/** Every pane's active tab — all of them are exempt from eviction. */
function collectActivePaneTabIds(pane: Pane, into: Set<string> = new Set()): Set<string> {
  if (pane.type === "tabs") {
    if (pane.activeTabId) into.add(pane.activeTabId);
  } else {
    for (const child of pane.children) collectActivePaneTabIds(child, into);
  }
  return into;
}

/**
 * Apply the resident-tab cap and the reader cap, returning the new evicted set
 * (the same one when nothing needed evicting, so subscribers do not re-render).
 *
 * Residency is derived, not stored: a tab is mounted when it has been activated
 * at least once — i.e. it appears in `activeTabHistory`, which is kept in
 * least-recently-active-first order and filtered to open tabs — and has not
 * since been evicted. Walking that history from the front therefore visits
 * candidates in exactly LRU order.
 *
 * The reader cap (task 8.2) is applied in the same pass: after the general cap
 * has its say, readers beyond `readerCap` are evicted LRU-first. Reader types
 * are never evicted by the general cap and non-reader tabs are never evicted
 * by the reader cap.
 */
function applyResidentCap(
  state: Pick<TabsState, "tabs" | "rootPane" | "activeTabHistory" | "evictedTabIds">,
  cap: number,
  readerCap: number,
): ReadonlySet<string> {
  if (!Number.isFinite(cap) || cap <= 0) return state.evictedTabIds;

  const openTabsById = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const resident = state.activeTabHistory.filter(
    (id) => openTabsById.has(id) && !state.evictedTabIds.has(id),
  );
  const exempt = collectActivePaneTabIds(state.rootPane);
  let next: Set<string> | null = null;
  const evict = (id: string) => {
    if (!next) next = new Set(state.evictedTabIds);
    next.add(id);
  };

  // General cap pass: evicts only EVICTABLE_TAB_TYPES.
  if (resident.length > cap) {
    let overBy = resident.length - cap;
    for (const id of resident) {
      if (overBy <= 0) break;
      if (exempt.has(id)) continue;
      const tab = openTabsById.get(id);
      if (!tab || !EVICTABLE_TAB_TYPES.has(tab.type)) continue;
      evict(id);
      overBy -= 1;
    }
  }

  // Reader cap pass: evicts only readers beyond the cap, LRU-first. A reader
  // the general pass already evicted is not resident, so it cannot be
  // double-counted here.
  if (Number.isFinite(readerCap) && readerCap > 0) {
    const residentReaders = resident.filter((id) => {
      const tab = openTabsById.get(id);
      return !!tab && READER_TAB_TYPES.has(tab.type);
    });
    if (residentReaders.length > readerCap) {
      let overBy = residentReaders.length - readerCap;
      for (const id of residentReaders) {
        if (overBy <= 0) break;
        if (exempt.has(id)) continue;
        evict(id);
        overBy -= 1;
      }
    }
  }

  // No eligible candidate: the cap is exceeded and stays exceeded. Keeping a
  // tab mounted is always preferable to unmounting one that cannot restore.
  return next ?? state.evictedTabIds;
}

/**
 * Serialize with sorted object keys, so the result depends on a payload's
 * content and not on the order its literal happened to be written in.
 *
 * Keys whose value is `undefined` are dropped and `undefined` array entries
 * become `null`, matching `JSON.stringify` — which is what this replaced, and
 * which correctly treats an explicitly-undefined field as an absent one.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Cache of restore-payload keys, keyed on the payload object itself.
 *
 * Opening a tab used to `JSON.stringify` both sides for every open tab — O(open
 * tabs) serializations on a click. Tab data is replaced rather than mutated, so
 * a payload object's key never changes and can be computed once and kept for as
 * long as that object lives.
 */
const dataKeyCache = new WeakMap<object, string>();

/** Stable structural key for a tab's restore payload; `undefined` maps to "". */
export function tabDataKey(data?: Record<string, unknown>): string {
  if (!data) return "";
  const cached = dataKeyCache.get(data);
  if (cached !== undefined) return cached;
  const key = stableStringify(data);
  dataKeyCache.set(data, key);
  return key;
}

function findReusableTab(state: TabsState, tab: Omit<Tab, "id">): Tab | undefined {
  if (SINGLE_INSTANCE_TAB_TYPES.has(tab.type)) {
    return state.tabs.find((existingTab) => existingTab.type === tab.type);
  }

  const key = tabDataKey(tab.data);
  return state.tabs.find(
    (existingTab) => existingTab.type === tab.type && tabDataKey(existingTab.data) === key,
  );
}

// Helper to find a pane by ID recursively
function findPaneByIdRecursive(pane: Pane, paneId: string): Pane | null {
  if (pane.id === paneId) return pane;
  if (pane.type === "split") {
    for (const child of pane.children) {
      const found = findPaneByIdRecursive(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

// Helper to find parent of a pane
function findParentPane(pane: Pane, targetId: string): SplitPane | null {
  if (pane.type === "split") {
    for (const child of pane.children) {
      if (child.id === targetId) return pane;
      const found = findParentPane(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

// Helper to find pane containing a tab
function findPaneContainingTabRecursive(pane: Pane, tabId: string): TabPane | null {
  if (pane.type === "tabs" && pane.tabIds.includes(tabId)) {
    return pane;
  }
  if (pane.type === "split") {
    for (const child of pane.children) {
      const found = findPaneContainingTabRecursive(child, tabId);
      if (found) return found;
    }
  }
  return null;
}

// Helper to collect all pane IDs
function collectPaneIds(pane: Pane, ids: string[] = []): string[] {
  ids.push(pane.id);
  if (pane.type === "split") {
    for (const child of pane.children) {
      collectPaneIds(child, ids);
    }
  }
  return ids;
}

// Helper to collect all tab pane IDs
function collectTabPaneIds(pane: Pane, ids: string[] = []): string[] {
  if (pane.type === "tabs") {
    ids.push(pane.id);
  } else if (pane.type === "split") {
    for (const child of pane.children) {
      collectTabPaneIds(child, ids);
    }
  }
  return ids;
}

// Helper to update pane in tree
function updatePaneInTree(root: Pane, paneId: string, updater: (pane: Pane) => Pane): Pane {
  if (root.id === paneId) {
    return updater(root);
  }
  if (root.type === "split") {
    return {
      ...root,
      children: root.children.map((child) => updatePaneInTree(child, paneId, updater)),
    };
  }
  return root;
}

// Helper to remove pane from tree
function removePaneFromTree(root: Pane, paneId: string): Pane | null {
  // If root is the pane being removed, return null to remove it
  if (root.id === paneId) {
    return null;
  }

  if (root.type === "split") {
    // We need to track both the new children and their ORIGINAL sizes to recalculate correctly
    const keptChildrenWithSizes: { pane: Pane; size: number }[] = [];

    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      const newChild = removePaneFromTree(child, paneId);
      if (newChild) {
        keptChildrenWithSizes.push({ pane: newChild, size: root.sizes[i] });
      }
    }

    if (keptChildrenWithSizes.length === 0) {
      return null;
    }
    if (keptChildrenWithSizes.length === 1) {
      // Collapse split with single child
      return keptChildrenWithSizes[0].pane;
    }

    // Recalculate sizes based on the remaining children's original sizes
    const totalSize = keptChildrenWithSizes.reduce((sum, item) => sum + item.size, 0);
    const newSizes = keptChildrenWithSizes.map((item) => (item.size / totalSize) * 100);
    const newChildren = keptChildrenWithSizes.map((item) => item.pane);

    return { ...root, children: newChildren, sizes: newSizes };
  }
  return root;
}

// Serialized tab data shape from localStorage
interface SerializedTabData {
  id: string;
  title: string;
  icon: string;
  type: TabType;
  closable: boolean;
  data?: Record<string, unknown>;
}

function filterInvalidTabsFromPane(pane: Pane, validTabIds: Set<string>): Pane {
  if (pane.type === "tabs") {
    const tabIds = pane.tabIds.filter((id) => validTabIds.has(id));
    const activeTabId =
      pane.activeTabId && tabIds.includes(pane.activeTabId)
        ? pane.activeTabId
        : tabIds[0] ?? null;
    return { ...pane, tabIds, activeTabId };
  }
  return {
    ...pane,
    children: pane.children.map((child) => filterInvalidTabsFromPane(child, validTabIds)),
  };
}

// Collapse empty TabPanes from the tree
function cleanupEmptyPanes(pane: Pane): Pane {
  if (pane.type === "tabs") return pane;

  const cleanedChildren = pane.children
    .map(cleanupEmptyPanes)
    .filter((child): child is Pane => {
      if (child.type === "tabs") return child.tabIds.length > 0;
      return child.children.length > 0;
    });

  if (cleanedChildren.length === 0) return createTabPane();
  if (cleanedChildren.length === 1) return cleanedChildren[0];

  const totalSize = cleanedChildren.reduce((sum) => sum + 100 / cleanedChildren.length, 0);
  const sizes = cleanedChildren.map(() => (100 / cleanedChildren.length));

  return { ...pane, children: cleanedChildren, sizes };
}

export const useTabsStore = create<TabsState>((set, get) => ({
  // Initial State
  tabs: [],
  rootPane: createTabPane(),
  closedTabs: [],
  activeTabHistory: [],
  forwardTabHistory: [],
  evictedTabIds: EMPTY_EVICTED,

  getDefaultTabs: () => {
    return [];
  },

  // Add a new tab
  addTab: (tab, targetPaneId?) => {
    const state = get();
    const existingTab = findReusableTab(state, tab);

    if (existingTab) {
      set((state) => {
        // Find the pane containing this tab and activate it
        const pane = findPaneContainingTabRecursive(state.rootPane, existingTab.id);
        if (pane) {
          return {
            rootPane: updatePaneInTree(state.rootPane, pane.id, (p) => ({
              ...(p as TabPane),
              activeTabId: existingTab.id,
            })),
            activeTabHistory: [...state.activeTabHistory.filter((x) => x !== existingTab.id), existingTab.id],
          };
        }
        return {};
      });
      get().saveTabs();
      return existingTab.id;
    }

    const id = generateId();
    const newTab: Tab = { ...tab, id };

    set((state) => {
      // Use provided targetPaneId if valid, otherwise find the first tab pane
      let finalTargetPaneId: string;
      
      if (targetPaneId) {
        // Verify the target pane exists
        const targetPane = findPaneByIdRecursive(state.rootPane, targetPaneId);
        if (targetPane && targetPane.type === "tabs") {
          finalTargetPaneId = targetPaneId;
        } else {
          // Fall back to first pane if target is invalid
          const findFirstTabPane = (p: Pane): TabPane | null => {
            if (p.type === "tabs") return p;
            if (p.type === "split") {
              for (const child of p.children) {
                const found = findFirstTabPane(child);
                if (found) return found;
              }
            }
            return null;
          };
          const firstPane = findFirstTabPane(state.rootPane);
          if (firstPane) {
            finalTargetPaneId = firstPane.id;
          } else {
            const newPane = createTabPane([id], id);
            return {
              tabs: [...state.tabs, newTab],
              rootPane: newPane,
              activeTabHistory: [...state.activeTabHistory.filter((x) => x !== id), id],
            };
          }
        }
      } else {
        // No target provided, find the first tab pane
        const findFirstTabPane = (p: Pane): TabPane | null => {
          if (p.type === "tabs") return p;
          if (p.type === "split") {
            for (const child of p.children) {
              const found = findFirstTabPane(child);
              if (found) return found;
            }
          }
          return null;
        };
        const firstPane = findFirstTabPane(state.rootPane);
        if (firstPane) {
          finalTargetPaneId = firstPane.id;
        } else {
          const newPane = createTabPane([id], id);
          return {
            tabs: [...state.tabs, newTab],
            rootPane: newPane,
            activeTabHistory: [...state.activeTabHistory.filter((x) => x !== id), id],
          };
        }
      }

      return {
        tabs: [...state.tabs, newTab],
        rootPane: updatePaneInTree(state.rootPane, finalTargetPaneId, (p) => ({
          ...(p as TabPane),
          tabIds: [...(p as TabPane).tabIds, id],
          activeTabId: id,
        })),
        activeTabHistory: [...state.activeTabHistory.filter((x) => x !== id), id],
      };
    });

    get().saveTabs();
    return id;
  },

  // Add a new tab in background
  addTabInBackground: (tab, targetPaneId?) => {
    const state = get();
    const existingTab = findReusableTab(state, tab);

    if (existingTab) {
      return existingTab.id;
    }

    const id = generateId();
    const newTab: Tab = { ...tab, id };

    set((state) => {
      // Use provided targetPaneId if valid, otherwise find the first tab pane
      let finalTargetPaneId: string;
      
      if (targetPaneId) {
        // Verify the target pane exists
        const targetPane = findPaneByIdRecursive(state.rootPane, targetPaneId);
        if (targetPane && targetPane.type === "tabs") {
          finalTargetPaneId = targetPaneId;
        } else {
          // Fall back to first pane if target is invalid
          const findFirstTabPane = (p: Pane): TabPane | null => {
            if (p.type === "tabs") return p;
            if (p.type === "split") {
              for (const child of p.children) {
                const found = findFirstTabPane(child);
                if (found) return found;
              }
            }
            return null;
          };
          const firstPane = findFirstTabPane(state.rootPane);
          if (firstPane) {
            finalTargetPaneId = firstPane.id;
          } else {
            const newPane = createTabPane([id], null);
            return {
              tabs: [...state.tabs, newTab],
              rootPane: newPane,
            };
          }
        }
      } else {
        // No target provided, find the first tab pane
        const findFirstTabPane = (p: Pane): TabPane | null => {
          if (p.type === "tabs") return p;
          if (p.type === "split") {
            for (const child of p.children) {
              const found = findFirstTabPane(child);
              if (found) return found;
            }
          }
          return null;
        };
        const firstPane = findFirstTabPane(state.rootPane);
        if (firstPane) {
          finalTargetPaneId = firstPane.id;
        } else {
          const newPane = createTabPane([id], null);
          return {
            tabs: [...state.tabs, newTab],
            rootPane: newPane,
          };
        }
      }

      const targetPane = findPaneByIdRecursive(state.rootPane, finalTargetPaneId) as TabPane;
      return {
        tabs: [...state.tabs, newTab],
        rootPane: updatePaneInTree(state.rootPane, finalTargetPaneId, (p) => ({
          ...(p as TabPane),
          tabIds: [...(p as TabPane).tabIds, id],
          activeTabId: targetPane.activeTabId,
        })),
      };
    });

    get().saveTabs();
    return id;
  },

  // Close a tab
  closeTab: (tabId) => {
    set((state) => {
      const tabToClose = state.tabs.find((t) => t.id === tabId);
      if (tabToClose && !tabToClose.closable) {
        return state;
      }

      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      const closedTabs = tabToClose ? [...state.closedTabs, tabToClose] : state.closedTabs;

      if (newTabs.length === 0) {
        return state;
      }

      // Find and update the pane containing this tab
      const pane = findPaneContainingTabRecursive(state.rootPane, tabId);
      if (!pane) return state;

      const newTabIds = pane.tabIds.filter((id) => id !== tabId);
      let newActiveTabId = pane.activeTabId;

      const newHistory = state.activeTabHistory.filter((x) => x !== tabId);

      if (pane.activeTabId === tabId) {
        let foundPreviousActive = false;
        for (let i = newHistory.length - 1; i >= 0; i--) {
          const candidateId = newHistory[i];
          if (newTabIds.includes(candidateId)) {
            newActiveTabId = candidateId;
            foundPreviousActive = true;
            break;
          }
        }

        if (!foundPreviousActive) {
          const closedIndex = pane.tabIds.findIndex((id) => id === tabId);
          const newIndex = Math.max(0, closedIndex - 1);
          newActiveTabId = newTabIds[newIndex] || null;
        }
      }

      const isLastTabInOnlyPane = newTabIds.length === 0 && 
        state.rootPane.type === "tabs" && 
        state.rootPane.id === pane.id;

      // If pane is empty and it's not the only pane, remove it
      let newRootPane = state.rootPane;
      if (newTabIds.length === 0 && !isLastTabInOnlyPane) {
        newRootPane = removePaneFromTree(state.rootPane, pane.id) || createTabPane();
      } else {
        newRootPane = updatePaneInTree(state.rootPane, pane.id, (p) => ({
          ...(p as TabPane),
          tabIds: newTabIds,
          activeTabId: newActiveTabId,
        }));
      }

      setTimeout(() => get().saveTabs(), 0);

      return {
        tabs: newTabs,
        rootPane: newRootPane,
        closedTabs,
        activeTabHistory: newHistory,
        evictedTabIds: clearEvicted(state.evictedTabIds, [tabId]),
      };
    });
  },

  // Set the active tab in a specific pane
  setActiveTab: (paneId, tabId) => {
    set((state) => {
      const rootPane = updatePaneInTree(state.rootPane, paneId, (p) => ({
        ...(p as TabPane),
        activeTabId: tabId,
      }));
      const activeTabHistory = [
        ...state.activeTabHistory.filter((x) => x !== tabId),
        tabId,
      ];
      // Activating a tab makes it resident again if the cap had evicted it.
      const evictedTabIds = clearEvicted(state.evictedTabIds, [tabId]);

      return {
        rootPane,
        activeTabHistory,
        // A direct navigation invalidates any forward history (browser semantics).
        forwardTabHistory: [],
        // The cap is evaluated here rather than on a timer: activation is
        // the only moment the resident set can grow, and a timer would both
        // wake an idle app and make "when does a tab disappear" untestable.
        evictedTabIds: applyResidentCap(
          { tabs: state.tabs, rootPane, activeTabHistory, evictedTabIds },
          residentTabCap(),
          readerTabCap(),
        ),
      };
    });
    scheduleTabsSave(() => get().saveTabs());
  },

  updateTab: (tabId, updates) => {
    set((state) => {
      const tabs = state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab));
      return { tabs };
    });
    get().saveTabs();
  },

  reopenLastClosedTab: () => {
    set((state) => {
      const closedTabs = [...state.closedTabs];
      const lastClosed = closedTabs.pop();
      if (!lastClosed) return state;

      if (state.tabs.some((tab) => tab.id === lastClosed.id)) {
        return { closedTabs };
      }

      // Find first tab pane to add to
      let targetPaneId: string;
      const findFirstTabPane = (p: Pane): TabPane | null => {
        if (p.type === "tabs") return p;
        if (p.type === "split") {
          for (const child of p.children) {
            const found = findFirstTabPane(child);
            if (found) return found;
          }
        }
        return null;
      };
      const firstPane = findFirstTabPane(state.rootPane);
      if (!firstPane) return state;
      targetPaneId = firstPane.id;

      const tabs = [...state.tabs, lastClosed];
      return {
        tabs,
        rootPane: updatePaneInTree(state.rootPane, targetPaneId, (p) => ({
          ...(p as TabPane),
          tabIds: [...(p as TabPane).tabIds, lastClosed.id],
          activeTabId: lastClosed.id,
        })),
        closedTabs,
        activeTabHistory: [...state.activeTabHistory.filter((x) => x !== lastClosed.id), lastClosed.id],
      };
    });
    setTimeout(() => get().saveTabs(), 0);
  },

  getSettingsReturnDestination: () => {
    const state = get();
    const settingsTab = state.tabs.find((tab) => tab.type === "settings");
    if (!settingsTab) return null;

    const settingsPane = findPaneContainingTabRecursive(state.rootPane, settingsTab.id);
    if (!settingsPane || settingsPane.activeTabId !== settingsTab.id) return null;

    const paneIds = new Set(settingsPane.tabIds);
    for (let index = state.activeTabHistory.length - 1; index >= 0; index--) {
      const candidateId = state.activeTabHistory[index];
      if (candidateId === settingsTab.id || !paneIds.has(candidateId)) continue;

      const candidate = state.tabs.find(
        (tab) => tab.id === candidateId && tab.type !== "settings",
      );
      if (candidate) {
        return {
          tabId: candidate.id,
          paneId: settingsPane.id,
          title: candidate.title,
        };
      }
    }

    return null;
  },

  returnFromSettings: () => {
    const state = get();
    const settingsTab = state.tabs.find((tab) => tab.type === "settings");
    if (!settingsTab) return false;

    const settingsPane = findPaneContainingTabRecursive(state.rootPane, settingsTab.id);
    if (!settingsPane || settingsPane.activeTabId !== settingsTab.id) return false;

    const destination = state.getSettingsReturnDestination();
    const dashboardInPane = state.tabs.find(
      (tab) => tab.type === "dashboard" && settingsPane.tabIds.includes(tab.id),
    );
    const targetId = destination?.tabId ?? dashboardInPane?.id ?? null;

    if (targetId) {
      set((current) => ({
        rootPane: updatePaneInTree(current.rootPane, settingsPane.id, (pane) => ({
          ...(pane as TabPane),
          activeTabId: targetId,
        })),
        forwardTabHistory: [
          ...current.forwardTabHistory.filter((id) => id !== settingsTab.id),
          settingsTab.id,
        ],
      }));
      setTimeout(() => get().saveTabs(), 0);
      return true;
    }

    // Keep fallback creation on the app's existing navigation path so the
    // dashboard receives its canonical component, title, and singleton rules.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/dashboard" }));
      return true;
    }

    return false;
  },

  // Edge-swipe back: activate the tab visited just before the current one.
  // Pushes the current tab onto forwardTabHistory (so goToNextTab can return).
  // No-ops (returns false) if there's no tab to go back to.
  goToPreviousTab: () => {
    const state = get();
    const history = state.activeTabHistory;
    // History is most-recent-last; the current active tab is the last entry.
    // We need the entry before it that is still open and in the first tab pane
    // (mobile only renders the first tab pane).
    const findFirstTabPane = (p: Pane): TabPane | null => {
      if (p.type === "tabs") return p;
      if (p.type === "split") {
        for (const child of p.children) {
          const found = findFirstTabPane(child);
          if (found) return found;
        }
      }
      return null;
    };
    const firstPane = findFirstTabPane(state.rootPane);
    if (!firstPane) return false;
    const openIds = new Set(firstPane.tabIds);

    if (history.length < 2) return false;

    // Walk back from the end, skipping the current tab, to find a valid target.
    let targetId: string | null = null;
    for (let i = history.length - 2; i >= 0; i--) {
      if (openIds.has(history[i])) {
        targetId = history[i];
        break;
      }
    }
    if (!targetId || targetId === firstPane.activeTabId) return false;

    const currentId = firstPane.activeTabId;
    set((s) => ({
      rootPane: updatePaneInTree(s.rootPane, firstPane.id, (p) => ({
        ...(p as TabPane),
        activeTabId: targetId!,
      })),
      // Move current tab to the forward stack so goToNextTab can retrace it.
      forwardTabHistory: currentId
        ? [...s.forwardTabHistory.filter((x) => x !== currentId), currentId]
        : s.forwardTabHistory,
    }));
    setTimeout(() => get().saveTabs(), 0);
    return true;
  },

  // Edge-swipe forward: retrace a prior "back". Consumes forwardTabHistory.
  // Returns false if there is nowhere to go forward.
  goToNextTab: () => {
    const state = get();
    const findFirstTabPane = (p: Pane): TabPane | null => {
      if (p.type === "tabs") return p;
      if (p.type === "split") {
        for (const child of p.children) {
          const found = findFirstTabPane(child);
          if (found) return found;
        }
      }
      return null;
    };
    const firstPane = findFirstTabPane(state.rootPane);
    if (!firstPane) return false;
    const openIds = new Set(firstPane.tabIds);

    if (state.forwardTabHistory.length === 0) return false;

    let targetId: string | null = null;
    for (let i = state.forwardTabHistory.length - 1; i >= 0; i--) {
      if (openIds.has(state.forwardTabHistory[i])) {
        targetId = state.forwardTabHistory[i];
        break;
      }
    }
    if (!targetId || targetId === firstPane.activeTabId) return false;

    const currentId = firstPane.activeTabId;
    set((s) => ({
      rootPane: updatePaneInTree(s.rootPane, firstPane.id, (p) => ({
        ...(p as TabPane),
        activeTabId: targetId!,
      })),
      // Pop the target off the forward stack; re-add current so a subsequent
      // back/forward ping-pongs correctly.
      forwardTabHistory: currentId
        ? [
            ...s.forwardTabHistory.filter(
              (x) => x !== targetId && x !== currentId
            ),
            currentId,
          ]
        : s.forwardTabHistory.filter((x) => x !== targetId),
    }));
    setTimeout(() => get().saveTabs(), 0);
    return true;
  },

  closeOtherTabs: (tabId) => {
    set((state) => {
      const pane = findPaneContainingTabRecursive(state.rootPane, tabId);
      if (!pane) return state;

      const tabToKeep = state.tabs.find((t) => t.id === tabId);
      if (!tabToKeep) return state;

      const closableTabs = pane.tabIds.filter((id) => {
        const t = state.tabs.find((tab) => tab.id === id);
        return t?.closable && id !== tabId;
      });

      const newClosedTabs = [
        ...state.closedTabs,
        ...state.tabs.filter((t) => closableTabs.includes(t.id)),
      ];

      setTimeout(() => get().saveTabs(), 0);

      return {
        tabs: state.tabs.filter((t) => !closableTabs.includes(t.id)),
        rootPane: updatePaneInTree(state.rootPane, pane.id, (p) => ({
          ...(p as TabPane),
          tabIds: [tabId],
          activeTabId: tabId,
        })),
        closedTabs: newClosedTabs,
        activeTabHistory: [tabId],
        evictedTabIds: clearEvicted(state.evictedTabIds, closableTabs),
      };
    });
  },

  closeTabsToRight: (tabId) => {
    set((state) => {
      const pane = findPaneContainingTabRecursive(state.rootPane, tabId);
      if (!pane) return state;

      const tabIndex = pane.tabIds.findIndex((id) => id === tabId);
      const tabsToClose = pane.tabIds.slice(tabIndex + 1).filter((id) => {
        const t = state.tabs.find((tab) => tab.id === id);
        return t?.closable;
      });

      const newClosedTabs = [
        ...state.closedTabs,
        ...state.tabs.filter((t) => tabsToClose.includes(t.id)),
      ];

      setTimeout(() => get().saveTabs(), 0);

      return {
        tabs: state.tabs.filter((t) => !tabsToClose.includes(t.id)),
        rootPane: updatePaneInTree(state.rootPane, pane.id, (p) => ({
          ...(p as TabPane),
          tabIds: (p as TabPane).tabIds.filter((id) => !tabsToClose.includes(id)),
        })),
        closedTabs: newClosedTabs,
        activeTabHistory: state.activeTabHistory.filter((id) => !tabsToClose.includes(id)),
        evictedTabIds: clearEvicted(state.evictedTabIds, tabsToClose),
      };
    });
  },

  closeAllTabs: () => {
    set((state) => {
      const allClosableTabs = state.tabs.filter((t) => t.closable);
      const newClosedTabs = [...state.closedTabs, ...allClosableTabs];

      // Find first non-closable tab to keep
      const firstNonClosable = state.tabs.find((t) => !t.closable);
      
      setTimeout(() => get().saveTabs(), 0);

      if (firstNonClosable) {
        return {
          tabs: [firstNonClosable],
          rootPane: createTabPane([firstNonClosable.id], firstNonClosable.id),
          closedTabs: newClosedTabs,
          activeTabHistory: [firstNonClosable.id],
          evictedTabIds: EMPTY_EVICTED,
        };
      }

      return {
        tabs: [],
        rootPane: createTabPane(),
        closedTabs: newClosedTabs,
        activeTabHistory: [],
        evictedTabIds: EMPTY_EVICTED,
      };
    });
  },

  moveTab: (fromIndex, toIndex, paneId) => {
    set((state) => {
      if (paneId) {
        // Move within a specific pane
        const pane = findPaneByIdRecursive(state.rootPane, paneId) as TabPane;
        if (!pane) return state;

        const newTabIds = [...pane.tabIds];
        if (fromIndex < 0 || fromIndex >= newTabIds.length) return state;
        if (toIndex < 0 || toIndex >= newTabIds.length) return state;

        const [movedTab] = newTabIds.splice(fromIndex, 1);
        newTabIds.splice(toIndex, 0, movedTab);

        setTimeout(() => get().saveTabs(), 0);

        return {
          rootPane: updatePaneInTree(state.rootPane, paneId, (p) => ({
            ...(p as TabPane),
            tabIds: newTabIds,
          })),
        };
      }
      
      // Legacy: move in global tabs array
      if (fromIndex < 0 || fromIndex >= state.tabs.length) return state;
      if (toIndex < 0 || toIndex >= state.tabs.length) return state;

      const newTabs = [...state.tabs];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);

      setTimeout(() => get().saveTabs(), 0);

      return { tabs: newTabs };
    });
  },

  moveTabToPane: (tabId, fromPaneId, toPaneId, targetIndex) => {
    set((state) => {
      const fromPane = findPaneByIdRecursive(state.rootPane, fromPaneId) as TabPane;
      const toPane = findPaneByIdRecursive(state.rootPane, toPaneId) as TabPane;
      
      if (!fromPane || !toPane) return state;

      const newFromTabIds = fromPane.tabIds.filter((id) => id !== tabId);
      let newFromActiveTabId = fromPane.activeTabId;
      if (fromPane.activeTabId === tabId) {
        const idx = fromPane.tabIds.findIndex((id) => id === tabId);
        newFromActiveTabId = newFromTabIds[Math.max(0, idx - 1)] || null;
      }

      // Add to target pane
      const newToTabIds = [...toPane.tabIds];
      const insertIndex = targetIndex !== undefined ? targetIndex : newToTabIds.length;
      newToTabIds.splice(insertIndex, 0, tabId);

      let newRootPane = updatePaneInTree(state.rootPane, fromPaneId, (p) => ({
        ...(p as TabPane),
        tabIds: newFromTabIds,
        activeTabId: newFromActiveTabId,
      }));

      const finalActiveId = toPane.activeTabId || tabId;
      newRootPane = updatePaneInTree(newRootPane, toPaneId, (p) => ({
        ...(p as TabPane),
        tabIds: newToTabIds,
        activeTabId: finalActiveId,
      }));

      const finalPane = findPaneByIdRecursive(newRootPane, fromPaneId) as TabPane;
      if (finalPane && finalPane.tabIds.length === 0) {
        newRootPane = removePaneFromTree(newRootPane, fromPaneId) || createTabPane();
      }

      setTimeout(() => get().saveTabs(), 0);

      const historyWithActives = [...state.activeTabHistory];
      if (newFromActiveTabId) {
        historyWithActives.push(newFromActiveTabId);
      }
      historyWithActives.push(finalActiveId);
      const finalHistory = Array.from(new Set(historyWithActives));

      return {
        rootPane: newRootPane,
        activeTabHistory: finalHistory,
      };
    });
  },

  splitPane: (paneId, tabId, direction, side) => {
    set((state) => {
      const pane = findPaneByIdRecursive(state.rootPane, paneId) as TabPane;
      if (!pane) return state;

      const newPane = createTabPane([tabId], tabId);
      
      const newTabIds = pane.tabIds.filter((id) => id !== tabId);
      const newActiveTabId = pane.activeTabId === tabId 
        ? (newTabIds[0] || null)
        : pane.activeTabId;

      const updatedOriginalPane: TabPane = {
        ...pane,
        tabIds: newTabIds,
        activeTabId: newActiveTabId,
      };

      const children = side === "before" 
        ? [newPane, updatedOriginalPane]
        : [updatedOriginalPane, newPane];
      const sizes = [50, 50];

      const splitPane = createSplitPane(direction, children, sizes);

      // Replace the original pane with the split
      const parent = findParentPane(state.rootPane, paneId);
      let newRootPane: Pane;
      
      if (parent) {
        newRootPane = updatePaneInTree(state.rootPane, parent.id, (p) => {
          const splitParent = p as SplitPane;
          return {
            ...splitParent,
            children: splitParent.children.map((child) =>
              child.id === paneId ? splitPane : child
            ),
          };
        });
      } else {
        newRootPane = splitPane;
      }

      setTimeout(() => get().saveTabs(), 0);

      const historyWithBoth = [...state.activeTabHistory];
      if (newActiveTabId) {
        historyWithBoth.push(newActiveTabId);
      }
      historyWithBoth.push(tabId);
      const finalHistory = Array.from(new Set(historyWithBoth));

      return {
        rootPane: newRootPane,
        activeTabHistory: finalHistory,
      };
    });
  },

  spawnTabInSplit: (paneId, tabId, direction, side) => {
    set((state) => {
      const pane = findPaneByIdRecursive(state.rootPane, paneId) as TabPane;
      if (!pane || pane.type !== "tabs") return state;

      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      const newTabId = generateId();
      const clonedTab: Tab = { ...tab, id: newTabId };

      const newPane = createTabPane([newTabId], newTabId);
      const children = side === "before" ? [newPane, pane] : [pane, newPane];
      const splitPane = createSplitPane(direction, children, [50, 50]);

      const parent = findParentPane(state.rootPane, paneId);
      let newRootPane: Pane;
      if (parent) {
        newRootPane = updatePaneInTree(state.rootPane, parent.id, (p) => {
          const splitParent = p as SplitPane;
          return {
            ...splitParent,
            children: splitParent.children.map((child) => (child.id === paneId ? splitPane : child)),
          };
        });
      } else {
        newRootPane = splitPane;
      }

      setTimeout(() => get().saveTabs(), 0);
      return {
        tabs: [...state.tabs, clonedTab],
        rootPane: newRootPane,
        activeTabHistory: [...state.activeTabHistory.filter((x) => x !== newTabId), newTabId],
      };
    });
  },

  moveTabToSplit: (tabId, fromPaneId, targetPaneId, direction, side) => {
    set((state) => {
      const fromPane = findPaneByIdRecursive(state.rootPane, fromPaneId) as TabPane;
      const targetPane = findPaneByIdRecursive(state.rootPane, targetPaneId) as TabPane;
      
      if (!fromPane || !targetPane) return state;

      const newFromTabIds = fromPane.tabIds.filter((id) => id !== tabId);
      const newFromActiveTabId = fromPane.activeTabId === tabId
        ? (newFromTabIds[0] || null)
        : fromPane.activeTabId;

      const newPane = createTabPane([tabId], tabId);

      const children = side === "before"
        ? [newPane, targetPane]
        : [targetPane, newPane];

      const splitPane = createSplitPane(direction, children, [50, 50]);

      let newRootPane = updatePaneInTree(state.rootPane, fromPaneId, (p) => ({
        ...(p as TabPane),
        tabIds: newFromTabIds,
        activeTabId: newFromActiveTabId,
      }));

      // Replace target pane with split
      const parent = findParentPane(newRootPane, targetPaneId);
      if (parent) {
        newRootPane = updatePaneInTree(newRootPane, parent.id, (p) => {
          const splitParent = p as SplitPane;
          return {
            ...splitParent,
            children: splitParent.children.map((child) =>
              child.id === targetPaneId ? splitPane : child
            ),
          };
        });
      } else if (newRootPane.id === targetPaneId) {
        newRootPane = splitPane;
      }

      const finalFromPane = findPaneByIdRecursive(newRootPane, fromPaneId) as TabPane;
      if (finalFromPane && finalFromPane.tabIds.length === 0) {
        newRootPane = removePaneFromTree(newRootPane, fromPaneId) || createTabPane();
      }

      setTimeout(() => get().saveTabs(), 0);

      const historyWithBoth = [...state.activeTabHistory];
      if (newFromActiveTabId) {
        historyWithBoth.push(newFromActiveTabId);
      }
      historyWithBoth.push(tabId);
      const finalHistory = Array.from(new Set(historyWithBoth));

      return {
        rootPane: newRootPane,
        activeTabHistory: finalHistory,
      };
    });
  },

  resizeSplit: (splitPaneId, newSizes) => {
    set((state) => ({
      rootPane: updatePaneInTree(state.rootPane, splitPaneId, (p) => ({
        ...(p as SplitPane),
        sizes: newSizes,
      })),
    }));
    get().saveTabs();
  },

  collapseSplit: (splitPaneId, childPaneId) => {
    set((state) => {
      const splitPane = findPaneByIdRecursive(state.rootPane, splitPaneId) as SplitPane;
      if (!splitPane) return state;

      const childToKeep = splitPane.children.find((c) => c.id !== childPaneId);
      if (!childToKeep) return state;

      const parent = findParentPane(state.rootPane, splitPaneId);
      let newRootPane: Pane;

      if (parent) {
        newRootPane = updatePaneInTree(state.rootPane, parent.id, (p) => {
          const splitParent = p as SplitPane;
          return {
            ...splitParent,
            children: splitParent.children.map((child) =>
              child.id === splitPaneId ? childToKeep : child
            ),
          };
        });
      } else {
        newRootPane = childToKeep;
      }

      setTimeout(() => get().saveTabs(), 0);

      return { rootPane: newRootPane };
    });
  },

  findPaneById: (paneId) => {
    return findPaneByIdRecursive(get().rootPane, paneId);
  },

  findPaneContainingTab: (tabId) => {
    return findPaneContainingTabRecursive(get().rootPane, tabId);
  },

  getAllPaneIds: () => {
    return collectPaneIds(get().rootPane);
  },

  getTabPaneIds: () => {
    return collectTabPaneIds(get().rootPane);
  },

  getWorkspaceTabs: () => get().tabs.map((tab) => {
    const pane = findPaneContainingTabRecursive(get().rootPane, tab.id);
    return { tab, paneId: pane?.id ?? null, isActive: pane?.activeTabId === tab.id };
  }),

  getMostRecentTabOfTypes: (types) => {
    const state = get();
    for (let index = state.activeTabHistory.length - 1; index >= 0; index--) {
      const tab = state.tabs.find((t) => t.id === state.activeTabHistory[index]);
      if (tab && types.includes(tab.type)) {
        return tab;
      }
    }
    return undefined;
  },

  saveTabs: () => {
    try {
      if (pendingTabsSaveTimer) {
        clearTimeout(pendingTabsSaveTimer);
        pendingTabsSaveTimer = null;
      }
      pendingTabsSave = null;
      const state = get();
      const serializableTabs = state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        icon: tab.icon,
        type: tab.type,
        closable: tab.closable,
        data: tab.data,
      }));

      // Collect UI state from other stores for session restore
      let uiState: Record<string, unknown> | undefined;
      try {
        const ui = useUIStore.getState();
        const coll = useCollectionStore.getState();
        uiState = {
          sidebarCollapsed: ui.sidebarCollapsed,
          currentView: ui.currentView,
          activeCollectionId: coll.activeCollectionId,
        };
      } catch {
        // Stores may not be available during SSR or tests
      }

      const data = {
        tabs: serializableTabs,
        rootPane: state.rootPane,
        uiState,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save tabs:", error);
    }
  },

  loadTabs: async () => {
    try {
      // Gate on the restoreSession setting
      if (!useSettingsStore.getState().settings.general.restoreSession) return false;

      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;

      const data = JSON.parse(stored);
      if (!data.tabs || !Array.isArray(data.tabs) || !data.rootPane) return false;

      // Lazy import to avoid circular dep at module load time
      const { rehydrateTab } = await import("../components/tabs/TabRegistry") as {
        rehydrateTab: (s: SerializedTabData) => Tab;
      };

      // The dynamic import above is an async gap during boot. If the user
      // already opened a tab in that window (bottom nav is interactive
      // immediately), the unconditional set() below would clobber it with the
      // stale saved session — the "first view switch doesn't load, second
      // one does" bug. Restoring into a non-empty workspace is a no-op.
      if (get().tabs.length > 0) return false;

      const validTabIds = new Set<string>();

      // Rehydrate tabs, filtering out invalid ones
      const rehydratedTabs: Tab[] = [];
      for (const serialized of data.tabs) {
        try {
          // A document viewer is driven entirely by `data.documentId` (TabWrapper
          // spreads `data` as props). Without it the viewer renders nothing, so the
          // tab would restore as a permanently blank pane. Drop it instead.
          if (
            (serialized.type === "document-viewer" ||
              serialized.type === "audiobook-epub-sync") &&
            !serialized.data?.documentId
          ) {
            console.warn("Dropping document tab with no documentId:", serialized.id);
            continue;
          }
          // The extract reader needs at least an extract id to rehydrate.
          if (serialized.type === "extract-reader" && !serialized.data?.extractId) {
            console.warn("Dropping extract reader tab with no extractId:", serialized.id);
            continue;
          }
          // The document-extracts tab is driven by `data.documentId`.
          if (serialized.type === "document-extracts" && !serialized.data?.documentId) {
            console.warn("Dropping document-extracts tab with no documentId:", serialized.id);
            continue;
          }
          const tab = rehydrateTab(serialized);
          rehydratedTabs.push(tab);
          validTabIds.add(tab.id);
        } catch {
          console.warn("Failed to rehydrate tab:", serialized.type, serialized.id);
        }
      }

      if (rehydratedTabs.length === 0) return false;

      // Filter pane tree to remove tabs that failed rehydration
      const filteredRootPane = filterInvalidTabsFromPane(data.rootPane, validTabIds);

      const cleanedPane = cleanupEmptyPanes(filteredRootPane);

      // Collect all active tab IDs from restored pane tree to initialize history
      const activeIds: string[] = [];
      const collectActiveTabIds = (p: Pane) => {
        if (p.type === "tabs" && p.activeTabId) {
          activeIds.push(p.activeTabId);
        } else if (p.type === "split") {
          p.children.forEach(collectActiveTabIds);
        }
      };
      collectActiveTabIds(cleanedPane);

      // `activeTabHistory` seeded with each pane's active tab is also the
      // initial resident set: on restore, only those tabs mount. The rest stay
      // unmounted until the user actually opens them.
      set({
        tabs: rehydratedTabs,
        rootPane: cleanedPane,
        activeTabHistory: activeIds,
        evictedTabIds: EMPTY_EVICTED,
      });

      // Restore UI state
      if (data.uiState && typeof data.uiState === "object") {
        const ui = data.uiState as Record<string, unknown>;
        if (typeof ui.sidebarCollapsed === "boolean") {
          useUIStore.getState().setSidebarCollapsed(ui.sidebarCollapsed);
        }
        if (typeof ui.currentView === "string") {
          useUIStore.getState().setCurrentView(ui.currentView as import("../types").ViewName);
        }
        if (typeof ui.activeCollectionId === "string") {
          useCollectionStore.setState({ activeCollectionId: ui.activeCollectionId });
        }
      }
      return true;
    } catch (error) {
      console.error("Failed to load tabs:", error);
      return false;
    }
  },
}));
