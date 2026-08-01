## 1. Continuous-slider popup component

- [ ] 1.1 Build a `PriorityPopup` component: a 0-100 `<input type="range">` + a co-located numeric input (integer, clamps to 0-100 on blur), plus the 5 named preset chips (Lowest/Low/Normal/High/Highest at 10/30/50/70/90) reusing the reader `PriorityControl` vocabulary and colors
- [ ] 1.2 Make the popup operate on a list of target document ids: header shows "Set priority for N documents" when N>1; the slider + number input reflect a single committed value applied to all ids
- [ ] 1.3 Commit semantics: single-id may live-preview; multi-id commits on explicit confirm (no N writes mid-drag); Escape / click-outside cancels without writing and leaves the selection intact
- [ ] 1.4 Reuse the i18n keys already present in `PriorityControl` (`priority.lowest`, `priority.fineTune`, etc.); add any missing popup-specific keys

## 2. Inline continuous slider across Documents layouts

- [ ] 2.1 Replace the discrete `PriorityStepper` in the compact view ([`DocumentsView.tsx:2670`](../../../src/components/documents/DocumentsView.tsx#L2670), [`:2745`](../../../src/components/documents/DocumentsView.tsx#L2745)) with an inline continuous 0-100 slider at compact height
- [ ] 2.2 Render the inline continuous slider in the grid card `LibraryCard` ([`:3071-3359`](../../../src/components/documents/DocumentsView.tsx#L3071)) hover footer, replacing the static `PriorityBadge`
- [ ] 2.3 Render the inline continuous slider in the list row ([`:1470-1578`](../../../src/components/documents/DocumentsView.tsx#L1470)) priority cell ([`:1515`](../../../src/components/documents/DocumentsView.tsx#L1515)), replacing the read-only `PriorityBadge`
- [ ] 2.4 Add a responsive gate so the inline slider falls back to the badge on narrow widths; the `Shift+P` popup remains the adjustment path at any width
- [ ] 2.5 Confirm inline slider writes persist via `updateDocumentPriority` and the displayed value updates without a reload in all three layouts

## 3. Shift+P popup wiring — Documents view and reader

- [ ] 3.1 Register the priority shortcut in System A `DEFAULT_SHORTCUTS` ([`KeyboardShortcuts.tsx:51-507`](../../../src/components/common/KeyboardShortcuts.tsx#L51)) as e.g. `doc.priority`, default `Shift+P`, category `documents`
- [ ] 3.2 Remove the `increaseDocumentPriority` entry ([`keyboardShortcutsStore.ts:39`](../../../src/stores/keyboardShortcutsStore.ts#L39)) from System B; verify nothing else references it
- [ ] 3.3 Repoint the Documents-view keydown handler ([`DocumentsView.tsx:987-1009`](../../../src/components/documents/DocumentsView.tsx#L987)) to read from System A and open the `PriorityPopup` for the current selection instead of nudging +1
- [ ] 3.4 Make the existing bulk "Reprioritize" button ([`DocumentsView.tsx:905-921`](../../../src/components/documents/DocumentsView.tsx#L905)) an alternate opener of the same popup for the current selection
- [ ] 3.5 Add a priority-popup branch to `handleKeyDown` in [`DocumentViewer.tsx`](../../../src/components/viewer/DocumentViewer.tsx#L3369) (`:3369-3544`), reading the binding from System A the way the reader reads `doc.search` (`:3435`); open the popup for the open document
- [ ] 3.6 Confirm an existing user with the default binding still has `Shift+P` after upgrade; note the System B custom-rebind reset in the CHANGELOG

## 4. Backend — make the slider drive ordering

- [ ] 4.1 Rewrite `calculate_fsrs_document_priority` ([`algorithms/mod.rs:230-295`](../../../src-tauri/src/algorithms/mod.rs#L230)) to consume the 0-100 value: `multiplier = 0.5 + (slider/100.0) * 1.5` (0.5× at 0, 2.0× at 100); remove the `1..=10` clamp bug
- [ ] 4.2 Handle legacy rows: `slider == 0 && rating == 0` ⇒ neutral midpoint (1.0×); `slider == 0 && rating > 0` ⇒ derive slider from rating. No document is silently demoted
- [ ] 4.3 Update the 4 call sites in [`commands/queue.rs`](../../../src-tauri/src/commands/queue.rs#L324) (`:324, :742, :832, :950`) to pass `priority_slider` (with the legacy fallback) instead of `priority_rating`
- [ ] 4.4 Run/extend the existing priority tests; capture a before/after queue ordering snapshot for a fixture with mixed slider values to confirm fine-grained ordering

## 5. Backend — centralize derivation and fix the bulk path

- [ ] 5.1 Add a shared `rating_from_slider(slider: i32) -> i32` in [`algorithms/mod.rs`](../../../src-tauri/src/algorithms/mod.rs#L199) (threshold buckets matching the reader's `sliderToRating`), used by all write paths so the rating field stays populated for any reader
- [ ] 5.2 Route `update_document_priority` ([`document.rs:929-951`](../../../src-tauri/src/commands/document.rs#L929)) through it: derive rating from slider, then compute `priority_score` via the existing canonical `calculate_document_priority_score`
- [ ] 5.3 In `update_document` ([`document.rs:907`](../../../src-tauri/src/commands/document.rs#L907) / [`repository.rs:1215`](../../../src-tauri/src/database/repository.rs#L1215)), when `priority_slider` changes, re-derive rating + score so the generic path cannot desync
- [ ] 5.4 Add a `bulk_set_document_priority(ids, slider)` command in `commands/document.rs` (mirror the `queue_bulk.rs` transactional pattern) that writes slider + derived rating + canonical score per id in one transaction and returns a `BulkOperationResult`
- [ ] 5.5 Repoint `handleBulkReprioritize` and the popup's mass-commit to call `bulk_set_document_priority`; remove the local `rating*20` score computation ([`DocumentsView.tsx:919`](../../../src/components/documents/DocumentsView.tsx#L919))

## 6. Verification

- [ ] 6.1 Adjust priority by inline slider in list, grid, and compact; confirm persistence and no-reload update (re-runs parent task 3.6 across all three layouts)
- [ ] 6.2 `Shift+P` opens the popup for one selected item; typing a number and committing sets an exact value; values outside 0-100 clamp
- [ ] 6.3 `Shift+P` with a shift-click range / multi-selection mass-sets all selected documents; result reports succeeded/failed; selection clears on completion; Escape cancels and leaves selection intact
- [ ] 6.4 `Shift+P` in the reader opens the popup for the open document; committing persists and the reader's `PriorityControl` reflects it
- [ ] 6.5 Open shortcut settings; confirm the priority shortcut is listed under the primary registry and rebindable, with no duplicate in the secondary registry
- [ ] 6.6 Confirm queue ordering honors fine-grained slider differences: build a queue with two equally-due documents at slider 51 and 52 and verify they can obtain distinct order
- [ ] 6.7 Confirm unset-priority (slider=0, rating=0) documents order at the neutral midpoint, not the bottom
- [ ] 6.8 Unit tests: `calculate_fsrs_document_priority` multiplier over the 0-100 range + neutral fallback; `rating_from_slider` buckets; `bulk_set_document_priority` partial-failure reporting; frontend popup resolution (single vs N ids, clamp, cancel)
- [ ] 6.9 Cross-check no remaining reference to `increaseDocumentPriority` outside the migration path; the two priority fields are consistent after single, generic, and bulk writes
