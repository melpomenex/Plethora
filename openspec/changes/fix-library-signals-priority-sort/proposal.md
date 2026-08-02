## Why

The Documents library has three related UX defects that make prioritizing and finding material harder than it should be: the "Has extracts" signal filter in Compact View misses documents that actually have extracts (because `documents.extract_count` is never written back to the database when an extract is created), the Alt+P priority popup can reseed to the neutral default (50) instead of a document's real current priority when that priority is explicitly 0, and there is no fast way to sort or jump to "most extracted" / "most flashcarded" documents from the Compact View sidebar even though `extracts`/`cards` sort keys already exist elsewhere in the app.

## What Changes

- Persist `documents.extract_count` in the database whenever an extract is created (and wherever else extracts are added/removed), instead of relying on an in-memory-only store patch that gets overwritten on the next reload/page fetch. This fixes the "Has extracts" Compact View signal filter and the EXTRACTS column showing stale/zero counts after a reload, collection switch, or pagination.
- Fix `resolveDisplaySlider()` (`src/components/documents/usePriorityPopup.tsx`) so an explicitly-set priority slider value of `0` is treated as a real value, not "unset." Today `(doc.prioritySlider ?? 0) > 0` is falsy for a genuine `0`, so the Alt+P popup (Document view, Queue, and library rows) reseeds to the neutral midpoint (50) instead of showing the document's actual lowest-priority value.
- Add "Extracts" and "Flashcards" as first-class quick-sort entry points in the Compact View left sidebar, alongside the existing "Signals" filter buttons (Has extracts / Has cards), visually distinguished from filters so users don't confuse "sort by extract count" with "filter to only docs with extracts." Ensure the underlying `extracts` / `cards` sort keys (already defined in `DocumentSortKey` and already wired into List view's column headers and the Compact "Sort by" dropdown) are consistently reachable and correctly toggle ascending/descending across Compact, List, and Grid views.

## Capabilities

### New Capabilities
- `library-extract-signal-accuracy`: Extract counts are persisted server-side and stay accurate across reloads, powering both the EXTRACTS column and the "Has extracts" signal filter.
- `library-quick-sort-shortcuts`: Compact View sidebar exposes dedicated "Extracts" and "Flashcards" sort shortcuts, distinct from the existing Signals filters, and sort state stays consistent across Compact/List/Grid.
- `priority-popup-current-value`: The Alt+P priority popup always seeds from the document's real current priority, including an explicit value of `0`, across Document view, Queue, and library rows.

### Modified Capabilities
- None. This change does not alter existing requirements in `priority-vector-improvements` (the priority-vector/userIntent scoring formula) or any other existing spec — the priority-popup fix is new UI-seeding behavior, not a change to that capability's requirements.

## Impact

- Frontend: `src/components/documents/DocumentsView.tsx` (Compact sidebar, Signals section, sort controls, filter counts), `src/components/documents/usePriorityPopup.tsx` (`resolveDisplaySlider`), `src/stores/documentStore.ts` (extract count merge-on-reload behavior), `src/api/extracts.ts` (`patchDocumentExtractCount`).
- Backend: `src-tauri/src/database/repository.rs` (`create_extract` and any delete-extract path must update `documents.extract_count`), possibly a migration/backfill for existing documents whose `extract_count` is currently out of sync with their actual extract rows.
- No breaking changes to public APIs; this is bug-fix and UX-addition scoped to the existing Documents library and priority popup.
