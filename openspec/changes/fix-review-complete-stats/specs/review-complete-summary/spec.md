## Purpose

Defines what the Review Complete screen reports after a spaced-repetition session finishes: a truthful whole-session duration, a per-card average, and a human-readable next-review interval for the last graded card.

## ADDED Requirements

### Requirement: Session duration measures the whole session

The system SHALL measure Review Complete duration from session start (queue load) to session finish, not from the last card rating. The displayed duration SHALL be human-readable: seconds below one minute (e.g. `45s`), minutes/seconds or hours/minutes above (e.g. `3m 20s`, `1h 5m`). A completed session with 13 reviewed cards that took real time SHALL NOT display `0m`.

#### Scenario: Multi-card session shows real duration

- **WHEN** the user completes a 13-card session that took several minutes
- **THEN** the Duration tile shows the elapsed whole-session time (e.g. `4m`), not `0m`

#### Scenario: Short session shows seconds

- **WHEN** the user completes a session lasting less than 60 seconds
- **THEN** the Duration tile shows seconds (e.g. `45s`), never `0m`

### Requirement: Per-card average derives from unrounded elapsed time

The per-card average SHALL be computed from unrounded elapsed milliseconds divided by cards reviewed (rounded to whole seconds for display), so it is consistent with the Duration tile. A session with non-zero elapsed time SHALL NOT display `0s per card`.

#### Scenario: Average consistent with duration

- **WHEN** a session of 13 cards took ~3 minutes of real time
- **THEN** the average shows ~14s per card, consistent with the Duration tile, not `0s per card`

### Requirement: Next-review interval is human-formatted

The Scheduled panel SHALL render the last graded card's `intervalDays` as a human interval via locale-aware minute → hour → day → week formatting (reusing the project's interval formatter), and SHALL NEVER render a raw fractional-day float. Sub-hour Again/relearning steps SHALL render as minutes (minimum `1 min`); sub-minute edge values SHALL also render as `1 min`, never `0.0000… days`.

#### Scenario: Failed card with sub-day interval

- **WHEN** the last graded card was rated Again with an interval of ~0.000038 days
- **THEN** the panel shows `Next review in 1 min` (or equivalent localized minutes), not `Next review in 0.00003827570253633894 days`

#### Scenario: Passed card with multi-day interval

- **WHEN** the last graded card was rated Good with an interval of 3.2 days
- **THEN** the panel shows `Next review in 3 days` (locale-formatted), not the raw float
