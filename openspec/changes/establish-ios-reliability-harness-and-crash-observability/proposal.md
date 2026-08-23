## Why

Plethora now builds and boots in the iOS Simulator, but lacks an automated, deterministic native test harness to detect and diagnose crashes, deadlocks, WebKit white-screens, unhandled JavaScript rejections, Rust panics, or lifecycle hangs. Today, verifying an iOS build requires manually opening Xcode or running `tauri:ios:dev:sim`, visually checking the simulator, and guessing why a failure occurred. 

Recent WebKit/Tauri changes (such as WRY issue #1775 where `callOnMainRunLoopAndWait` deadlocked Tokio worker threads, and dynamic import waterfalls in WKWebView) demonstrated that process survival alone is not a sufficient liveness oracle: WKWebView can remain running while the JavaScript event loop or IPC bridge is completely wedged.

We need a deterministic, headless-capable automated harness (`npm run test:ios:smoke` / `./scripts/ios-test/smoke.sh`) and crash observability pipeline that can run unattended on a Mac mini, verify startup liveness, execute basic navigation, capture structured crash artifacts, classify failure modes accurately, and power automated regression bisecting via `git bisect run`.

## What Changes

- Create the automated iOS simulator test harness in `scripts/ios-test/`:
  - `bootstrap.sh`: Simulator discovery, provisioning, and booting (targeting iPhone 17 Pro by default, parameterizable via `SIMULATOR_DEVICE`).
  - `smoke.sh`: End-to-end smoke execution (build iOS simulator target, install app, launch, verify liveness oracle, navigate major views, terminate, relaunch, verify recovery, exit with classified code).
  - `install.sh`: Deterministic app installation and container management via `xcrun simctl`.
  - `collect-logs.sh`: Structured artifact aggregator capturing unified system logs (`os_log`), JavaScript errors, Rust stdout/stderr, screenshots, and `.ips` crash reports.
  - `crash-detect.sh`: Post-run failure classifier assigning structured failure taxonomy tags.
  - `bisect-smoke.sh`: `git bisect run`-compatible wrapper supporting standard git bisect exit codes (0 = pass, 1 = fail, 125 = skip untestable commit).
  - `setup.sh`: Machine prerequisite validation (Xcode, command line tools, iOS runtimes, Rust iOS targets, Node dependencies).
- Establish the structured crash artifact layout under `.test-artifacts/ios/<timestamp>-<run-id>/`.
- Define and implement a multi-signal **Liveness Oracle** in the application frontend and Rust backend:
  - React/DOM readiness attribute (`data-plethora-ready="true"`).
  - Liveness heartbeat counter (`data-plethora-heartbeat`).
  - Native IPC health probe (`wait_for_backend_ready` / `ping_health`).
  - UI action completion feedback for simulator test drivers.
- Implement global error capture and diagnostic forwarding in test/debug builds:
  - Intercept `window.onerror`, `unhandledrejection`, React root/ErrorBoundary crashes, and Tauri command rejections.
  - Rust panic hook forwarding to standard logging and crash report directory.
  - Forward structured error telemetry to disk and simulator unified logging without exposing diagnostic UI in production release builds.
- Document recent crash-risk areas and create an investigation checklist covering WKWebView/WRY, StoreKit, TTS Sherpa, Share Extension, and document imports.

## Capabilities

### New Capabilities

- `ios-reliability-harness`: Deterministic CLI harness for automated iOS simulator booting, building, installation, execution, liveness verification, crash artifact harvesting, failure classification, and bisect automation.

### Modified Capabilities

None.

## Impact

- New scripts:
  - `scripts/ios-test/setup.sh`
  - `scripts/ios-test/bootstrap.sh`
  - `scripts/ios-test/smoke.sh`
  - `scripts/ios-test/install.sh`
  - `scripts/ios-test/collect-logs.sh`
  - `scripts/ios-test/crash-detect.sh`
  - `scripts/ios-test/reset-simulator.sh`
  - `scripts/ios-test/bisect-smoke.sh`
- New NPM scripts in `package.json`:
  - `test:ios:setup`
  - `test:ios:smoke`
  - `test:ios:bisect`
- Frontend telemetry & liveness hooks:
  - `src/main-bootstrap.ts`: Export machine-readable DOM startup milestones (`data-plethora-mounted`, `data-plethora-ready`).
  - `src/main.tsx`: Wire test-profile error sink for `ErrorBoundary` and global errors.
  - `src/lib/tauri.ts`: Export deterministic backend readiness and liveness ping helpers.
- Backend observability hooks:
  - `src-tauri/src/lib.rs`: Register Rust panic hook and test liveness ping command (`ping_health`).
- Test artifact directory:
  - `.test-artifacts/` (gitignored).

**Owns:** Simulator runner scripts, liveness oracle contracts, crash artifact schema, error logging sinks, bisect script.  
**Must NOT change:** Production business logic, UI layouts, release-profile gating, database schema.

## Dependencies

- **Hard:** Relies on local Mac mini environment with Xcode 15/16 and iOS Simulator runtime.
- **Soft:** Feeds into Proposal 3 (Native E2E Automation) and Proposal 4 (Chaos/Monkey Testing) as the underlying execution and artifact-capture engine.

## Parallelization Notes

Can be implemented in Wave 1. Does not collide with Document Import refactoring (Proposal 2) because runner scripts live in `scripts/ios-test/` and frontend changes are strictly additive DOM/window attributes.

## Migration / Backward Compatibility

Additive only. Gated to test/development builds so that release builds (`PLETHORA_BUILD_PROFILE=store`) do not emit diagnostic overlays or test hooks.

## Risks

- Flaky simulator cold-starts: Handled with explicit boot retry loops, simulator status polling (`xcrun simctl bootstatus`), and bounded timeouts.
- Zombie simulator processes: Addressed via `reset-simulator.sh` teardown hooks.
