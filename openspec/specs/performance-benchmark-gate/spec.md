# performance-benchmark-gate Specification

## Purpose
TBD - created by archiving change add-performance-benchmark-gate. Update Purpose after archive.
## Requirements
### Requirement: Benchmark harness discovers and runs benchmark suites

The system SHALL provide a benchmark harness, invoked by `npm run bench`, that discovers every `*.bench.ts` file under `src/` and executes it with Vitest's benchmark runner. The harness SHALL run in a Node environment (not jsdom), SHALL run benchmark files one at a time rather than in parallel, and SHALL write machine-readable results to a JSON file.

#### Scenario: Running the benchmark suite

- **WHEN** a developer runs `npm run bench`
- **THEN** every `*.bench.ts` file under `src/` is executed
- **AND** results including operations-per-second for each named benchmark are written to `.bench/results.json`
- **AND** the command exits 0 regardless of measured speed, because measurement alone is not a gate

#### Scenario: Benchmark files do not run under the unit test suite

- **WHEN** a developer runs `npm test` or `npm run test:run`
- **THEN** no `*.bench.ts` file is executed
- **AND** the unit test run time is unaffected by the presence of benchmark files

#### Scenario: Benchmarks are isolated from each other

- **WHEN** two benchmark files exist
- **THEN** they are not executed concurrently
- **AND** each file runs in its own isolated worker, so one suite's allocations cannot affect another's measurements

### Requirement: Measurements are normalized against an in-process noise anchor

Every benchmark run SHALL include a fixed anchor benchmark that performs a deterministic synthetic workload. The gate SHALL express each benchmark's result as a dimensionless cost ratio computed as `anchorHz / benchHz`, and SHALL compare that ratio — never raw milliseconds or raw operations-per-second — against the recorded baseline.

#### Scenario: Slow machine does not fail the gate

- **WHEN** the harness runs on a machine where every benchmark, including the anchor, measures 2× slower than when the baselines were recorded
- **THEN** every cost ratio is unchanged within tolerance
- **AND** the gate passes

#### Scenario: A real regression fails the gate

- **WHEN** a code change makes one benchmarked path 2× slower while the anchor is unchanged
- **THEN** that benchmark's cost ratio is approximately 2× its baseline
- **AND** the gate fails

#### Scenario: Anchor is missing from results

- **WHEN** the gate reads a results file that contains no anchor benchmark
- **THEN** the gate exits with a non-zero status and reports that normalization is impossible
- **AND** it does not fall back to comparing raw timings

### Requirement: Benchmarks are deterministic

Benchmark suites SHALL construct their inputs from fixed constants or a seeded pseudo-random generator. Benchmark code SHALL NOT call `Math.random()`, SHALL NOT derive input size or shape from the current date or time, SHALL NOT perform network or filesystem I/O, and SHALL NOT depend on a Tauri runtime.

#### Scenario: Repeated runs measure the same work

- **WHEN** the same benchmark file is run twice on the same machine without code changes
- **THEN** both runs process inputs of identical size and content
- **AND** the reported cost ratios differ only by measurement noise

### Requirement: Baselines are committed and explicitly versioned

Recorded baselines SHALL live in `scripts/perf-baselines.json`, tracked in git. Each entry SHALL record the benchmark's name and its baseline cost ratio, and MAY record a per-benchmark tolerance overriding the file-level default. The file SHALL record which CI run produced the current numbers.

#### Scenario: Intentional performance change

- **WHEN** a pull request deliberately changes a benchmarked hot path and the measured cost exceeds the baseline tolerance
- **THEN** the gate fails until the author updates the baseline entry in `scripts/perf-baselines.json` within the same pull request
- **AND** the baseline change is visible as a reviewable diff

#### Scenario: Baseline for a removed benchmark

- **WHEN** `scripts/perf-baselines.json` contains an entry whose benchmark no longer appears in the results
- **THEN** the gate exits with a non-zero status and reports the missing benchmark
- **AND** the message states that either the benchmark was deleted or it failed to run

### Requirement: Gate enforces baselines with a non-zero exit code

The system SHALL provide `npm run bench:check`, which runs the benchmark harness, evaluates every result against `scripts/perf-baselines.json`, also runs the existing bundle-size budget check, and exits non-zero if any check fails.

#### Scenario: Regression beyond tolerance

- **WHEN** a benchmark's cost ratio exceeds its baseline multiplied by its tolerance
- **THEN** `npm run bench:check` exits with a non-zero status
- **AND** the output names the benchmark, its baseline cost, its measured cost, the ratio between them, and the tolerance that was exceeded

#### Scenario: All benchmarks within tolerance

- **WHEN** every benchmark's cost ratio is within its baseline tolerance and the bundle budget check passes
- **THEN** `npm run bench:check` exits 0
- **AND** the output summarizes each benchmark's measured cost against its baseline

#### Scenario: New benchmark without a baseline

- **WHEN** the results contain a benchmark that has no entry in `scripts/perf-baselines.json`
- **THEN** the gate reports it as a warning rather than a failure
- **AND** the output includes the exact JSON entry to paste into the baseline file

#### Scenario: Benchmark is substantially faster than its baseline

- **WHEN** a benchmark's measured cost is more than 25% below its recorded baseline
- **THEN** the gate reports a warning that the baseline is stale and should be re-recorded
- **AND** the gate does not fail on that basis alone

#### Scenario: Warn-only mode during rollout

- **WHEN** `npm run bench:check` is invoked with a warn-only flag
- **THEN** failures are reported in full detail
- **AND** the command exits 0

### Requirement: Continuous integration gates merges on the benchmark result

`.github/workflows/ci-regression.yml` SHALL contain a job that runs the benchmark gate on every pull request targeting `main` and on every push to `main`. A failing gate SHALL fail the workflow.

#### Scenario: Pull request introduces a regression

- **WHEN** a pull request is opened whose changes push a benchmark past its tolerance
- **THEN** the CI regression workflow fails
- **AND** the failing job's log names the regressed benchmark and by how much

#### Scenario: Release inherits the gate

- **WHEN** a release build is produced from `main`
- **THEN** the commit it builds from has already passed the benchmark gate on `main`

#### Scenario: Gate job does not require the Rust toolchain

- **WHEN** the benchmark CI job runs
- **THEN** it installs only Node dependencies
- **AND** it does not install system packages or a Rust toolchain

### Requirement: Misleading absolute-time assertions are removed

The wall-clock threshold assertions in `src/utils/__tests__/wave5Performance.test.ts` SHALL be removed, and the paths they nominally covered SHALL be covered by benchmark suites under the gate instead.

#### Scenario: No absolute timing assertions remain in the unit test suite

- **WHEN** the unit test suite is run
- **THEN** no test asserts on an absolute elapsed-milliseconds threshold for a computational hot path
- **AND** the scheduler and grading paths those assertions covered are represented in the benchmark suites

