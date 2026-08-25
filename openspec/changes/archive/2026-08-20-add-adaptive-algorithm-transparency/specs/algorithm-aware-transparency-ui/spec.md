# Capability: Algorithm-Aware Transparency UI

## ADDED Requirements

### Requirement: Transparency components MUST adapt to active algorithm

Review transparency UI components MUST detect the card's algorithm type and adapt their display, labels, and formulas accordingly.

#### Scenario: FSRS card reviewed — transparency panel shows FSRS-6 branding
- Given a card with `algorithm_type = "fsrs"`
- When the transparency panel is visible in the review view
- Then the panel title shows "FSRS-6 Transparency"
- And stability/difficulty are read from `card.memory_state`
- And difficulty is displayed on the FSRS 1-10 scale

#### Scenario: Adaptive card reviewed — transparency panel shows Adaptive branding
- Given a card with `algorithm_type = "adaptive"`
- When the transparency panel is visible in the review view
- Then the panel title shows "Plethora 18 Transparency"
- And stability/difficulty/retrievability are read from `card.algorithm_state` via `parseAdaptiveState()`
- And difficulty is displayed on the Adaptive 0-1 scale
- And additional Adaptive stats (reps, lapses) are shown

#### Scenario: FSRS inspector forget curve uses correct formula for FSRS
- Given a card with `algorithm_type = "fsrs"`
- When the inspector panel calculates the forget curve
- Then it uses the FSRS formula `R = exp(-t/S)`

#### Scenario: Adaptive inspector forget curve uses correct formula for Adaptive
- Given a card with `algorithm_type = "adaptive"`
- When the inspector panel calculates the forget curve
- Then it uses the Adaptive formula `R = 0.9^(t/S)`
- And the y-axis description reflects that S = days until R = 90% (not 37%)

#### Scenario: Item details popover shows correct algorithm label
- Given a learning item with `algorithm_type = "adaptive"`
- When the item details popover is opened
- Then the scheduling section header shows "Scheduling / Plethora 18"
- And difficulty is displayed on the appropriate scale for the algorithm

#### Scenario: Zen review metadata sources data from correct state
- Given a card with `algorithm_type = "adaptive"`
- When the zen review overlay is visible
- Then S, R, D, I values are read from the Adaptive algorithm state
- And difficulty is displayed on the Adaptive 0-1 scale

### Requirement: Preview intervals MUST work for both algorithms

The simulated next intervals (Again/Hard/Good/Easy) MUST be computed using the correct algorithm.

#### Scenario: Adaptive card shows Adaptive preview intervals
- Given a card with `algorithm_type = "adaptive"`
- When preview intervals are loaded
- Then they are computed by the Adaptive scheduler (already implemented in backend)
- And displayed in the transparency panel and inspector
