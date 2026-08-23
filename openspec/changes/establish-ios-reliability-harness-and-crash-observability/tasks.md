## 1. Environment Setup & Simulator Provisioning

- [ ] 1.1 Create `scripts/ios-test/setup.sh`: verify Xcode version, Command Line Tools, iOS Simulator runtime availability, Rust `aarch64-apple-ios-sim` target, and Node dependencies; output clear remediation commands if any component is missing.
- [ ] 1.2 Create `scripts/ios-test/bootstrap.sh`: find or create the target simulator device (default: `iPhone 17 Pro`), verify its state via `xcrun simctl list devices`, boot the simulator if shutdown, wait for boot completion via `xcrun simctl bootstatus`, and export `SIMULATOR_UDID`.
- [ ] 1.3 Create `scripts/ios-test/reset-simulator.sh`: cleanly terminate all running Plethora processes, erase application container data, or reboot the simulator to ensure a pristine test state.

## 2. Liveness Oracle & Application Telemetry

- [ ] 2.1 Update `src/main-bootstrap.ts` and `src/main.tsx` to set machine-readable DOM status markers: `data-plethora-mounted="true"`, `data-plethora-ready="true"`, and `data-plethora-active-tab="<tab>"`.
- [ ] 2.2 Implement monotonic JS heartbeat counter in `src/main-bootstrap.ts` / `src/main.tsx` updating `document.body.setAttribute("data-plethora-heartbeat", String(counter))` every 500ms.
- [ ] 2.3 Add native test command `ping_health` in `src-tauri/src/lib.rs` returning status, process timestamp, and resident memory size (`memory_rss`).
- [ ] 2.4 Add global error forwarder in `src/main.tsx`: capture `window.onerror`, `unhandledrejection`, and React `ErrorBoundary` failures into `window.__plethoraTestErrors` and forward to `console.error` and `os_log` via native logger.
- [ ] 2.5 Add Rust panic hook in `src-tauri/src/lib.rs` that logs structured panic info to stderr and writes a panic marker file when running in test builds.

## 3. Smoke Test Harness Implementation

- [ ] 3.1 Create `scripts/ios-test/install.sh`: build the iOS simulator binary using `tauri ios build --ci --target aarch64-sim`, locate the resulting `.app` bundle, install it into the target simulator with `xcrun simctl install`, and set appropriate app container permissions.
- [ ] 3.2 Create `scripts/ios-test/smoke.sh`: orchestrate bootstrap, install, launch with log stream capture, poll liveness oracle for readiness (timeout: 30s), perform tab navigation (Dashboard -> Documents -> Queue -> Review -> Settings), terminate the app, cold relaunch, verify readiness again, and exit with code 0 on success or classified failure code.
- [ ] 3.3 Add NPM scripts in `package.json`: `"test:ios:setup": "bash scripts/ios-test/setup.sh"`, `"test:ios:smoke": "bash scripts/ios-test/smoke.sh"`, and `"test:ios:reset": "bash scripts/ios-test/reset-simulator.sh"`.

## 4. Crash Capture & Artifact Aggregation

- [ ] 4.1 Create `scripts/ios-test/collect-logs.sh`: on run completion or failure, assemble `.test-artifacts/ios/<timestamp>-<run-id>/` containing `metadata.json`, `stdout.log`, `stderr.log`, `simulator.log`, `unified.log` (filtered `xcrun simctl spawn log stream`), `javascript-errors.log`, and `rust.log`.
- [ ] 4.2 Add screenshot capture hook in `collect-logs.sh` using `xcrun simctl io "$SIMULATOR_UDID" screenshot "$ARTIFACT_DIR/screenshot.png"`.
- [ ] 4.3 Add `.ips` crash log harvest in `collect-logs.sh`: inspect `~/Library/Logs/DiagnosticReports/` for crash logs matching `plethora` generated during the run window and copy to `$ARTIFACT_DIR/crash.ips`.
- [ ] 4.4 Create `scripts/ios-test/crash-detect.sh`: parse collected logs, evaluate failure taxonomy rules, generate `test-result.json`, and output human-readable failure summary.

## 5. Git Bisect Automation

- [ ] 5.1 Create `scripts/ios-test/bisect-smoke.sh`: wrapper around `smoke.sh` designed for `git bisect run`.
- [ ] 5.2 Implement exit code mapping in `bisect-smoke.sh`: exit 0 on clean pass, exit 1 on crash/hang/unhandled error, and exit 125 (skip) on compile failures, simulator launch timeouts, or missing historical prerequisites.
- [ ] 5.3 Write documentation and manual reproduction steps in `docs/testing/ios-bisect.md` showing how to run `git bisect start`, `git bisect bad`, `git bisect good <commit>`, and `git bisect run npm run test:ios:bisect`.

## 6. Verification & Documentation

- [ ] 6.1 Execute `npm run test:ios:setup` on the Mac mini host and verify all tool checks pass.
- [ ] 6.2 Execute `npm run test:ios:smoke` against current `main` and verify full pass with artifact generation.
- [ ] 6.3 Induce a simulated crash/hang in test build (e.g. fatal JS error or artificial panic) and verify `smoke.sh` fails, `crash-detect.sh` classifies correctly, and full artifact directory is emitted.
- [ ] 6.4 Write `docs/testing/ios-harness.md` covering harness architecture, artifact locations, triage steps, and Mac mini usage.
