# Capability: Adaptive Stats Display

## ADDED Requirements

### Requirement: Adaptive-specific metrics MUST be displayed in transparency UI

When Adaptive is the active algorithm, the transparency panels MUST show Adaptive-specific metrics that are not available in FSRS.

#### Scenario: Adaptive transparency panel shows reps and lapses
- Given a card with `algorithm_type = "adaptive"` and parsed Adaptive state
- When the transparency panel is displayed
- Then it shows the repetition count (`state.repetition`)
- And it shows the lapse count (`state.lapses`)

#### Scenario: Adaptive inspector shows additional state fields
- Given a card with `algorithm_type = "adaptive"`
- When the inspector panel is displayed
- Then it shows Reps (repetition count since last lapse)
- And it shows Lapses (total times forgotten)
- And it shows the difficulty scale label as "0-1" (not "1-10")

### Requirement: Adaptive retrievability MUST be computed with correct formula

Adaptive uses `R = 0.9^(t/S)` where S is defined as the number of days until R drops to 0.9. The existing `adaptiveRetrievability(stability, elapsedDays)` function MUST be used.

#### Scenario: Adaptive retrievability displayed correctly
- Given a card with `algorithm_type = "adaptive"`, stability = 10, elapsed = 10
- When retrievability is displayed
- Then it shows 90% (since `0.9^(10/10) = 0.9`)
