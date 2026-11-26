## 1. Shared Store & Persistence
- [x] 1.1 Create `src/stores/savedViewsStore.ts` with `SavedView` type, `documentsSavedViews` localStorage persistence, malformed-data resilience, unique ID generation, and `createView`, `deleteView`, `restoreView`, `renameView`, `updateView`, `duplicateView`, `moveView`, and `syncFromStorage` actions.
- [x] 1.2 Export `useSavedViewsStore` from `src/stores/index.ts`.

## 2. Saved View Management UI (Desktop & Mobile)
- [x] 2.1 Create `src/components/documents/SavedViewsMenu.tsx` implementing accessible desktop and mobile saved-view management (apply, save current view, clear active view preserving filters, rename, update with current filters + modified indicator, duplicate, move up/down, delete with Toast Undo).
- [x] 2.2 Integrate `useSavedViewsStore` and `SavedViewsMenu` into `src/components/documents/DocumentsView.tsx` for both desktop and mobile toolbars, removing component-local `savedViews` state and ensuring active-view deletion preserves current filters.
- [x] 2.3 Add localization keys for all saved-view management labels and messages across `en.ts`, `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, and `zh.ts`.

## 3. Regression Tests & Verification
- [x] 3.1 Add unit tests for `savedViewsStore` covering CRUD, undo after other edits, duplicate, reorder, persistence, legacy compatibility, and malformed storage data.
- [x] 3.2 Add component integration tests for `DocumentsView` / `SavedViewsMenu` covering desktop, mobile, active/inactive deletion, filter preservation, undo, multi-tab sync, and ensuring underlying documents are never deleted.
- [x] 3.3 Run Vitest, TypeScript (`tsc`), and OpenSpec validation.
