# iOS Reliability Test Harness & Crash Observability

This guide details the deterministic iOS simulator smoke test harness, liveness oracle, crash report aggregator, and diagnostic tooling for Plethora on macOS.

---

## Prerequisites

Run the automated host preflight script:
```bash
npm run test:ios:setup
```

Requirements:
- macOS (Apple Silicon / Intel)
- Xcode 15+ and Command Line Tools (`xcodebuild`, `xcrun`)
- Active iOS Simulator Runtime (iOS 17+ or iOS 18+)
- Rust target `aarch64-apple-ios-sim`:
  ```bash
  rustup target add aarch64-apple-ios-sim
  ```
- Node.js 18+

---

## Running the Smoke Test

To execute the deterministic simulator smoke test:
```bash
npm run test:ios:smoke
```

### What the smoke test executes:
1. Provisions and boots the configured simulator (`iPhone 17 Pro`).
2. Compiles and installs the native iOS `.app` bundle.
3. Streams unified logs (`subsystem == "com.plethora.app"`).
4. Launches the app and monitors the multi-signal **Liveness Oracle**:
   - `data-plethora-mounted="true"` on `#root`
   - `data-plethora-ready="true"` on `<body>`
   - `data-plethora-heartbeat="<counter>"` advancing continuously
5. Tests deep-link navigation routes (`plethora://documents`, `plethora://settings`, `plethora://dashboard`).
6. Exercises process lifecycle: terminates process via `simctl terminate` and verifies cold relaunch state recovery.
7. Aggregates all logs, screenshots, and native `.ips` crash logs into `.test-artifacts/ios/<timestamp>-<run-id>/`.
8. Classifies verdict in `test-result.json`.

---

## Resetting Simulator State

To terminate running instances and optionally erase sandboxed app data:
```bash
# Terminate running app
npm run test:ios:reset

# Terminate and erase sandboxed app data
bash scripts/ios-test/reset-simulator.sh --erase
```

---

## Failure Taxonomy

Every test run outputs a classified verdict in `test-result.json`:

| Classification | Root Cause Indicator |
|---|---|
| `native_crash` | `.ips` crash report present (SIGSEGV, SIGBUS, EXC_BAD_ACCESS) |
| `rust_panic` | `panicked at` string in process stderr or stdout |
| `swift_exception` | Uncaught ObjC / Swift exception (`NSInternalInconsistencyException`) |
| `javascript_exception` | Uncaught JS exception or React ErrorBoundary crash |
| `startup_timeout` | App failed to reach `plethora-ready` state within 30s |
| `ui_hang` | App process alive but UI heartbeat stalled for > 5s |
| `watchdog_termination` | iOS 0x8badf00d watchdog termination |
| `memory_pressure_or_oom` | OS Jetsam memory termination |
