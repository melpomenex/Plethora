## ADDED Requirements

### Requirement: Memory is a first-class gate metric

The performance gate SHALL evaluate memory metrics produced by the memory benchmark harness alongside its existing throughput benchmarks. The gate SHALL evaluate, at minimum: idle total proportional memory, one-document total, four-tab total, post-close total, repeated-cycle final total, scenario peak total, native-process proportional memory, and web-content-process proportional memory.

Memory evaluation SHALL be invocable independently of the throughput benchmarks, because it requires a running application rather than an in-process benchmark runner.

#### Scenario: Memory metrics are evaluated from a harness result

- **WHEN** the gate is run against a memory benchmark result file
- **THEN** every listed metric is extracted and compared against its baseline
- **AND** a metric present in the baseline but absent from the result is reported as a failure, not skipped

#### Scenario: Throughput gate is unaffected

- **WHEN** the existing benchmark gate is run
- **THEN** it evaluates throughput benchmarks and the bundle budget exactly as before
- **AND** it does not require a memory result file to be present

#### Scenario: Unreliable runs are not turned into verdicts

- **WHEN** the memory result file is marked unreliable by the harness
- **THEN** the gate reports that it cannot issue a verdict and why
- **AND** it does not compare the unreliable numbers against the baseline

### Requirement: Some memory metrics are gated and others are recorded as diagnostics

Each memory metric SHALL be declared either as a hard gate — a regression fails the run — or as a recorded diagnostic that is reported but never fails a run. The declaration SHALL live with the baselines and be visible in the gate's output, so it is never ambiguous whether a reported number can fail the build.

#### Scenario: A diagnostic metric regresses

- **WHEN** a metric declared as a diagnostic exceeds its baseline
- **THEN** the gate reports the regression with its baseline, measured value, and deltas
- **AND** the gate's exit status is unaffected by that metric

#### Scenario: A gated metric regresses

- **WHEN** a metric declared as a hard gate exceeds its threshold
- **THEN** the gate exits with a non-zero status
- **AND** the output distinguishes it from any diagnostic regressions reported in the same run

#### Scenario: Metric classification is visible

- **WHEN** the gate prints its report
- **THEN** each memory row indicates whether the metric is gated or diagnostic

### Requirement: Memory baselines are committed, empirically derived, and scoped to a machine profile

Memory baselines SHALL live in a committed file, tracked in git, recorded from the corrected implementation rather than from any pre-fix measurement. Each entry SHALL record the metric's baseline value and the observed variance from which its tolerance was derived. The file SHALL record the machine profile the baseline was taken on — operating system and kernel, web engine version, CPU, total memory, application build profile, and corpus identity — and the number of samples the baseline was derived from.

The gate SHALL compare a result only against a baseline whose machine profile matches on the fields declared as materially affecting the measurement, and SHALL report a mismatch rather than issuing a verdict across incomparable profiles.

#### Scenario: Baseline records how it was derived

- **WHEN** a reviewer reads the memory baseline file
- **THEN** each entry states its value, its tolerance, the observed variance behind that tolerance, and how many samples produced it
- **AND** the machine profile the numbers came from is recorded in the same file

#### Scenario: Result from a different machine profile

- **WHEN** a memory result is evaluated on a machine whose profile differs from the baseline's on a materially significant field
- **THEN** the gate reports the mismatch, naming the differing fields
- **AND** it does not issue a pass or fail verdict from that comparison

#### Scenario: Intentional memory change

- **WHEN** a change deliberately alters memory behavior and a gated metric exceeds its threshold
- **THEN** the gate fails until the author re-records the baseline entry in the same pull request
- **AND** the baseline change is visible as a reviewable diff

#### Scenario: New metric without a baseline

- **WHEN** the result contains a memory metric with no baseline entry
- **THEN** the gate reports it as a warning rather than a failure
- **AND** the output includes the exact entry to add to the baseline file

### Requirement: Memory thresholds combine a percentage and an absolute margin

A gated memory metric SHALL fail only when the measured value exceeds a threshold derived from both a proportional allowance and an absolute allowance over its baseline, so that small metrics are not tripped by ordinary allocator jitter and large metrics cannot absorb a large regression. Both allowances SHALL be configurable per metric with a documented default, and the effective threshold SHALL be reported with any failure.

Thresholds SHALL be tight enough that a doubling of any gated memory metric fails, and loose enough that repeated runs of unchanged code on the baseline machine profile pass.

#### Scenario: Ordinary variance passes

- **WHEN** unchanged code is measured repeatedly on the baseline machine profile
- **THEN** every gated metric stays within its threshold on every run

#### Scenario: A doubling fails

- **WHEN** a gated memory metric measures twice its baseline
- **THEN** the gate fails and names that metric

#### Scenario: A small metric is not tripped by jitter

- **WHEN** a small-valued metric fluctuates by an amount that is large in percentage terms but negligible in absolute terms
- **THEN** the absolute allowance keeps the metric within its threshold
- **AND** the gate does not fail

#### Scenario: A large metric cannot hide a large regression

- **WHEN** a large-valued metric grows by an amount that is small in percentage terms but large in absolute terms
- **THEN** the absolute allowance is exceeded
- **AND** the gate fails

### Requirement: The gate applies a ratchet criterion to repeated open/close cycles

Beyond peak-memory thresholds, the gate SHALL evaluate whether memory accumulates across the repeated open/close cycles. It SHALL compare the post-warm-up cycles against a warmed-up reference and fail when growth exceeds a configured allowance or when the trend across those cycles is consistently increasing. The criterion, its warm-up boundary, and its allowance SHALL be recorded with the baselines and reported with any failure.

#### Scenario: A per-cycle leak fails the gate

- **WHEN** each open/close cycle permanently retains a fraction of a document's memory
- **THEN** the ratchet criterion is exceeded
- **AND** the gate fails and reports the growth per cycle and the allowance

#### Scenario: A bounded high-water mark passes

- **WHEN** memory rises during warm-up and then holds steady across the remaining cycles
- **THEN** the ratchet criterion passes
- **AND** the report shows the warmed-up reference and the final value

#### Scenario: Ratchet detection is independent of peak thresholds

- **WHEN** every peak metric is within its threshold but cycle-over-cycle growth exceeds the ratchet allowance
- **THEN** the gate still fails
- **AND** the output attributes the failure to the ratchet criterion rather than to a peak metric

### Requirement: The gate reports memory as a baseline/current/delta/status table

The gate's output SHALL present memory metrics in an aligned table showing, for each metric, its baseline, its measured value, the change, and its status. Values SHALL be printed in a human-readable unit. When a metric fails, the output SHALL additionally name the metric, its baseline, its measured value, the absolute delta, the percentage delta, and the configured threshold that was exceeded.

The gate SHALL write a machine-readable record of its evaluation, in keeping with how the existing gate persists benchmark results.

#### Scenario: Passing run prints a full table

- **WHEN** the memory gate passes
- **THEN** it prints one row per memory metric with baseline, current, change, and status
- **AND** it prints the machine profile the comparison was made against

#### Scenario: Failing run is unambiguous

- **WHEN** a gated memory metric regresses
- **THEN** the output names the metric, baseline, measured value, absolute delta, percentage delta, and the exceeded threshold
- **AND** a reader can identify the regressed metric without consulting the baseline file

#### Scenario: Results are persisted for later comparison

- **WHEN** the memory gate runs
- **THEN** it writes a machine-readable record of every metric's baseline, measured value, threshold, and verdict
- **AND** that record can be archived as a build artifact

### Requirement: Memory is enforced locally and recorded in continuous integration

The memory gate SHALL be enforced as a hard gate when run on a machine matching the recorded baseline profile, exiting non-zero on a gated regression. In continuous integration, the memory scenario SHALL run in a job that records and publishes its numbers as artifacts but does not block the workflow, because shared runner memory is not comparable to the baseline profile. The existing blocking throughput-benchmark job SHALL remain unchanged and SHALL NOT depend on the memory job.

#### Scenario: Local run enforces

- **WHEN** the memory gate is run on the baseline machine profile and a gated metric regresses
- **THEN** the command exits non-zero

#### Scenario: Continuous integration records without blocking

- **WHEN** the continuous integration memory job runs and reports a regression
- **THEN** the numbers are published as an artifact and the regression is visible in the job log
- **AND** the workflow's overall result is not failed by that job

#### Scenario: Throughput gate keeps blocking

- **WHEN** a pull request regresses a throughput benchmark past its tolerance
- **THEN** the existing benchmark job still fails the workflow
- **AND** its behavior is unchanged by the addition of the memory job

### Requirement: Memory collection is behind a platform abstraction

The gate and harness SHALL treat memory collection as a platform-specific capability behind a common interface, so a collector for another platform can be added without changing the scenario, the baseline format, the threshold logic, or the reporting. No part of the gate SHALL assume that a Linux-specific memory source exists on every platform.

#### Scenario: Adding a platform does not change shared logic

- **WHEN** a memory collector for an additional platform is added
- **THEN** the scenario definition, baseline format, threshold evaluation, ratchet criterion, and report rendering are reused unchanged
- **AND** only the collector and its platform's baseline profile are new

#### Scenario: Baseline records its platform

- **WHEN** a memory baseline is recorded
- **THEN** the platform it applies to is part of its machine profile
- **AND** the gate refuses to compare against a baseline from another platform

### Requirement: Re-recording a memory baseline is a documented, deliberate action

The system SHALL document how to re-record memory baselines: the command to run, how many samples to collect, how the recorded tolerance is derived from observed variance, what machine-profile fields must be updated, and the expectation that a baseline change is justified in the pull request that makes it. Re-recording SHALL be an explicit operation and SHALL NOT happen as a side effect of running the benchmark or the gate.

#### Scenario: Running the benchmark does not move the baseline

- **WHEN** the memory benchmark or the gate is run
- **THEN** the committed baseline file is not modified

#### Scenario: Documented re-record procedure

- **WHEN** a maintainer follows the documented re-record procedure
- **THEN** the resulting baseline file contains updated values, tolerances derived from the observed variance, the sample count, and the current machine profile
- **AND** the change is a reviewable diff
