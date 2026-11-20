## ADDED Requirements

### Requirement: FSRS-7 replay computes adjusted recall residuals without future leakage
The system SHALL replay `review_results` chronologically per `item_id` using `fsrs7`, evaluating `predicted_retrievability` prior to each review update, and SHALL expose `observed_recall - predicted_retrievability` alongside winsorized log-latency rather than raw unadjusted recall accuracy alone.

#### Scenario: Difficulty confounding does not produce a false sleep correlation
- **WHEN** a synthetic user reviews easy cards (predicted retrievability 0.95) after 6h sleep and hard cards (predicted retrievability 0.70) after 8h sleep with recall matching FSRS expectations
- **THEN** FSRS recall residuals center near zero across both conditions and the correlation engine suppresses any spurious sleep-duration insight

### Requirement: Confounder-adjusted inference controls for time-of-day, autocorrelation, and multiple testing
The system SHALL evaluate within-person session-level associations controlling for circular time-of-day (`sin`/`cos`), mean item difficulty, and prior 24h workload, compute 95% confidence intervals via deterministic day-clustered block bootstrap, and apply Benjamini-Hochberg FDR adjustment across candidate associations.

#### Scenario: Circadian confounding is separated from sleep duration
- **WHEN** recall variation is driven strictly by time-of-day while sleep duration only co-varies weakly by chance
- **THEN** time-of-day controlled regression reports no statistically supported sleep-duration association after FDR correction

### Requirement: Sufficiency guardrails and temporal baseline validation suppress unsupported claims
The system SHALL enforce minimum observation, coverage, and sleep-variance guardrails, separate `exam` attempts from `practice`/`diagnostic` and retakes, validate Learning Windows against held-out temporal baselines (`M0`–`M5`), return `"There is not enough reliable data to identify a pattern."` when insufficient, and never emit diagnostic or causal medical claims.

#### Scenario: Sparse or constant sleep returns explicit insufficient-evidence conclusion
- **WHEN** fewer than 12 paired study sessions exist or sleep duration standard deviation is below 0.5 hours
- **THEN** personalized correlation insights and Learning Windows report insufficient reliable data with exact sample/variance counts

#### Scenario: Predictive window failing to beat baseline is downgraded
- **WHEN** a model incorporating sleep or time-of-day fails to improve held-out test RMSE over the constant user baseline
- **THEN** any displayed pattern is downgraded to descriptive/insufficient and never labeled as a validated prediction
