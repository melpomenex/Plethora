## ADDED Requirements

### Requirement: Sleep summaries compute circular timing and never fabricate missing stages
The system SHALL compute bedtime, wake-time, and sleep-midpoint statistics using circular trigonometry (`cos`/`sin` mean and circular SD), SHALL compute stage percentages only when stage-interval coverage is `>= 0.70` (returning `null` otherwise), and SHALL surface missing-day markers explicitly without inventing sleep records.

#### Scenario: Midnight-crossing bedtimes average correctly
- **WHEN** a learner sleeps at `23:45` on night 1 and `00:15` on night 2
- **THEN** the computed circular mean bedtime is `00:00` with circular SD near 15 minutes rather than `12:00`

#### Scenario: Generic asleep sessions do not fabricate REM or Deep percentages
- **WHEN** a user imports manual or unstaged `asleep_unknown` sleep sessions
- **THEN** total sleep duration and timing metrics are computed while `remPct`, `deepPct`, and `lightPct` remain `null` and `stageCoverageRatio` reports `0.0`

### Requirement: Regularity and nap analysis respect minimum coverage thresholds
The system SHALL classify naps deterministically with user override support and SHALL compute the Sleep Regularity Index (SRI) proxy only when at least 7 consecutive tracked day pairs are present, returning `null` with an explicit reason on sparse histories.

#### Scenario: Sparse 3-day sleep log suppresses SRI
- **WHEN** only 3 days of sleep exist in the selected window
- **THEN** `sriProxy` is `null` and `sriStatus` indicates insufficient consecutive tracked days

### Requirement: Exploratory two-process alertness model surfaces uncertainty and non-clinical framing
The system SHALL compute a deterministic Borbély two-process (`Process S` + `Process C`) alertness curve anchored to personal circular sleep midpoint with explicit half-width uncertainty bounds, non-clinical metadata (`isClinical: false`), and source attribution.

#### Scenario: Prolonged wakefulness increases Process S and reduces alertness proxy
- **WHEN** a simulated schedule extends wakefulness from 16 hours to 22 hours without sleep
- **THEN** homeostatic sleep pressure rises monotonically and the alertness proxy declines during prolonged wakefulness while carrying an explicit uncertainty interval
