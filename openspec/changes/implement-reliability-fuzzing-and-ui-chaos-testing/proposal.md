## Why

Deterministic smoke and end-to-end tests verify that known user journeys work as designed under happy-path conditions. However, real-world mobile reliability issues typically arise from unexpected edge cases:
- Pathological, corrupted, or crafted document files triggering parser panics or unbounded memory allocations.
- Complex interleaved user action sequences (e.g., triggering an import, immediately opening another document, rotating the screen, and backgrounding the app).
- Asynchronous race conditions between React state, Zustand stores, SQLite transactions, and the native IPC bridge.
- Process interruptions, memory pressure terminations, and cold relaunch state desynchronizations.

To systematically discover and prevent crashes, hangs, deadlocks, panics, memory leaks, and state corruption before release, we need an automated **Reliability Fuzzing and Chaos Testing System** tailored for unattended operation on the Mac mini.

This is explicitly **reliability fuzzing**, not security fuzzing: its objective is ensuring the app never crashes, deadlocks, or corrupts user state, regardless of adversarial or malformed inputs and unpredictable action sequences.

## What Changes

- **Layer A: Pure Rust Parser & Ingestion Fuzzing**:
  - Introduce `cargo-fuzz` / libFuzzer and `proptest` targets in `src-tauri/fuzz/`:
    - `fuzz_pdf_extraction`: Fuzz PDF extraction and metadata parsing.
    - `fuzz_epub_extraction`: Fuzz EPUB ZIP structures, OPF manifests, and chapter XHTML parsing.
    - `fuzz_kindle_clippings`: Fuzz Kindle clipping format parser.
    - `fuzz_html_markdown`: Fuzz HTML sanitization and Markdown ingestion.
    - `fuzz_share_manifest`: Fuzz iOS share extension JSON manifests.
  - Mutation engine applies bit flips, chunk deletions, header alterations, and pathological UTF-8 sequences.
  - Automatic crash minimization: all discovered panics or crashes automatically save minimized inputs to `src-tauri/tests/fixtures/regression/`.
- **Layer B: State-Aware UI Monkey & Chaos Tester**:
  - Implement a deterministic, seeded semantic UI action generator in `scripts/ios-test/monkey.mjs` (`npm run test:ios:monkey`).
  - Actions operate on high-level semantic intents (`OPEN_DOCUMENTS`, `IMPORT_RANDOM_FIXTURE`, `START_TTS`, `BACKGROUND_APP`, `ROTATE_SCREEN`, `DELETE_DOCUMENT`, etc.) rather than random screen coordinates.
  - State machine awareness guarantees that generated actions are valid in the current UI state.
  - Seeded PRNG (`--seed <number>`): every failure is 100% reproducible with an exact action sequence trace.
- **Chaos & Fault Injection Scenarios**:
  - Interruption scenarios: terminate app at 10%, 50%, or 95% of import progress; verify clean recovery on relaunch.
  - Stress scenarios: rapid multi-file imports, concurrent duplicate imports, backgrounding during TTS playback, screen rotation during PDF rendering.
  - Test-only fault injection hooks (`PLETHORA_TEST_FAIL_IMPORT_STAGE`, `PLETHORA_TEST_DELAY_IMPORT_STAGE`) strictly compile-time gated to debug/test builds.
- **Hang & Deadlock Detection**:
  - Integrated watchdog monitors UI heartbeat and IPC responsiveness.
  - Automatically captures process thread stack traces (`sample` / `lldb`) upon detecting a hung simulator process before termination.
- **Memory & Resource Smoke Profiling**:
  - Monitor WKWebView and host RSS during long soak runs to detect runaway memory leaks.
- **Automated Run Tiers & Mac Mini Nightly Automation**:
  - Provide easy CLI tiers: `test:ios:smoke`, `test:ios:imports`, `test:ios:e2e`, `test:ios:monkey`, `test:fuzz:imports`, `test:ios:soak`, `test:ios:nightly`.
  - Configurable nightly schedule runner (via `launchd` or local cron) that executes multi-seed monkey runs and bounded fuzzing campaigns unattended.

## Capabilities

### New Capabilities

- `reliability-fuzzing-and-chaos-testing`: Automated pure-Rust parser fuzzers, deterministic seeded UI monkey tester, chaos fault injection scenarios, deadlock stack sampling, and unattended nightly Mac mini automation.

### Modified Capabilities

None.

## Impact

- New fuzz targets & test suites:
  - `src-tauri/fuzz/` (cargo-fuzz targets and dictionaries)
  - `src-tauri/tests/fixtures/regression/` (minimized reproducer corpus)
  - `scripts/ios-test/monkey.mjs` (state-aware action generator)
  - `scripts/ios-test/chaos-scenarios.sh` (interruption & fault injection harness)
  - `scripts/ios-test/nightly.sh` (Mac mini nightly test suite)
  - `scripts/ios-test/sample-hang.sh` (macOS process sampling helper)
- New NPM scripts in `package.json`:
  - `test:ios:monkey`
  - `test:ios:soak`
  - `test:fuzz:imports`
  - `test:ios:nightly`
- Test-only hooks:
  - `src-tauri/src/test_hooks.rs`: `#[cfg(debug_assertions)]` fault injection gates.
- Documentation:
  - `docs/testing/ios-fuzzing-and-chaos.md`
  - `docs/testing/nightly-mac-mini.md`

**Owns:** Fuzz targets, monkey tester engine, chaos scripts, nightly orchestrator, crash minimizer.  
**Must NOT change:** Production runtime code outside of test-hook macros; release build binaries.

## Dependencies

- **Hard:** Relies on Proposal 1 (`establish-ios-reliability-harness-and-crash-observability`) for artifact harvesting and Proposal 2 (`harden-document-import-pipeline`) for canonical parser error contracts.
- **Soft:** Feeds regressions into Proposal 3 (`implement-native-ios-simulator-e2e-automation`) as permanent deterministic test flows.

## Parallelization Notes

Can be implemented in Wave 3 (after Proposals 1 & 2 have landed). Parser fuzz targets (pure Rust) can be authored in Wave 1 in parallel with other work.

## Migration / Backward Compatibility

Additive only. Fuzz targets and test hooks are excluded from release builds.

## Risks

- Long-running fuzz test runaway resource usage: Mitigated with strict process timeouts (`--seconds 600`) and step limits (`--steps 500`).
- Flaky action generator: Prevented by state-aware filtering that only chooses valid actions for the active UI state.
