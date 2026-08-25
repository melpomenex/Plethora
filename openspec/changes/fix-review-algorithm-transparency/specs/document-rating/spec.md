## ADDED Requirements

### Requirement: Algorithm-aware preview intervals
The review store SHALL pass the card's effective algorithm (per-card `algorithm_type` when set, falling back to the global `settings.learning.algorithm`) to the `previewReviewIntervals` API call, so that transparency panel and rating button intervals match the algorithm actually scheduling the card.

#### Scenario: Precision card previewed with FSRS global default
- **WHEN** the user's global algorithm is set to "fsrs" and the current card has `algorithm_type: "precision"`
- **THEN** `loadPreviewIntervals` SHALL pass `"precision"` to `previewReviewIntervals`
- **AND** the returned intervals SHALL be computed by the Precision algorithm

#### Scenario: Adaptive card previewed with FSRS global default
- **WHEN** the user's global algorithm is set to "fsrs" and the current card has `algorithm_type: "adaptive"`
- **THEN** `loadPreviewIntervals` SHALL pass `"adaptive"` to `previewReviewIntervals`
- **AND** the returned intervals SHALL be computed by the Adaptive algorithm

#### Scenario: Card with no per-card algorithm uses global default
- **WHEN** the current card has `algorithm_type: null` and the global setting is "fsrs"
- **THEN** `loadPreviewIntervals` SHALL pass `"fsrs"` to `previewReviewIntervals`
