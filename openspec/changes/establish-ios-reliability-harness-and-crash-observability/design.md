# Design: iOS Reliability Harness and Crash Observability

## 1. System Architecture Overview

The iOS Reliability Harness is a deterministic CLI test runner, observability collector, and triage system designed to run on a macOS host (e.g., Mac mini) equipped with Xcode and the iOS Simulator.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Mac mini Test Runner Host                          │
│                                                                             │
│  ┌───────────────────────┐   npm run test:ios:smoke   ┌──────────────────┐  │
│  │   Developer / CI /    │ ─────────────────────────> │ scripts/ios-test │  │
│  │   git bisect run      │ <───────────────────────── │     smoke.sh     │  │
│  └───────────────────────┘     (classified exit code) └────────┬─────────┘  │
│                                                                │            │
│         ┌──────────────────────┬───────────────────────────────┼─────────┐  │
│         │                      │                               │         │  │
│         ▼                      ▼                               ▼         ▼  │
│  ┌─────────────┐       ┌───────────────┐               ┌──────────────┐  │  │
│  │ bootstrap.sh│       │  install.sh   │               │collect-logs.sh  │  │
│  │ (boot sim)  │       │ (xcodebuild & │               │ (os_log, ips,│  │  │
│  └─────────────┘       │  simctl inst) │               │  screenshot) │  │  │
│                        └───────┬───────┘               └───────┬──────┘  │  │
│                                │                               │         │  │
└────────────────────────────────┼───────────────────────────────┼─────────┘──┘
                                 │                               │
                                 ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      iOS Simulator (iPhone 17 Pro)                          │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Plethora App Process (com.plethora.app)                               │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────┐     ┌─────────────────────────────┐  │  │
│  │  │ WKWebView / React Frontend  │     │ Rust Backend / Tauri Core   │  │  │
│  │  │                             │     │                             │  │  │
│  │  │ • data-plethora-mounted     │ IPC │ • ping_health command       │  │  │
│  │  │ • data-plethora-ready       │<───>│ • panic_hook telemetry      │  │  │
│  │  │ • data-plethora-heartbeat   │     │ • tokio runtime health      │  │  │
│  │  │ • window.onerror forwarder  │     │ • SQLite connection pool    │  │  │
│  │  └─────────────────────────────┘     └─────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Liveness Oracle & Watchdog Architecture

Traditional test frameworks often only check whether a process exists in the process table. On iOS/WebKit, a process can remain alive while:
1. The WKWebView dynamic module load waterfall is permanently wedged.
2. The JavaScript event loop is deadlocked or blocked by synchronous IPC.
3. The Tokio worker pool in Rust is starved by `callOnMainRunLoopAndWait` (WRY issue #1775).
4. React has crashed to a blank white screen without crashing the native host process.

### The Multi-Signal Oracle:

| Signal | Mechanism | Target Timing | Failure Implication |
|---|---|---|---|
| **Mount Milestone** | `document.getElementById("root").getAttribute("data-plethora-mounted") === "true"` | < 1.5s from launch | Bootstrap failed or HTML container missing |
| **Ready Milestone** | `document.body.getAttribute("data-plethora-ready") === "true"` | < 8.0s from launch | React mount crashed, startup store deadlock, or unhandled rejection |
| **Heartbeat Probe** | `data-plethora-heartbeat` integer counter incremented every 500ms via `requestAnimationFrame` | Monotonically advancing | UI event loop freeze, thread contention, or layout lock |
| **IPC Health Command** | `invoke("ping_health")` returning `{ status: "ok", timestamp, memory_rss }` | Roundtrip < 500ms | Tauri IPC bridge hung, Tokio runtime deadlock |
| **UI Action Ack** | Navigation events update `data-plethora-active-tab="<tab-name>"` | Synchronous with view switch | State machine race or tab rendering crash |

---

## 3. Failure Taxonomy & Classification Engine

`scripts/ios-test/crash-detect.sh` inspects the test run artifacts and assigns an explicit, machine-readable classification:

```text
native_crash
rust_panic
swift_exception
objc_exception
javascript_exception
unhandled_rejection
startup_timeout
ui_hang
ipc_timeout
watchdog_termination
memory_pressure_or_oom
unexpected_process_exit
import_failure
state_corruption
unknown
```

### Classification Rules:

1. **`native_crash`**: An `.ips` crash report with Process `plethora-tauri` or `com.plethora.app` exists in `~/Library/Logs/DiagnosticReports/`, or exit code indicates SIGSEGV (139), SIGABRT (134), or SIGBUS (138).
2. **`rust_panic`**: `stderr.log` or `rust.log` contains `panicked at '` or `fatal runtime error`.
3. **`swift_exception` / `objc_exception`**: `unified.log` contains `*** Terminating app due to uncaught exception` or `Fatal error:`.
4. **`javascript_exception`**: `javascript-errors.log` contains entries from `window.onerror` or React `ErrorBoundary`.
5. **`unhandled_rejection`**: `javascript-errors.log` contains entries from `window.onunhandledrejection`.
6. **`startup_timeout`**: `data-plethora-ready` was not observed within the configured deadline (default: 30s).
7. **`ui_hang`**: Process is alive, but `data-plethora-heartbeat` did not change over a 5s window.
8. **`ipc_timeout`**: `ping_health` IPC command failed to respond within 5s.
9. **`watchdog_termination`**: OS 0x8badf00d ("ate bad food") report generated due to synchronous main-thread blocking during launch or backgrounding.
10. **`memory_pressure_or_oom`**: OS Jetsam report or system log containing `Memorystatus` / `exceeded memory limit`.

---

## 4. Artifact Storage and Evidence Schema

All run outputs are stored in `.test-artifacts/ios/<timestamp>-<run-id>/`:

```text
.test-artifacts/
  ios/
    2026-08-23T04-15-00-run-98412/
      metadata.json          # Environment, Git SHA, simulator UDID, config
      actions.json           # Step-by-step log of test actions executed
      stdout.log             # Simulator app stdout
      stderr.log             # Simulator app stderr
      simulator.log          # simctl lifecycle logs
      unified.log            # Filtered os_log stream (subsystem == com.plethora.app)
      javascript-errors.log  # Captured JS exceptions & unhandled rejections
      rust.log               # Rust tracing/log output
      screenshot.png         # Screenshot taken at completion or failure point
      crash.ips              # Extracted Apple crash log (if generated)
      test-result.json       # Structured test verdict & classification
```

### Schema of `test-result.json`:

```json
{
  "runId": "2026-08-23T04-15-00-run-98412",
  "timestamp": "2026-08-23T04:15:00.123Z",
  "status": "FAILED",
  "classification": "ui_hang",
  "exitCode": 1,
  "commit": "efe2ec6b09e80b73f8743dfcc192a6b2a70c312b",
  "branch": "main",
  "dirty": false,
  "buildProfile": "development",
  "simulator": {
    "udid": "7B6E2C91-...",
    "name": "iPhone 17 Pro",
    "runtime": "iOS 18.0"
  },
  "durationMs": 14250,
  "lastAction": "SWITCH_TAB_DOCUMENTS",
  "failureDetail": "Heartbeat probe stalled at value 42 for > 5000ms while switching tabs",
  "artifacts": {
    "screenshot": "screenshot.png",
    "unifiedLog": "unified.log",
    "jsErrors": "javascript-errors.log",
    "ips": null
  }
}
```

---

## 5. Automated Regression Bisecting Engine

To enable `git bisect run ./scripts/ios-test/bisect-smoke.sh`, the bisect script adheres to strict exit code semantics:

- **Exit Code `0` (Good)**: The commit built cleanly, booted in simulator, passed liveness oracle, navigated core tabs, terminated and relaunched without error.
- **Exit Code `1` (Bad)**: The commit built, but crashed, deadlocked, failed liveness, panicked, or produced an unhandled fatal error.
- **Exit Code `125` (Skip)**: The commit could not be tested (e.g., compile failure due to an unrelated broken dependency, commit predates iOS infrastructure, transient Vite port lock, or simulator boot timeout). Git bisect skips this revision without marking it good or bad.

---

## 6. Investigation Checklist for Recent Crash Areas

When a crash or hang is detected, the harness and investigation tooling reference this verified checklist of recent architectural changes:

1. **WRY Issue #1775 Workaround (`vendor/wry-0.55.1`)**:
   - Verify `callOnMainRunLoopAndWait` in `url_scheme_handler.rs` does not deadlock Tokio threads during rapid resource loading.
   - Verify async GCD dispatch for `did*` callbacks remains intact.
2. **Bootstrap Module Waterfall (`src/main-bootstrap.ts`)**:
   - Verify `installPromiseCompat` and `installUint8ArrayCompat` run prior to static bundle evaluation.
   - Verify dynamic `import("./main")` handles WebKit proxy chunk fetch stalls.
3. **StoreKit 2 Integration (`plethora-storekit`)**:
   - Verify StoreKit Swift symbols compile cleanly on iOS 15 deployment targets.
   - Verify StoreKit transaction updates channel listener does not panic when the app is backgrounded.
4. **Sherpa ONNX / TTS Engine (`src-tauri/src/tts/`)**:
   - Verify C-FFI `c_int` type aliases on `aarch64-apple-ios-sim`.
   - Verify TTS audio worker channels do not block Tokio blocking pool.
5. **Folder Import & File Picker (`FolderImportPlugin.swift`)**:
   - Verify `UIDocumentPickerViewController(forOpeningContentTypes:asCopy:)` is used instead of deprecated `init(documentTypes:in:)` which throws `NSInternalInconsistencyException`.
   - Verify security-scoped resource access is cleanly balanced with `stopAccessingSecurityScopedResource()`.
6. **Share Extension App Group Container (`plethora-share-extension`)**:
   - Verify `group.com.plethora.app.shared` App Group container lookup does not crash if entitlement is missing in simulator debug builds.
