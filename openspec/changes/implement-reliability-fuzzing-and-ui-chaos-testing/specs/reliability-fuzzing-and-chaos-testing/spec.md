## ADDED Requirements

### Requirement: Pure Rust Parser Fuzzing SHALL be automated
The repository SHALL provide pure Rust fuzz targets (`src-tauri/fuzz/`) for PDF, EPUB, Kindle, HTML, and Share Extension parsers. The fuzzers SHALL run in-memory without GUI dependencies and SHALL catch panics, infinite loops, and unbounded allocations.

#### Scenario: Fuzzer encounters malformed input
- **WHEN** mutated byte inputs are provided to `processor::pdf` or `processor::epub`
- **THEN** the parser returns a structured `Err(...)` without panicking, and any discovered crashing input is automatically minimized and saved to `src-tauri/tests/fixtures/regression/`

### Requirement: State-Aware UI Monkey Testing SHALL be deterministic and seeded
The repository SHALL provide a semantic UI monkey runner (`scripts/ios-test/monkey.mjs`) that generates valid UI action sequences based on the active screen state. Every run SHALL accept a `--seed` argument that makes the sequence 100% reproducible.

#### Scenario: Monkey failure reproduces deterministically
- **WHEN** a monkey test fails at step 47 with seed `8417294`
- **THEN** executing `npm run test:ios:monkey -- --seed 8417294` repeats the exact same 47 actions and reproduces the identical failure state and classification

### Requirement: Process Deadlocks SHALL be detected and sampled automatically
When a test watchdog detects that the process is alive but UI heartbeat updates or IPC responses have stalled for more than 5 seconds, the harness SHALL capture a native process thread sample (`sample` / `lldb`) before terminating the application.

#### Scenario: Main thread deadlock triggers thread backtrace capture
- **WHEN** an async lock or WebKit dispatch contention freezes the main thread
- **THEN** the harness captures `hang_sample.txt` showing all thread backtraces and classifies the failure as `ui_hang`

### Requirement: Unattended Nightly Mac Mini Automation SHALL be supported
The repository SHALL provide a standalone nightly automation runner (`scripts/ios-test/nightly.sh`) and `launchd` service template capable of pulling changes, executing smoke, E2E, multi-seed monkey runs, and bounded fuzzing campaigns unattended, aggregating all artifacts into structured reports.

#### Scenario: Nightly suite runs unattended
- **WHEN** `scripts/ios-test/nightly.sh` is triggered on the Mac mini
- **THEN** it executes the full test matrix, records results in `.test-artifacts/nightly/`, and exits with 0 on all passes or non-zero on any failure
