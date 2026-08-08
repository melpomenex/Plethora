/**
 * Reuse-key semantics for tab restore payloads.
 *
 * Opening a tab checks whether an equivalent one is already open. That check
 * used to `JSON.stringify` both sides once per open tab; it now compares a key
 * computed once per payload object. These tests pin what "equivalent" means.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../uiStore", () => ({
  useUIStore: { getState: () => ({ setSidebarCollapsed: vi.fn(), setCurrentView: vi.fn() }) },
}));
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }), setState: vi.fn() },
}));
vi.mock("../settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { general: { restoreSession: true, residentTabCap: 0 } } }),
  },
}));

import { useTabsStore, createTabPane, tabDataKey } from "../tabsStore";

const DummyComponent = () => null;

describe("tabDataKey", () => {
  it("maps a missing payload to the empty key", () => {
    expect(tabDataKey(undefined)).toBe("");
  });

  it("gives equal payloads the same key regardless of key order", () => {
    expect(tabDataKey({ documentId: "d1", page: 4 })).toBe(tabDataKey({ page: 4, documentId: "d1" }));
  });

  it("distinguishes different payloads", () => {
    expect(tabDataKey({ documentId: "d1" })).not.toBe(tabDataKey({ documentId: "d2" }));
    expect(tabDataKey({ documentId: "d1" })).not.toBe(tabDataKey({}));
    expect(tabDataKey({})).not.toBe(tabDataKey(undefined));
  });

  it("handles nested objects and arrays", () => {
    expect(tabDataKey({ a: { x: 1, y: [1, 2] } })).toBe(tabDataKey({ a: { y: [1, 2], x: 1 } }));
    expect(tabDataKey({ a: [1, 2] })).not.toBe(tabDataKey({ a: [2, 1] }));
  });

  it("treats an explicitly-undefined field as an absent one, as JSON does", () => {
    expect(tabDataKey({ missing: undefined })).toBe(tabDataKey({}));
    expect(tabDataKey({ documentId: "d1", page: undefined })).toBe(tabDataKey({ documentId: "d1" }));
    // ...but null is a value, not an absence.
    expect(tabDataKey({ missing: null })).not.toBe(tabDataKey({}));
  });
});

describe("tab reuse", () => {
  function reset() {
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
      forwardTabHistory: [],
      evictedTabIds: new Set<string>(),
    });
  }

  const viewerTab = (data: Record<string, unknown>) => ({
    title: "Doc",
    icon: null,
    type: "document-viewer" as const,
    content: DummyComponent,
    closable: true,
    data,
  });

  it("reuses an open tab with an equivalent payload", () => {
    reset();
    const first = useTabsStore.getState().addTab(viewerTab({ documentId: "d1", page: 2 }));
    const second = useTabsStore.getState().addTab(viewerTab({ page: 2, documentId: "d1" }));

    expect(second).toBe(first);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("opens a new tab for a different payload", () => {
    reset();
    const first = useTabsStore.getState().addTab(viewerTab({ documentId: "d1" }));
    const second = useTabsStore.getState().addTab(viewerTab({ documentId: "d2" }));

    expect(second).not.toBe(first);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("reuses a single-instance tab type regardless of payload", () => {
    reset();
    const makeQueue = (data?: Record<string, unknown>) => ({
      title: "Queue",
      icon: null,
      type: "queue" as const,
      content: DummyComponent,
      closable: true,
      data,
    });

    const first = useTabsStore.getState().addTab(makeQueue({ filter: "due" }));
    const second = useTabsStore.getState().addTab(makeQueue({ filter: "new" }));

    expect(second).toBe(first);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("treats a payload-less tab as distinct from one carrying a payload", () => {
    reset();
    const withoutData = useTabsStore.getState().addTab({
      title: "Doc",
      icon: null,
      type: "document-viewer",
      content: DummyComponent,
      closable: true,
    });
    const withData = useTabsStore.getState().addTab(viewerTab({ documentId: "d1" }));

    expect(withData).not.toBe(withoutData);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});
