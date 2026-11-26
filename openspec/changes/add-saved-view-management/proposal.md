# Change: Add Complete Saved View Management

## Why

Users can create and apply saved views in `DocumentsView`, but cannot delete, rename, update, duplicate, reorder, or undo-delete them. Desktop uses a native `<select>` alongside a Save button, while mobile uses `MobileSavedViewsMenu` with only save and apply actions. Additionally, `savedViews` state is component-local in `DocumentsView.tsx`, causing multiple mounted Documents tabs to overwrite each other's `documentsSavedViews` localStorage entries, and clearing the active view (`handleApplyView("")`) resets all user filters.

## What Changes

- **Shared Saved Views Store (`src/stores/savedViewsStore.ts`):** Centralize `SavedView` persistence under the existing `documentsSavedViews` localStorage key with safe parsing, unique ID generation, cross-tab synchronization (`storage` event + shared Zustand store), and actions for create, delete, restore (undo), rename, update, duplicate, and reorder.
- **Desktop & Mobile Saved Views UI (`src/components/documents/SavedViewsMenu.tsx`, `DocumentsView.tsx`):** Replace the native `<select>` on desktop and extend `MobileSavedViewsMenu` on mobile with an accessible, responsive saved-view management popover/menu sharing the same business logic, supporting apply, save current view, clear active view (preserving filters), rename, update with current filters (with modified indicator), duplicate, move up/down (keyboard-accessible), and delete with Toast Undo.
- **Non-destructive Deletion Semantics:** Deleting a saved view removes only the saved configuration by stable ID—never documents, extracts, flashcards, or tags—and deleting the active view clears `activeViewId` while preserving current filters, search query, sorting, and layout.
- **Localization & Regression Tests:** Add i18n keys across all supported locales and comprehensive Vitest tests covering desktop, mobile, persistence, malformed data, multi-tab sync, and undo.

## Scope & Non-Goals

- **In scope:** Saved views in `DocumentsView` (desktop and mobile), shared Zustand store, `documentsSavedViews` compatibility, i18n, accessibility, and regression tests.
- **Non-goals:** Backend SQLite schema migrations or cloud synchronization for document saved views.
