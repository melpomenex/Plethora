## Why

The Queue View's "Manual Browse" toggle button added a dedicated keyboard-driven browse mode (persistent selection, Arrow/J/K navigation, Prev/Next/Open-Selected control bar) on top of the default click-to-open interaction. In practice no one uses it — the queue is already fully navigable by clicking items, and the toggle + control bar + conditional hint text just add toolbar chrome and complexity. It is dead surface area and should be removed.

## What Changes

- **Remove** the "Manual Browse" toggle button from the Queue View toolbar (`ReviewQueueView.tsx`).
- **Remove** the manual-browse runtime: the `isManualBrowseActive` toggle state, the keyboard-navigation handler (`moveBrowseSelection` / `jumpBrowseSelection` / `activateSelectedItem` / `handleQueueListKeyDown`), the Escape-exits-browse branch of the global keydown handler, the active-mode control bar (position indicator + Prev/Next/Open-Selected), and the conditional browse-hint text.
- **Revert** the queue list container to a plain focusable region: drop the `tabIndex={isManualBrowseActive ? 0 : -1}`, `role="listbox"`, and `onKeyDown` wiring that existed solely to support browse mode.
- **Remove** the manual-browse test case (`ReviewQueueView.test.tsx`).
- **Remove** the now-orphaned i18n keys — `queue.manualBrowse`, `queue.manualBrowseHintActive`, `queue.manualBrowseHintInactive`, `queue.browsingPosition`, `queue.openSelected` — from all six locale files (en, de, ja, fr, es, zh).
- **Retain** the shared item-selection state (`selectedId`, `selectedIndexRef`, the reconciliation effects, and `data-queue-item-id`) because the inspector pane still consumes it; only the manual-browse-only consumers are removed.
- **No backend / Rust / config changes.** The feature is entirely frontend, and ships without feature flags (per its original design), so there is no flag to flip — it is deleted outright.

## Capabilities

### New Capabilities

- `queue-view-navigation`: How Queue View items are navigated and activated after the Manual Browse mode is removed — direct pointer/click activation only, with no dedicated keyboard-browse toggle, persistent browse-selection mode, or active-mode control bar.

### Modified Capabilities

<!-- None — there is no live spec for queue browsing in openspec/specs/ (the original queue-manual-browse capability was never promoted out of its change), so there is nothing to delta. The stale cross-reference in queue-multi-select-and-bulk-actions' spec ("manual browse SHALL remain active until a second Escape") becomes moot and is reconciled during implementation. -->

## Impact

- **Code**: `src/components/review/ReviewQueueView.tsx` — delete the toggle button, the browse helpers, the list keydown handler, the Escape-exit branch, the active-mode control bar, and the conditional hint; simplify the list container attributes. Keep the shared `selectedId` selection plumbing used by the inspector pane.
- **Tests**: `src/components/review/__tests__/ReviewQueueView.test.tsx` — delete the "supports manual browse keyboard navigation and activation" test case.
- **i18n**: `src/lib/i18n/locales/{en,de,ja,fr,es,zh}.ts` — remove the five manual-browse keys.
- **OpenSpec docs**: reconcile the now-stale manual-browse references in `openspec/changes/queue-multi-select-and-bulk-actions/specs/queue-multi-select/spec.md` and `openspec/changes/fix-customize-session-filters/proposal.md`.
- **No API / data / dependency changes.** No migration: nothing is persisted about browse mode.
