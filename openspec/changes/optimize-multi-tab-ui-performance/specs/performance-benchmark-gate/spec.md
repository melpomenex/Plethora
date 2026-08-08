## MODIFIED Requirements

### Requirement: Benchmark harness discovers and runs benchmark suites

The system SHALL provide a benchmark harness, invoked by `npm run bench`, that discovers every `*.bench.ts` and `*.bench.tsx` file under `src/` and executes it with Vitest's benchmark runner. The harness SHALL default to a Node environment and SHALL NOT load the jsdom unit-test setup file. A benchmark file that measures React render cost MAY opt into a jsdom environment for itself, via a per-file environment declaration, and SHALL supply its own DOM shims through a bench-specific setup module rather than the unit-test setup. The harness SHALL run benchmark files one at a time rather than in parallel, and SHALL write machine-readable results to a JSON file.

#### Scenario: Running the benchmark suite

- **WHEN** a developer runs `npm run bench`
- **THEN** every `*.bench.ts` and `*.bench.tsx` file under `src/` is executed
- **AND** results including operations-per-second for each named benchmark are written to `.bench/results.json`
- **AND** the command exits 0 regardless of measured speed, because measurement alone is not a gate

#### Scenario: Benchmark files do not run under the unit test suite

- **WHEN** a developer runs `npm test` or `npm run test:run`
- **THEN** no `*.bench.ts` or `*.bench.tsx` file is executed
- **AND** the unit test run time is unaffected by the presence of benchmark files

#### Scenario: Benchmarks are isolated from each other

- **WHEN** two benchmark files exist
- **THEN** they are not executed concurrently
- **AND** each file runs in its own isolated worker, so one suite's allocations cannot affect another's measurements

#### Scenario: A render benchmark opts into a DOM environment

- **WHEN** a benchmark file declares a jsdom environment for itself and is run by `npm run bench`
- **THEN** that file executes with a DOM available
- **AND** its results appear in `.bench/results.json` alongside the Node-environment benchmarks

#### Scenario: Node benchmarks are unaffected by the DOM lane

- **WHEN** a benchmark file makes no environment declaration
- **THEN** it runs in a Node environment with no DOM
- **AND** it loads only the Node bench setup, not the jsdom unit-test setup and not the DOM bench shims

### Requirement: Measurements are normalized against an in-process noise anchor

Every benchmark run SHALL include a fixed anchor benchmark that performs a deterministic synthetic workload. The gate SHALL express each benchmark's result as a dimensionless cost ratio computed as `anchorHz / benchHz`, and SHALL compare that ratio — never raw milliseconds or raw operations-per-second — against the recorded baseline. Benchmarks running in a DOM environment SHALL be normalized against the same anchor as Node-environment benchmarks; the gate SHALL NOT require a separate per-environment anchor.

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

#### Scenario: DOM benchmark is normalized without a second anchor

- **WHEN** the results contain benchmarks from both the Node lane and the DOM lane
- **THEN** both are compared against the single anchor benchmark's measured rate
- **AND** the gate requires no additional anchor entry for the DOM lane
