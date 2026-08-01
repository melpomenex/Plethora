## Why

[Issue #40](https://github.com/melpomenex/Incrementum/issues/40) asked for two priority features: a keyboard shortcut to adjust priority, and the ability to change priority directly from the document view. The parent change `fix-issue-40-library-queue-and-integration-regressions` claimed both done (tasks 3.3, 3.4 marked `[x]`), but shipped only half of each: the inline control is **compact-view-only** (`DocumentsView.tsx:2670, 2745`), and the lone `Shift+P` shortcut is handled in the **list view only** (`DocumentsView.tsx:987`) and is increase-only. The reader (`DocumentViewer.tsx`) has no priority key handler; the grid card and list row have no adjustment control.

This change finishes both features with a better UX than originally specced, and — critically — makes the priority **actually work**. Today the continuous 0-100 `prioritySlider` field is partly cosmetic: the queue ordering function `calculate_fsrs_document_priority` (`algorithms/mod.rs:230`) reads only the derived 1-5 `priorityRating`, so dragging a slider never re-orders documents within a due set. The user's request for a "real" continuous slider is the opportunity to fix that, so the slider genuinely drives queue ordering (SuperMemo-style).

Two pre-existing bugs are fixed as part of this work: the FSRS priority calc clamps `priority_rating` to `1..=10` while the field is `1..=5` (`algorithms/mod.rs:226, 241`, making the documented 2.0× max unreachable), and the bulk-reprioritize path computes `priorityScore = rating*20` locally (`DocumentsView.tsx:919`) instead of the canonical formula and leaves `priority_slider` untouched.

## What Changes

### Priority UX — a continuous slider popup, single + mass set

- Replace the discrete `−/badge/+` `PriorityStepper` in the Documents compact view with a **continuous 0-100 slider** control, and render it in the **grid** card and **list** row as well, so all three layouts can adjust priority without opening the document.
- **`Shift+P` opens a priority popup** anchored to the active item, containing the continuous slider **and** a number input (type a value 0-100). The popup applies to the selection:
  - One item selected → sets that item's priority.
  - Multiple items selected (plain multi-select or shift-click range select) → **mass-sets** the same priority across every selected item.
- The reader (`DocumentViewer.tsx`) gets the same `Shift+P` popup for its open document (its existing mouse `PriorityControl` stays as the click affordance).

### Priority keyboard shortcut — single binding, opens the popup

- One shortcut (`Shift+P`), registered through the application's primary shortcut registry (`useShortcutStore` / System A — the store the reader already honors), opens the popup in both the Documents view and the reader. It is discoverable in shortcut settings and rebindable.
- This replaces the increase-only `Shift+P` in the secondary store (`keyboardShortcutsStore.ts:39`), which is migrated to System A. No separate up/down increment shortcuts — the popup's slider/number input is the adjustment mechanism.

### Queue ordering — the slider becomes real

- Rewire `calculate_fsrs_document_priority` (`algorithms/mod.rs:230-295`) and its 4 call sites in `commands/queue.rs` (`:324, :742, :832, :950`) to consume the 0-100 priority value (slider-derived) instead of the 1-5 `priorityRating`. Dragging the slider now genuinely re-orders documents within a due set. This fixes the 1-10 clamp bug as part of the rewire.
- Centralize the `slider → rating` derivation in the backend (one shared function) so all write paths — single `update_document_priority`, generic `update_document`, and the bulk path — keep `priorityRating` populated consistently for any code that still reads it.

### Bulk reprioritize — fixed

- The bulk "Reprioritize" button and the new `Shift+P` mass-set route through one backend path that writes `priority_slider`, recomputes `priority_rating` and `priority_score` via the canonical formula, and reports per-item outcomes — replacing the divergent `rating*20` local computation.

## Capabilities

### New Capabilities
<!-- None. This finishes an existing requirement and makes the slider authoritative. -->

### Modified Capabilities
- `document-library-management`: Tighten the existing "Document priority is adjustable from the library and by keyboard" requirement (`document-library-management/spec.md:106-127`). The parent requirement said "compact and grid views" and "a keyboard shortcut"; this change makes the scope explicit: a continuous 0-100 slider in **all three** layouts, a `Shift+P` popup that mass-sets priority across a selection, the same popup in the reader, and the slider genuinely driving queue ordering.

## Impact

**Frontend**
- New continuous-slider popup component (slider + number input), reused for single-set and mass-set.
- `src/components/documents/DocumentsView.tsx` — replace the compact `PriorityStepper` with the continuous slider; render it in list rows and the grid `LibraryCard`; add the `Shift+P` popup handler bound to the selection; fix `handleBulkReprioritize` to route through the canonical backend path.
- `src/components/viewer/DocumentViewer.tsx` — add `Shift+P` to open the popup for the open document in `handleKeyDown` (`:3369-3544`).
- `src/components/common/KeyboardShortcuts.tsx` — register the `Shift+P` priority popup shortcut in System A; migrate the legacy `Shift+P` from System B.
- `src/stores/keyboardShortcutsStore.ts` — remove the `increaseDocumentPriority` entry.

**Backend**
- `src-tauri/src/algorithms/mod.rs` — rewire `calculate_fsrs_document_priority` to consume the 0-100 value (fixing the 1-10 clamp bug); add a shared `slider → rating` derivation.
- `src-tauri/src/commands/queue.rs` — update the 4 call sites (`:324, :742, :832, :950`) to pass the slider value.
- `src-tauri/src/commands/document.rs` — `update_document_priority` uses the centralized derivation; verify `update_document` keeps all three fields consistent.

**Risk and sequencing**
- The queue-ordering rewire changes document ordering for **every** user on next queue build. Risk is bounded — it only affects the *order* of already-due documents, not *when* they're due (the `EngagingScheduler` due-date path is untouched and takes no priority input) — but it must be validated against the existing priority tests and ideally a before/after queue comparison. Document this in the CHANGELOG as a behavior change.
- No schema migration (columns already exist); a one-time recompute of `priority_score` from the existing slider+rating values on first launch removes the bulk-path drift, but is optional.
- No breaking API changes; `update_document_priority` keeps its `(id, rating, slider)` signature.
