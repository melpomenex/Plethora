## Context

See [proposal.md](proposal.md) for the user problem and [specs/queue-flashcard-review-cards/spec.md](specs/queue-flashcard-review-cards/spec.md) for the behavior contract. Queue Scroll Mode already has a cloze normalizer, an inline card editor, and an undoable learning-item deletion path. Its range-rendering branch currently treats an empty range array as available, which can bypass marker parsing and display the raw braces.

## Goals / Non-Goals

**Goals:**
- Use the existing cloze syntax normalizer and renderer paths consistently when stored ranges cannot identify a deletion.
- Give Queue Scroll Mode cards direct access to the existing edit and undoable delete flows.
- Keep queue state updates in the parent session so card actions do not restart the session.

**Non-Goals:**
- Change cloze storage formats, authoring flows, scheduling, or the separate Review tab.
- Replace the existing inline editor or deletion/undo infrastructure.

## Decisions

1. **Treat only usable ranges as range-based cloze data.** A non-empty, valid range set may use the existing range renderer. Missing, empty, or unusable ranges fall back to parsing normalized marker syntax, including simplified `{{answer}}` markers. This follows the established behavior in the other review-card renderers and avoids the empty-array truthiness failure. A new storage migration is unnecessary.

2. **Keep controls on the Queue Scroll Mode card and delegate actions.** Add edit and delete callbacks to the existing card component and render the pencil and trash controls beside each other in its top-right control group. The edit callback continues to open the existing `InlineCardEditor`; the delete callback goes through Queue Scroll Mode's existing undoable deletion path, which already removes the active item and advances the session.

3. **Keep queue state ownership in Queue Scroll Mode.** The card component only presents controls and cloze content. The parent remains responsible for persistence, in-place edits, removal, and advancing the active index, so the current session state remains authoritative.

## Risks / Trade-offs

- [Malformed or out-of-bounds ranges] → Validate ranges before selecting range rendering and use marker parsing when ranges are unusable.
- [Deletion accidentally targets a stale card] → Resolve the action by the active learning item's stable ID and rely on the existing undoable deletion handler.
- [Small screens leave insufficient room for two controls] → Keep both controls in the existing compact top-right group and retain accessible names and hit targets.

## Migration Plan

No data migration is required. Existing cards continue to use their stored ranges when those ranges are usable; cards that depend on marker syntax use the fallback renderer. The change can be rolled back by reverting the Queue Scroll Mode rendering and action wiring without changing persisted card data.
