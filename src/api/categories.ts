/**
 * Categories API
 *
 * Categories are name-identity values (the free-form `category` string on
 * documents/extracts). These wrappers manage the names globally: rename and
 * delete propagate by name across every item (no orphaned assignments).
 */

import { invokeCommand } from "../lib/tauri";

/** A distinct category name with the number of items carrying it. */
export interface CategorySummary {
  name: string;
  itemCount: number;
}

/** The registry row returned by `create_category`. */
export interface CategoryCreateResult {
  id: string;
  name: string;
  collectionId?: string;
}

export interface CategoryRenameResult {
  documentsUpdated: number;
  extractsUpdated: number;
}

export interface CategoryDeleteResult {
  documentsCleared: number;
  extractsCleared: number;
}

export function getCategories(): Promise<CategorySummary[]> {
  return invokeCommand<CategorySummary[]>("get_categories");
}

export function createCategory(name: string): Promise<CategoryCreateResult> {
  return invokeCommand<CategoryCreateResult>("create_category", { name });
}

export function renameCategory(name: string, newName: string): Promise<CategoryRenameResult> {
  return invokeCommand<CategoryRenameResult>("rename_category", { name, newName });
}

export function deleteCategory(name: string): Promise<CategoryDeleteResult> {
  return invokeCommand<CategoryDeleteResult>("delete_category", { name });
}
