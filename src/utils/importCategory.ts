import { useSettingsStore } from "../stores/settingsStore";

/**
 * Resolve the category for a newly imported document.
 *
 * Preserves any category the import path already assigned (source-type
 * auto-categories such as "Web Import", explicit per-import categories, etc.)
 * and only falls back to the user's "default category for imported documents"
 * setting when the document would otherwise have no category at all.
 *
 * This fill-gaps semantics keeps existing auto-categorization intact while
 * finally giving generic file imports (which arrive without a category) a
 * home, which is what the default-category setting promises. Source-specific
 * imports like web articles and research papers keep their own categories.
 *
 * `defaultCategory` is an optional parameter so the helper is testable
 * without standing up the settings store.
 */
export function resolveImportCategory(
  currentCategory: string | undefined | null,
  defaultCategory?: string,
): string | undefined {
  if (currentCategory && currentCategory.trim().length > 0) return currentCategory;
  const fallback =
    defaultCategory ?? useSettingsStore.getState().settings.documents.defaultCategory;
  // "None" is the config default; "Uncategorized" is the store default. Treat
  // both as "no default configured" so we don't file everything under a label
  // the user never intentionally chose.
  if (fallback && fallback !== "None" && fallback !== "Uncategorized") return fallback;
  return undefined;
}
