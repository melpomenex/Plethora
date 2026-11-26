# Technical Design: Saved View Management

## Architecture & Persistence

1. **Shared Store (`src/stores/savedViewsStore.ts`):**
   - Retains the `documentsSavedViews` localStorage key and `SavedView` schema (`id`, `name`, `query`, `sortKey`, `sortDirection`, `mode`, `compactDocumentsView`, `showNextAction`, `fileTypeFilter`, `categoryFilter`, `compactFilter`).
   - Safe parser validates `Array.isArray` and filters out malformed entries without crashing.
   - Generates unique IDs (`crypto.randomUUID()` with fallback) to prevent collisions on rapid creation or duplication.
   - Subscribes to `window` `"storage"` events so changes in another window/tab also sync, while all mounted `DocumentsView` instances in the same window share the Zustand store directly.

2. **Deletion & Undo Semantics:**
   - `deleteView(id)` removes the matching view by `id` and returns `{ deletedView, index } | null`.
   - Active `activeViewId` in `DocumentsView` is cleared (`setActiveViewId(null)`) when the active view is deleted, **without** resetting `searchInput`, `selectedFileType`, `selectedCategory`, `compactFilter`, `sortKey`, `sortDirection`, `mode`, or `showNextAction`.
   - `restoreView(view, index)` re-inserts `view` at `Math.min(index, current.length)` (if not already present by `id`) so undo never overwrites subsequent edits, additions, or deletions to other views.
   - Toast Undo (`toast.success(..., { action: { label: t("common.undo"), onClick: ... } })`) restores the view and restores `activeViewId` only if `activeViewId` is still `null` (not overwritten by a subsequent user selection).

3. **Rename, Update, Duplicate, Reorder:**
   - `renameView(id, newName)` preserves `id` and all configuration fields.
   - `updateView(id, config)` preserves `id` and `name`, updating only the filter/sort/layout configuration fields.
   - `duplicateView(id, copyLabel)` clones configuration with a new unique `id` and non-empty copy name (e.g., `"<name> (Copy)"` or localized equivalent), inserted immediately after the source view.
   - `moveView(id, direction: "up" | "down")` reorders in-place and persists immediately.

4. **UI & Accessibility:**
   - Shared `SavedViewsMenu` component renders a trigger button + accessible menu/popover (`role="menu"` / `aria-expanded`, Escape to close, keyboard-accessible action buttons) with a responsive layout suitable for both desktop and mobile (`min-h-[44px]` touch targets on mobile, no hover-only or right-click-only actions).
   - Visual indicator when `activeView` differs from the current filters/sort/mode.
   - Explicit "Clear active view" action clears `activeViewId` without resetting filters.

## Rejected Alternatives

- **Component-local `useState` in `DocumentsView.tsx`:** Rejected because multiple mounted `DocumentsView` tabs overwrite each other's `documentsSavedViews` localStorage key.
- **Confirmation modal for every deletion:** Rejected because deletion is reversible via Toast Undo; avoiding modal friction keeps the workflow fast while remaining safe.
