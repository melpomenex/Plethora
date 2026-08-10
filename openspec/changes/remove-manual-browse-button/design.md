## Context

The Queue View (`ReviewQueueView.tsx`) introduced a "Manual Browse" mode in the `manual-browse-queue-view` change. It layers a dedicated keyboard-browse mode on top of the default click-to-open queue interaction: a toolbar toggle button activates a persistent selection, the list container becomes a focusable `listbox`, Arrow/J/K/Home/End move the selection, Enter activates it, and an active-mode control bar shows a "Browsing N / M" position with Prev/Next/Open-Selected buttons. A conditional hint under the list toggles between active/inactive copy.

The feature is self-contained in one component, has no backend/Rust surface, and ships without a feature flag (its original design explicitly says "without feature flags"). It also shares state with the inspector pane: `selectedId`, `selectedIndexRef`, the reconciliation effects, and the `data-queue-item-id` row attributes were introduced to give manual browse a stable selection, but the inspector pane now also reads them to show details for the currently focused item.

The motivation for removal is usage: the default click-to-open path already covers the queue's navigation needs, and the toggle plus control bar are unused chrome.

## Goals / Non-Goals

**Goals:**
- Delete every user-visible and runtime trace of Manual Browse: the toggle button, the active-mode control bar, the conditional hint, the keyboard handler, the Escape-exits-browse branch, and the list container's browse-only attributes (`tabIndex`, `role="listbox"`, `onKeyDown`).
- Delete the orphaned i18n keys in all six locales and the dedicated test case.
- Leave the queue fully usable via the existing pointer/click activation path.

**Non-Goals:**
- Reworking the inspector pane's selection source. The shared `selectedId` plumbing stays as-is; it continues to drive the inspector. Only manual-browse-only consumers are removed.
- Replacing manual browse with a different keyboard-navigation scheme. If keyboard nav is wanted later it will be its own change.
- Touching the Scroll Mode queue, the Review session tab, or any backend command.
- Removing the original `manual-browse-queue-view` change from `openspec/changes/` — it stays as historical record. Only the stale cross-references in *other* changes are reconciled.

## Decisions

### Decision 1: Delete outright rather than feature-flag behind a setting

The original feature was deliberately shipped without a flag, so there is no existing toggle to flip off. Adding a new settings flag purely to deprecate an unused feature would trade one piece of unused chrome (a button) for another (a setting). Delete it.

**Alternative considered:** add a `queue.manualBrowseEnabled` setting defaulting to off, leave the code present. Rejected — it leaves dead codepaths and i18n keys behind forever, and no user has asked to keep it.

### Decision 2: Keep the shared `selectedId` selection plumbing

`selectedId`, `selectedIndexRef`, the reconciliation effects (clamp/fallback when `visibleItems` changes), and the `data-queue-item-id` row attributes are consumed by the inspector pane, not only by manual browse. Removing them would silently break inspector focus. They are kept verbatim; only the manual-browse-only reads (`isManualBrowseActive`, the control bar, the keyboard handler, the `tabIndex`/`role`/`onKeyDown` on the list) are removed.

The `queueListRef` (used for focus-on-activate and scroll-selected-into-view) is no longer needed for focus; the scroll-into-view effect may stay if it improves inspector UX, otherwise it is removed with the rest. The implementation task re-evaluates this one effect in place — it is not a contract concern.

### Decision 3: Revert the list container to its pre-browse shape

The list container goes back to being a plain scrolling region: no `role="listbox"`, no `tabIndex`, no `onKeyDown`. Item rows keep their existing click handlers (`onStartReview` / `onOpenDocument`), which is the primary interaction path the queue has always had.

### Decision 4: Single i18n cleanup pass, no compatibility shims

The five keys (`queue.manualBrowse`, `queue.manualBrowseHintActive`, `queue.manualBrowseHintInactive`, `queue.browsingPosition`, `queue.openSelected`) are removed from all six locale files in one pass. No deprecated-but-kept aliases — `t()` lookups for missing keys would just produce the key string, and since the references are being deleted in the same change there are no lingering callers.

### Decision 5: Reconcile stale OpenSpec cross-references in place

Two other in-flight changes reference manual browse:
- `queue-multi-select-and-bulk-actions/specs/queue-multi-select/spec.md` — defines an Escape interaction ("manual browse SHALL remain active until a second Escape").
- `fix-customize-session-filters/proposal.md` — notes that `selectableItems` and manual browse reflect the filtered set.

These are edited during implementation (not archived/deleted) to drop the manual-browse clause while preserving the rest of their behavior. This keeps the spec corpus honest without rewriting history.

## Risks / Trade-offs

- **[Regression in keyboard users' workflow]** → Mitigation: there is no evidence of usage, and the queue remains fully navigable by pointer. If keyboard-nav is later requested, it comes back as a focused, discoverable shortcut rather than a mode toggle. Acceptable trade.
- **[Accidentally breaking the inspector pane by over-pruning shared state]** → Mitigation: Decision 2 — the shared `selectedId` plumbing is explicitly in scope-as-kept, and the implementation task runs the existing component tests (minus the removed manual-browse case) plus a typecheck to confirm the inspector still resolves its selection.
- **[Orphaned i18n key if a locale file defines `browsingPosition`/`openSelected` but a reference is missed]** → Mitigation: the implementation task greps for all five keys across `src/` after the edit to confirm zero remaining references.
- **[Stale spec text left in other changes confuses future readers]** → Mitigation: Decision 5 — the two cross-references are edited in the same change.

## Migration Plan

No runtime migration. Nothing about browse mode is persisted — it is component-local state. After the change, the Queue View simply no longer renders the toggle or control bar; existing users see no data change.

Rollback (if ever needed) is `git revert` of this change; there are no schema or storage steps to undo.

## Open Questions

None — the feature surface is small and fully mapped (one component, one test file, six locale files, two stale spec cross-references).
