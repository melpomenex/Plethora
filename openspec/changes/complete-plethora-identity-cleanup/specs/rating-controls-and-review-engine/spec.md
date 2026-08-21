# Specification: Rating Controls & Review Engine Neutralization

## MODIFIED Requirements

### Requirement: Six-grade rating scale provides neutral component abstraction
The application SHALL provide a `SixGradeRatingControl` component (`src/components/review/SixGradeRatingControl.tsx`) backed by `src/lib/rating-grades.ts` that orchestrates rating on the 0–5 scale for 6-grade schedulers (`"adaptive"` and `"precision"`).

#### Scenario: Mobile touch devices use H-pattern joystick
- **GIVEN** the active scheduler is `"adaptive"` or `"precision"` on a phone or tablet form factor
- **WHEN** the user interacts with the card rating area
- **THEN** the H-pattern gesture joystick activates and maps gestures to grades 0–5 with equivalent 1–4 ratings

#### Scenario: Desktop review displays six-button grid
- **GIVEN** the active scheduler is `"adaptive"` or `"precision"` on a desktop form factor
- **WHEN** the answer is revealed during card review
- **THEN** six rating buttons (grades 0 through 5) are rendered with appropriate color coding and interval previews

### Requirement: Four-grade schedulers use standard 4-button controls
Schedulers that do not use a 6-point scale (such as `"fsrs"` and `"classic"`) SHALL declare `RatingSchema.type = "four-grade"` and render four rating buttons (Again, Hard, Good, Easy).

#### Scenario: FSRS active scheduler displays 4 buttons
- **WHEN** the active scheduler is `"fsrs"`
- **THEN** `getRatingSchema("fsrs").type` evaluates to `"four-grade"` and 4 rating buttons are rendered

### Requirement: Rust backend algorithms use canonical module naming
The Rust backend algorithms SHALL be structured under `src-tauri/src/algorithms/` as `adaptive.rs`, `precision/`, `classic.rs`, `incremental_scheduler.rs`, and `neural_queue.rs`, exposing unified `AlgorithmType` variants and identical scheduling output.

#### Scenario: Adaptive scheduler calculates next interval identically
- **GIVEN** a learning card with stability $S = 5.0$, difficulty $D = 0.5$, and retrievability $R = 0.9$
- **WHEN** `AdaptiveScheduler::next_state` evaluates a grade of 4
- **THEN** the resulting stability, difficulty, and interval match the 3D SInc interpolation calculation
