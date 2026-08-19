import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

vi.mock("../../api/categories", () => ({
  getCategories: mocks.getCategories,
  createCategory: mocks.createCategory,
  renameCategory: mocks.renameCategory,
  deleteCategory: mocks.deleteCategory,
}));

import { useCategoriesStore } from "../categoriesStore";

const list = [
  { name: "Work", itemCount: 3 },
  { name: "Personal", itemCount: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
  mocks.getCategories.mockResolvedValue(list);
  mocks.createCategory.mockResolvedValue({ id: "c1", name: "Work" });
  mocks.renameCategory.mockResolvedValue({ documentsUpdated: 2, extractsUpdated: 1 });
  mocks.deleteCategory.mockResolvedValue({ documentsCleared: 2, extractsCleared: 1 });
});

describe("categoriesStore (name-identity management)", () => {
  it("loads the distinct category list with item counts", async () => {
    const store = useCategoriesStore.getState();
    await store.loadCategories();

    const state = useCategoriesStore.getState();
    expect(mocks.getCategories).toHaveBeenCalledTimes(1);
    expect(state.categories).toEqual(list);
    expect(state.isLoading).toBe(false);
  });

  it("creates a category and refreshes the list", async () => {
    const store = useCategoriesStore.getState();
    await store.create("Work");

    expect(mocks.createCategory).toHaveBeenCalledWith("Work");
    // After creation the list is reloaded so the new name is visible
    expect(mocks.getCategories).toHaveBeenCalledTimes(1);
  });

  it("renames a category (propagates) and refreshes the list", async () => {
    const store = useCategoriesStore.getState();
    await store.rename("Work", "Career");

    expect(mocks.renameCategory).toHaveBeenCalledWith("Work", "Career");
    expect(mocks.getCategories).toHaveBeenCalledTimes(1);
  });

  it("deletes a category safely and refreshes the list", async () => {
    const store = useCategoriesStore.getState();
    await store.remove("Work");

    expect(mocks.deleteCategory).toHaveBeenCalledWith("Work");
    expect(mocks.getCategories).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors without throwing", async () => {
    mocks.createCategory.mockRejectedValueOnce(new Error("boom"));
    const store = useCategoriesStore.getState();
    await store.create("Work");

    const state = useCategoriesStore.getState();
    expect(state.error).toBe("boom");
  });
});
