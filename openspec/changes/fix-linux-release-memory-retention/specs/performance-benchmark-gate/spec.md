## ADDED Requirements

### Requirement: Release Linux memory baselines are committed and gated

The memory gate SHALL compare harness results against committed entries in `scripts/memory-baselines.json` for the `linux-release` machine profile. At minimum, the following metrics SHALL be hard gates for release results: `idle-fresh` total tree PSS, `four-tabs` total tree PSS, `all-closed` web-content PSS, and `idle-final` web-content PSS.

#### Scenario: Release result matches baseline profile

- **WHEN** a memory result has `buildProfile` `release` and a matching `linux-release` baseline exists
- **THEN** the gate compares gated metrics against their thresholds
- **AND** a regression fails the gate with a non-zero exit status

#### Scenario: Debug result does not fail release gates

- **WHEN** a memory result has `buildProfile` `debug`
- **THEN** the gate does not compare it against `linux-release` hard gates
- **AND** it reports debug metrics as diagnostics only

#### Scenario: Baseline file is created from post-fix measurements

- **WHEN** the memory retention fixes are verified on the reference machine
- **THEN** `scripts/memory-baselines.json` is committed with values from at least three consecutive reliable release runs
- **AND** each entry records tolerance derived from observed variance
