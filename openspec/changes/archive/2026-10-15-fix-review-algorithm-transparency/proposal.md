## Why

The review transparency panel and rating buttons show FSRS-6 scheduling intervals for all cards regardless of their actual algorithm. When a user selects Plethora 18 or Plethora 20 (either globally or per-card), the preview intervals passed to `previewReviewIntervals()` still use the global `settings.learning.algorithm` rather than the card's own `algorithm_type`. This means Adaptive/Precision cards display incorrect "Again/Hard/Good/Easy" interval predictions computed by the FSRS formula, not by the algorithm actually scheduling those cards.

## What Changes

- Fix `loadPreviewIntervals` in the review store to pass the card's `algorithm_type` (when set) to the backend, falling back to the global setting only when the card has no per-card algorithm
- Verify the existing backend `preview_review_intervals` command correctly handles Adaptive and Precision dispatch (it already does — the bug is purely frontend)
- The Precision "Hard = 6+ days" behavior is correct per the algorithm design: Precision computes a stability increment (SInc) factor and the interval is `stability * SInc * success_multiplier`. For established cards with high stability, this legitimately produces multi-day intervals even for Hard ratings. This is by design — no algorithmic change needed.

## Capabilities

### New Capabilities

_None_

### Modified Capabilities

- `document-rating`: Review transparency must dispatch preview intervals using the card's effective algorithm (per-card `algorithm_type` > global setting), not just the global setting.

## Impact

- **`src/stores/reviewStore.ts`**: One-line fix in `loadPreviewIntervals` to pass `currentCard.algorithm_type || settings.learning.algorithm` instead of just `settings.learning.algorithm`
- **No backend changes**: The Rust `preview_review_intervals` command already correctly dispatches to Adaptive/Precision/FSRS based on the algorithm parameter
- **No algorithm changes**: Precision interval behavior (including Hard producing multi-day intervals) is correct
