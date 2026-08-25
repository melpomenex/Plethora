## Purpose

Extends the performance/memory gate to catch leaks that hide under peak ceilings: slope evaluation over idle-soak samples, per-process-role ratchet metrics, a scenario-mode synthetic leak that must fail the gate while every peak metric passes, and macOS machine-profile baselines. Existing comparator behavior, thresholds, and exit-code conventions are unchanged.

## ADDED Requirements

### Requirement: The gate evaluates slope over idle-soak samples

The comparator SHALL evaluate soak stages for bounded steady state: a post-warmup ordinary-least-squares slope over the soak samples (reported as growth-per-hour), and a soak final-versus-reference delta, each with its own clamped allowance derived the same way as the existing cycle ratchet allowances. A monotonically growing idle run SHALL fail even when no peak metric exceeds its ceiling.

#### Scenario: Idle growth fails despite passing peaks

- **WHEN** a soak stage's samples rise steadily (e.g. a staircase over hours) while every peak metric is within its allowance
- **THEN** the soak slope metric fails the gate
- **AND** the report names the metric, the measured growth-per-hour, and the exceeded allowance

#### Scenario: A bounded high-water soak passes

- **WHEN** a soak stage's footprint rises during warmup and then plateaus within noise
- **THEN** the soak slope and final-versus-reference metrics pass
- **AND** a noisy-but-bounded series passes within configured variance

### Requirement: Ratchet metrics exist per process role

The repeated-cycle ratchet criterion SHALL be evaluated not only on the process-tree total but also on the native application process and the web-content process separately, on every supported platform, so growth confined to one process is not diluted by a flat sibling.

#### Scenario: WebContent-only growth fails the gate

- **WHEN** repeated cycles leave the tree total within allowance but the web-content process grows per cycle beyond its role-level allowance
- **THEN** the gate fails and the report attributes the failure to the web-content role

### Requirement: The gate must fail a synthetic per-cycle leak under the peak ceiling

The harness SHALL provide a scenario-mode-only synthetic leak control (retain a configurable number of megabytes per cycle step, held until process exit) that is absent or inert in production builds. The gate's verification SHALL include a run with the synthetic leak sized to stay under every peak-metric ceiling, and that run SHALL fail on the ratchet or slope criterion — proving the gate detects per-cycle retention independent of absolute ceilings.

#### Scenario: Synthetic leak run fails the gate

- **WHEN** the harness runs with the synthetic leak control set to a size whose accumulated total remains under all peak ceilings at the configured cycle count
- **THEN** `bench:memory:check` exits non-zero, failing on a slope or ratchet metric
- **AND** the report shows every peak metric passing

#### Scenario: The synthetic leak does not exist in production

- **WHEN** the application runs under a production configuration without the scenario environment gate
- **THEN** no synthetic-leak retention code is reachable or installed

### Requirement: Baselines are recorded per platform with a platform discriminator

Memory baselines SHALL be recorded in the shared baselines file with a platform discriminator as part of the machine profile. Baselines recorded on one platform SHALL never be applied to a result from another; macOS baseline entries SHALL follow the same per-metric structure (baseline, allowances, observed variance, sample count, gated/diagnostic classification, ratchet parameters) as Linux entries.

#### Scenario: macOS baselines gate macOS runs only

- **WHEN** a macOS result is checked and macOS baselines exist for a matching machine profile
- **THEN** the comparison uses the macOS entries and ignores Linux entries
- **AND** a Linux result is never compared against macOS entries
