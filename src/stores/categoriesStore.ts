/**
 * Categories Store
 *
 * Manages the list of category names available across documents/extracts
 * (name-identity model — the string on each item is authoritative). Mirrors
 * the tags store pattern (`src/stores/tagsStore.ts`).
 */

import { create } from "zustand";
import {
  getCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  type CategorySummary,
} from "../api/categories";

interface CategoriesState {
  categories: CategorySummary[];
  isLoading: boolean;
  error: string | null;

  loadCategories: () => Promise<void>;
  create: (name: string) => Promise<void>;
  rename: (oldName: string, newName: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  isLoading: false,
  error: null,

  loadCategories: async () => {
    set({ isLoading: true, error: null });
    try {
      const categories = await getCategories();
      set({ categories, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  create: async (name) => {
    try {
      await createCategory(name);
      await get().loadCategories();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  rename: async (oldName, newName) => {
    try {
      await renameCategory(oldName, newName);
      await get().loadCategories();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  remove: async (name) => {
    try {
      await deleteCategory(name);
      await get().loadCategories();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));
