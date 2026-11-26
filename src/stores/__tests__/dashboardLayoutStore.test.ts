import { beforeEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_LAYOUT_STORAGE_KEY,
  DEFAULT_DASHBOARD_SECTION_ORDER,
  DEFAULT_QUICK_ACTION_ORDER,
  createDefaultDashboardLayout,
  isDefaultDashboardLayout,
  normalizeDashboardLayout,
  useDashboardLayoutStore,
} from "../dashboardLayoutStore";

describe("dashboardLayoutStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardLayoutStore.getState().resetToDefault();
  });

  it("initializes with default section and quick-action order, all visible", () => {
    const state = useDashboardLayoutStore.getState();
    expect(state.sectionOrder).toEqual([...DEFAULT_DASHBOARD_SECTION_ORDER]);
    expect(state.hiddenSections).toEqual([]);
    expect(state.quickActionOrder).toEqual([...DEFAULT_QUICK_ACTION_ORDER]);
    expect(state.hiddenQuickActions).toEqual([]);
    expect(isDefaultDashboardLayout(state)).toBe(true);
  });

  it("normalizes malformed, unknown, duplicate, and partial persisted layouts", () => {
    expect(normalizeDashboardLayout(null)).toEqual(createDefaultDashboardLayout());
    expect(normalizeDashboardLayout("invalid")).toEqual(createDefaultDashboardLayout());

    const normalized = normalizeDashboardLayout({
      sectionOrder: ["quick-review", "unknown-id", "quick-review", "focus"],
      hiddenSections: ["quick-tip", "not-a-section", "quick-tip"],
      quickActionOrder: ["review", "bogus", "queue"],
      hiddenQuickActions: ["audiobooks", "bogus"],
    });

    expect(normalized.sectionOrder[0]).toBe("quick-review");
    expect(normalized.sectionOrder[1]).toBe("focus");
    expect(normalized.sectionOrder).toHaveLength(DEFAULT_DASHBOARD_SECTION_ORDER.length);
    expect(new Set(normalized.sectionOrder).size).toBe(DEFAULT_DASHBOARD_SECTION_ORDER.length);
    expect(normalized.hiddenSections).toEqual(["quick-tip"]);

    expect(normalized.quickActionOrder[0]).toBe("review");
    expect(normalized.quickActionOrder[1]).toBe("queue");
    expect(normalized.quickActionOrder).toHaveLength(DEFAULT_QUICK_ACTION_ORDER.length);
    expect(normalized.hiddenQuickActions).toEqual(["audiobooks"]);
  });

  it("handles corrupted localStorage JSON gracefully on reload", () => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, "{not-valid-json");
    useDashboardLayoutStore.getState().reloadFromStorage();

    const state = useDashboardLayoutStore.getState();
    expect(state.sectionOrder).toEqual([...DEFAULT_DASHBOARD_SECTION_ORDER]);
    expect(state.hiddenSections).toEqual([]);
  });

  it("moves sections up and down with boundary clamping and persists", () => {
    const store = useDashboardLayoutStore.getState();
    store.moveSection("focus", "up");
    expect(useDashboardLayoutStore.getState().sectionOrder[0]).toBe("focus");

    store.moveSection("focus", "down");
    expect(useDashboardLayoutStore.getState().sectionOrder[0]).toBe("quick-actions");
    expect(useDashboardLayoutStore.getState().sectionOrder[1]).toBe("focus");

    const persisted = JSON.parse(
      window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) || "{}",
    );
    expect(persisted.sectionOrder[0]).toBe("quick-actions");
    expect(persisted.sectionOrder[1]).toBe("focus");
  });

  it("reorders sections to an arbitrary target index", () => {
    useDashboardLayoutStore.getState().reorderSection("quick-review", 0);
    expect(useDashboardLayoutStore.getState().sectionOrder[0]).toBe("quick-review");
    expect(isDefaultDashboardLayout(useDashboardLayoutStore.getState())).toBe(false);
  });

  it("toggles section visibility and persists", () => {
    const store = useDashboardLayoutStore.getState();
    store.setSectionVisible("quick-tip", false);
    expect(useDashboardLayoutStore.getState().hiddenSections).toEqual(["quick-tip"]);

    store.toggleSectionVisibility("quick-tip");
    expect(useDashboardLayoutStore.getState().hiddenSections).toEqual([]);
  });

  it("moves and toggles Quick Actions and resets to defaults", () => {
    const store = useDashboardLayoutStore.getState();
    store.moveQuickAction("review", "left");
    expect(useDashboardLayoutStore.getState().quickActionOrder[1]).toBe("review");

    store.setQuickActionVisible("audiobooks", false);
    expect(useDashboardLayoutStore.getState().hiddenQuickActions).toEqual(["audiobooks"]);
    expect(isDefaultDashboardLayout(useDashboardLayoutStore.getState())).toBe(false);

    store.resetToDefault();
    expect(isDefaultDashboardLayout(useDashboardLayoutStore.getState())).toBe(true);
  });

  it("syncs when a cross-tab storage event fires", () => {
    const updated = {
      ...createDefaultDashboardLayout(),
      hiddenSections: ["quick-tip"],
    };
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DASHBOARD_LAYOUT_STORAGE_KEY,
        newValue: JSON.stringify(updated),
      }),
    );

    expect(useDashboardLayoutStore.getState().hiddenSections).toEqual(["quick-tip"]);
  });

  it("adds and removes toolbar/custom Quick Actions and persists", () => {
    const store = useDashboardLayoutStore.getState();
    store.addQuickAction("knowledge-graph");
    expect(useDashboardLayoutStore.getState().quickActionOrder).toContain("knowledge-graph");
    expect(isDefaultDashboardLayout(useDashboardLayoutStore.getState())).toBe(false);

    const persisted = JSON.parse(
      window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) || "{}",
    );
    expect(persisted.quickActionOrder).toContain("knowledge-graph");

    const normalized = normalizeDashboardLayout(persisted);
    expect(normalized.quickActionOrder).toContain("knowledge-graph");

    store.removeQuickAction("knowledge-graph");
    expect(useDashboardLayoutStore.getState().quickActionOrder).not.toContain("knowledge-graph");
    expect(isDefaultDashboardLayout(useDashboardLayoutStore.getState())).toBe(true);
  });

  it("adds and removes dashboard widgets and preserves them on normalize", () => {
    const store = useDashboardLayoutStore.getState();
    store.addWidget("widget-focus-timer");
    store.addWidget("widget-scratchpad");

    const state = useDashboardLayoutStore.getState();
    expect(state.sectionOrder).toContain("widget-focus-timer");
    expect(state.sectionOrder).toContain("widget-scratchpad");
    expect(isDefaultDashboardLayout(state)).toBe(false);

    const persisted = JSON.parse(
      window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) || "{}",
    );
    const normalized = normalizeDashboardLayout(persisted);
    expect(normalized.sectionOrder).toContain("widget-focus-timer");
    expect(normalized.sectionOrder).toContain("widget-scratchpad");

    store.removeWidget("widget-focus-timer");
    expect(useDashboardLayoutStore.getState().sectionOrder).not.toContain("widget-focus-timer");
    expect(useDashboardLayoutStore.getState().sectionOrder).toContain("widget-scratchpad");
  });
});
