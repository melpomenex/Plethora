import { beforeEach, describe, expect, it } from "vitest";
import {
  SAVED_VIEWS_KEY,
  isSavedViewModified,
  parseSavedViews,
  useSavedViewsStore,
  type SavedViewConfig,
} from "../savedViewsStore";

const baseConfig: SavedViewConfig = {
  query: "philosophy",
  sortKey: "priority",
  sortDirection: "desc",
  mode: "list",
  compactDocumentsView: false,
  showNextAction: true,
  fileTypeFilter: "pdf",
  categoryFilter: "all",
  compactFilter: "all",
};

describe("savedViewsStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSavedViewsStore.setState({ savedViews: [] });
  });

  it("creates, persists, and reloads saved views with unique IDs", () => {
    const v1 = useSavedViewsStore.getState().createView("Philosophy", baseConfig);
    const v2 = useSavedViewsStore.getState().createView("CS Papers", {
      ...baseConfig,
      query: "systems",
      mode: "grid",
    });

    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v1!.id).not.toBe(v2!.id);
    expect(useSavedViewsStore.getState().savedViews).toHaveLength(2);

    useSavedViewsStore.setState({ savedViews: [] });
    useSavedViewsStore.getState().reloadFromStorage();
    const reloaded = useSavedViewsStore.getState().savedViews;
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0].name).toBe("Philosophy");
    expect(reloaded[1].mode).toBe("grid");
  });

  it("deletes a view by ID and undoes deletion at original position without clobbering newer edits", () => {
    const v1 = useSavedViewsStore.getState().createView("View 1", baseConfig)!;
    const v2 = useSavedViewsStore.getState().createView("View 2", baseConfig)!;
    const v3 = useSavedViewsStore.getState().createView("View 3", baseConfig)!;

    const deleted = useSavedViewsStore.getState().deleteView(v2.id);
    expect(deleted).not.toBeNull();
    expect(deleted!.index).toBe(1);
    expect(useSavedViewsStore.getState().savedViews.map((v) => v.id)).toEqual([v1.id, v3.id]);

    // User makes another edit before clicking Undo
    useSavedViewsStore.getState().renameView(v1.id, "View 1 Renamed");
    const v4 = useSavedViewsStore.getState().createView("View 4", baseConfig)!;

    const restored = useSavedViewsStore.getState().restoreView(deleted!.deletedView, deleted!.index);
    expect(restored).toBe(true);

    const views = useSavedViewsStore.getState().savedViews;
    expect(views.map((v) => v.id)).toEqual([v1.id, v2.id, v3.id, v4.id]);
    expect(views[0].name).toBe("View 1 Renamed");
  });

  it("renames, updates, duplicates, and reorders views", () => {
    const v1 = useSavedViewsStore.getState().createView("Alpha", baseConfig)!;
    const v2 = useSavedViewsStore.getState().createView("Beta", baseConfig)!;

    const renamed = useSavedViewsStore.getState().renameView(v1.id, "Alpha Prime");
    expect(renamed?.name).toBe("Alpha Prime");
    expect(renamed?.id).toBe(v1.id);

    const updated = useSavedViewsStore.getState().updateView(v1.id, {
      ...baseConfig,
      query: "updated-query",
      mode: "grid",
      compactDocumentsView: true,
    });
    expect(updated?.name).toBe("Alpha Prime");
    expect(updated?.query).toBe("updated-query");
    expect(updated?.mode).toBe("grid");
    expect(updated?.compactDocumentsView).toBe(true);

    const dup = useSavedViewsStore.getState().duplicateView(v1.id, "Copy");
    expect(dup).not.toBeNull();
    expect(dup!.id).not.toBe(v1.id);
    expect(dup!.name).toBe("Alpha Prime (Copy)");
    expect(dup!.query).toBe("updated-query");

    expect(useSavedViewsStore.getState().savedViews.map((v) => v.id)).toEqual([v1.id, dup!.id, v2.id]);
    expect(useSavedViewsStore.getState().moveView(v2.id, "up")).toBe(true);
    expect(useSavedViewsStore.getState().savedViews.map((v) => v.id)).toEqual([v1.id, v2.id, dup!.id]);
    expect(useSavedViewsStore.getState().moveView(v1.id, "up")).toBe(false);
  });

  it("handles legacy and malformed persisted data gracefully", () => {
    expect(parseSavedViews("not-json")).toEqual([]);
    expect(parseSavedViews('{"not":"an-array"}')).toEqual([]);

    const mixed = JSON.stringify([
      null,
      { id: "", name: "Missing ID" },
      { id: "v1", name: "Valid Legacy", query: "test", customLegacyField: 42 },
      { id: "v1", name: "Duplicate ID" },
    ]);
    window.localStorage.setItem(SAVED_VIEWS_KEY, mixed);
    useSavedViewsStore.getState().reloadFromStorage();
    const parsed = useSavedViewsStore.getState().savedViews;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("v1");
    expect((parsed[0] as Record<string, unknown>).customLegacyField).toBe(42);
    expect(parsed[1].id).not.toBe("v1");
  });

  it("detects when current filters differ from the active saved view", () => {
    const view = useSavedViewsStore.getState().createView("Active", baseConfig)!;
    expect(isSavedViewModified(view, baseConfig)).toBe(false);
    expect(isSavedViewModified(view, { ...baseConfig, query: "changed" })).toBe(true);
  });

  it("syncs saved views across tabs on window storage event and via syncFromStorage", () => {
    const external = [{ id: "ext-1", name: "External View", ...baseConfig, query: "from-other-tab" }];
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(external));
    window.dispatchEvent(new StorageEvent("storage", { key: SAVED_VIEWS_KEY }));
    expect(useSavedViewsStore.getState().savedViews.map((v) => v.id)).toEqual(["ext-1"]);

    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([]));
    useSavedViewsStore.getState().syncFromStorage();
    expect(useSavedViewsStore.getState().savedViews).toEqual([]);
  });
});
