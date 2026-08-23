## 1. Pure Rust Parser Fuzz Targets

- [ ] 1.1 Initialize `cargo-fuzz` setup under `src-tauri/fuzz/` with targets: `fuzz_pdf`, `fuzz_epub`, `fuzz_kindle`, `fuzz_html_markdown`, `fuzz_share_manifest`.
- [ ] 1.2 Seed fuzzers with valid initial fixtures from `src-tauri/tests/fixtures/documents/`.
- [ ] 1.3 Implement automated crash capture helper in `src-tauri/fuzz/` that saves minimized reproducer inputs into `src-tauri/tests/fixtures/regression/`.
- [ ] 1.4 Add Rust regression test `src-tauri/tests/fuzz_regression.rs` that loads all committed regression fixtures and asserts zero panics.
- [ ] 1.5 Add NPM script: `"test:fuzz:imports": "cd src-tauri && cargo +nightly fuzz run fuzz_pdf -- -max_total_time=60 && cargo +nightly fuzz run fuzz_epub -- -max_total_time=60"`.

## 2. State-Aware UI Monkey Tester Engine

- [ ] 2.1 Implement `scripts/ios-test/monkey.mjs`: Mulberry32 PRNG initialized via `--seed <number>`, step counter via `--steps <number>`, and state-machine action generator.
- [ ] 2.2 Implement simulator bridge in `monkey.mjs`: map semantic actions (`OPEN_TAB`, `IMPORT_FIXTURE`, `SCROLL`, `START_TTS`, `BACKGROUND_APP`, `ROTATE_SCREEN`, `TERMINATE_APP`) to Maestro or `xcrun simctl` commands.
- [ ] 2.3 Add structured action history logging: write executed actions and seed to `$ARTIFACT_DIR/actions.json` after every step.
- [ ] 2.4 Add failure reproduction helper: if monkey fails at step N, output exact reproducer command: `npm run test:ios:monkey -- --seed <seed> --steps <N>`.
- [ ] 2.5 Add NPM script: `"test:ios:monkey": "node scripts/ios-test/monkey.mjs"`.

## 3. Chaos Scenarios & Fault Injection Hooks

- [ ] 3.1 Implement compile-time test hooks in `src-tauri/src/test_hooks.rs` (`#[cfg(debug_assertions)]`) reading `PLETHORA_TEST_FAIL_IMPORT_STAGE` and `PLETHORA_TEST_DELAY_IMPORT_STAGE`.
- [ ] 3.2 Create `scripts/ios-test/chaos-scenarios.sh`: automate interruption scenarios (kill app at 10%, 50%, 95% of import progress; test cold launch state recovery).
- [ ] 3.3 Create concurrent stress scenario: trigger 5 simultaneous duplicate imports and assert exact 1 success / 4 typed `DuplicateDocument` errors without deadlock.

## 4. Deadlock Detection & Stack Sampling

- [ ] 4.1 Create `scripts/ios-test/sample-hang.sh`: when UI heartbeat stalls > 5s, execute `sample` and `lldb` backtrace on the target simulator app PID and save to `$ARTIFACT_DIR/hang_sample.txt`.
- [ ] 4.2 Integrate `sample-hang.sh` into `smoke.sh`, `e2e.sh`, and `monkey.mjs` watchdogs.

## 5. Mac Mini Nightly Automation & Suite Tiering

- [ ] 5.1 Create `scripts/ios-test/nightly.sh`: orchestrated runner that pulls latest `main`, runs unit tests, executes `smoke.sh`, runs fixture corpus imports, executes E2E flows, runs 10 randomized monkey seeds (500 steps each), runs bounded fuzzing, and writes summary report.
- [ ] 5.2 Create `scripts/ios-test/soak.sh`: 2-hour continuous monkey and reader soak runner monitoring memory RSS and logging leaks.
- [ ] 5.3 Add NPM scripts in `package.json`: `"test:ios:soak": "bash scripts/ios-test/soak.sh"`, `"test:ios:nightly": "bash scripts/ios-test/nightly.sh"`.
- [ ] 5.4 Provide `launchd` plist template in `scripts/ios-test/com.plethora.nightly.plist` for scheduling unattended runs on macOS.

## 6. Verification & Regression Workflow Documentation

- [ ] 6.1 Execute `npm run test:ios:monkey -- --seed 12345 --steps 50` on the Mac host and verify clean execution.
- [ ] 6.2 Execute bounded fuzz targets and verify clean execution.
- [ ] 6.3 Write `docs/testing/ios-fuzzing-and-chaos.md` covering monkey testing, seed reproduction, fault injection hooks, and triage.
- [ ] 6.4 Write `docs/testing/nightly-mac-mini.md` covering launchd setup, artifact retention, and failure alert workflows.
