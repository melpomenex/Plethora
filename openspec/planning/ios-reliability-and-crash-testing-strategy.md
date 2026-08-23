# iOS Reliability, Document Import Hardening, and Automated Crash-Testing Strategy

**Document Status:** Approved Architecture Plan  
**Target Platform:** Mac mini with Xcode 15/16 and iOS Simulator (iPhone 17 Pro)  
**Objective:** Eliminate iOS startup crashes, prevent document import failures, harden state recovery, and establish an automated, unattended reliability fuzzing and chaos test infrastructure.

---

## 1. Overview of Coordinated OpenSpec Proposals

Rather than a single monolithic change, the reliability overhaul is partitioned into **four coordinated, independently-executable OpenSpec proposals**:

| Proposal Directory | Capability | Primary Focus | Wave |
|---|---|---|---|
| [`establish-ios-reliability-harness-and-crash-observability`](../changes/establish-ios-reliability-harness-and-crash-observability) | `ios-reliability-harness` | Deterministic simulator smoke harness, liveness oracle, crash artifact harvesting, failure classification, git bisect | **Wave 1** |
| [`harden-document-import-pipeline`](../changes/harden-document-import-pipeline) | `document-import-pipeline` | Canonical backend import pipeline (`import_from_path`), bounded chunked staging, typed import errors, transactional SQLite persistence, orphan cleanup | **Wave 1** |
| [`implement-native-ios-simulator-e2e-automation`](../changes/implement-native-ios-simulator-e2e-automation) | `native-ios-simulator-e2e` | Maestro E2E test flows, accessibility test ID annotations, fixture injection, share extension simulator testing, reader persistence | **Wave 2** |
| [`implement-reliability-fuzzing-and-ui-chaos-testing`](../changes/implement-reliability-fuzzing-and-ui-chaos-testing) | `reliability-fuzzing-and-chaos-testing` | Pure Rust parser fuzzing (`cargo-fuzz`), state-aware seeded UI monkey tester, chaos fault injection, deadlock stack sampling, nightly unattended Mac mini automation | **Wave 3** |

---

## 2. Dependency Graph & Wave Parallelization Strategy

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Wave 1: Foundation & Backend Hardening (Parallel Execution)                 │
│                                                                             │
│  ┌────────────────────────────────────────┐  ┌───────────────────────────┐  │
│  │ Proposal 1: Simulator Smoke Harness &  │  │ Proposal 2: Canonical     │  │
│  │ Crash Observability                    │  │ Document Import Hardening │  │
│  │ (scripts/ios-test/ + DOM telemetry)    │  │ (src-tauri/ + store/api)  │  │
│  └───────────────────┬────────────────────┘  └─────────────┬─────────────┘  │
│                      │                                     │                │
└──────────────────────┼─────────────────────────────────────┼────────────────┘
                       │                                     │
                       ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Wave 2: Native E2E Automation                                               │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Proposal 3: Native iOS Simulator E2E Automation (Maestro Flows)       │  │
│  │ (tests/ios/flows/ + accessibility test IDs + share extension tests)   │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Wave 3: Reliability Fuzzing, Chaos, and Nightly Mac mini Automation         │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Proposal 4: Reliability Fuzzing, UI Monkey, Chaos, and Nightly        │  │
│  │ (cargo-fuzz targets + monkey.mjs + deadlock sampling + nightly cron)  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Shared File Ownership and Collision Avoidance Matrix

To allow distinct coding agents to implement these proposals in parallel without git merge conflicts, strict file ownership boundaries are established:

| File / Subsystem | Primary Owner | Secondary Access / Read-Only | Notes |
|---|---|---|---|
| `scripts/ios-test/setup.sh`, `bootstrap.sh`, `smoke.sh`, `collect-logs.sh`, `crash-detect.sh`, `bisect-smoke.sh` | **Proposal 1** | Proposals 3 & 4 consume via CLI execution | Owned exclusively by Proposal 1 |
| `src-tauri/src/commands/document.rs`, `src-tauri/src/processor/**` | **Proposal 2** | Proposals 1, 3, 4 consume commands via IPC | Proposal 2 refactors the canonical import pipeline |
| `src/api/documents.ts`, `src/stores/documentStore.ts` | **Proposal 2** | Proposals 3 & 4 consume APIs | Proposal 2 owns state machine & error types |
| `tests/ios/flows/**`, `scripts/ios-test/e2e.sh`, `inject-fixture.sh` | **Proposal 3** | Proposal 4 consumes as regression flows | Owned exclusively by Proposal 3 |
| `src/components/navigation/MobileNavigation.tsx`, `DocumentsPage.tsx`, `ReaderView.tsx` | **Proposal 3** | Others read-only | Proposal 3 adds `data-testid` attributes only |
| `src-tauri/fuzz/**`, `src-tauri/tests/fixtures/regression/**` | **Proposal 4** | Others read-only | Pure Rust fuzzing and regression inputs |
| `scripts/ios-test/monkey.mjs`, `chaos-scenarios.sh`, `nightly.sh`, `sample-hang.sh` | **Proposal 4** | Runs across all subsystems | Owned exclusively by Proposal 4 |
| `src/main-bootstrap.ts`, `src/main.tsx` | **Proposal 1** | Proposal 3 reads test IDs | Additive DOM status markers only |
| `package.json` scripts | Shared via additive lines | Additive only | Each proposal appends its unique script names |

---

## 4. Developer Workflow and Envisioned Command Reference

A developer or coding agent on the Mac mini will interact with the system using these standardized npm commands:

```bash
# 1. Environment Verification & Prerequisite Setup
npm run test:ios:setup

# 2. Fast Deterministic Simulator Smoke Test (Build, Install, Launch, Navigate, Relaunch)
npm run test:ios:smoke

# 3. Import Robustness Test Suite (Runs all malformed & edge-case fixtures)
npm run test:ios:imports

# 4. Native E2E Test Suite (Maestro declarative flows on Simulator)
npm run test:ios:e2e

# 5. Seeded UI Monkey Chaos Test (Deterministic 300-step semantic random actions)
npm run test:ios:monkey -- --steps 300

# 6. Reproduce a Specific Monkey Test Failure by Seed
npm run test:ios:monkey -- --seed 8417294 --steps 500

# 7. Pure Rust Parser Ingestion Fuzzing (Bounded 5-minute campaign)
npm run test:fuzz:imports -- --seconds 300

# 8. Automated Regression Bisecting (Find the commit that broke iOS)
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
git bisect run npm run test:ios:bisect

# 9. Full Nightly Test Matrix (Runs unattended on Mac mini)
npm run test:ios:nightly
```

---

## 5. Investigation Checklist for Recent iOS Crash-Risk Areas

When investigating recent iOS crashes on the repository, consult this prioritized checklist:

1. **WRY Issue #1775 Deadlock (`vendor/wry-0.55.1`)**:
   - *Symptom:* App process remains alive, but UI freezes during startup module waterfall.
   - *Cause:* `WKURLSchemeTask` synchronous `callOnMainRunLoopAndWait` deadlocks Tokio worker threads when handling proxy requests.
   - *Resolution:* Verify the async GCD dispatch patch in `vendor/wry-0.55.1/src/wkwebview/class/url_scheme_handler.rs` is applied.
2. **Whole-File JSON IPC OOM (`import_document_from_bytes`)**:
   - *Symptom:* Process suddenly killed by iOS Jetsam when importing files > 15 MB.
   - *Cause:* Converting `Uint8Array` to JSON number arrays (`Array.from(bytes)`) bloats memory by 6–8x in WebKit.
   - *Resolution:* Use bounded 256 KB chunked staging or native file copy (`FolderImportPlugin`).
3. **UIDocumentPicker `NSInternalInconsistencyException`**:
   - *Symptom:* Native crash upon opening folder or file picker.
   - *Cause:* Calling deprecated `UIDocumentPickerViewController(documentTypes:in:)` with folder types throws an uncatchable ObjC exception.
   - *Resolution:* Use modern `UIDocumentPickerViewController(forOpeningContentTypes:asCopy:)` (iOS 14+).
4. **Sherpa TTS C-FFI Type Mismatch**:
   - *Symptom:* SIGSEGV during TTS engine initialization on `aarch64-apple-ios-sim`.
   - *Cause:* Missing `c_int` type alias in `std::os::raw` on iOS simulator targets.
   - *Resolution:* Verify `sherpa_ffi.rs` uses `std::os::raw::c_int`.
5. **Share Extension App Group Entitlement Mismatch**:
   - *Symptom:* Share extension crashes or hangs when writing to shared storage.
   - *Cause:* Missing `group.com.plethora.app.shared` entitlement in simulator debug builds.
   - *Resolution:* Verify `apply-ios-project-overrides.js` injects the App Group entitlement into both the main app and extension plists.
6. **StoreKit 2 Plugin iOS 15 Floor**:
   - *Symptom:* Dynamic linker symbol failure on iOS 15 runtimes.
   - *Cause:* Calling StoreKit 2 APIs without `#available(iOS 15.0, *)` guards.
   - *Resolution:* Verify `plethora-storekit` has deployment target >= 15.0.

---

## 6. Real-Device vs Simulator Boundary

```text
┌─────────────────────────────────────────────────────────────┐
│              Verified by Simulator Automation               │
│                                                             │
│  • WKWebView rendering & CSS layout                         │
│  • React event loop & Zustand state synchronization         │
│  • Full SQLite database queries & migration integrity       │
│  • Bounded chunked staging memory behavior                  │
│  • Share Extension App Group handoff contract               │
│  • Swift plugin compilation & basic IPC roundtrips          │
│  • Reader position saving across app relaunch               │
│  • Parser resilience across malformed file inputs           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Mandatory Physical Device Gate (TestFlight)        │
│                                                             │
│  • Live StoreKit 2 App Store Sandbox purchases & renewals   │
│  • Camera & hardware scanner performance                    │
│  • Physical device thermal throttling & memory constraints  │
│  • OS Jetsam memory termination under physical RAM limits   │
│  • Lock-screen Now Playing controls & background audio      │
│  • Bluetooth headphone disconnection handling               │
│  • Real Files app third-party provider integrations         │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Next Steps & Execution Recommendations

1. **Implement Proposal 1 & Proposal 2 in Parallel (Wave 1)**:
   - Agent 1 builds the deterministic simulator smoke runner (`scripts/ios-test/smoke.sh`) and crash artifact harvester.
   - Agent 2 refactors the canonical import pipeline (`import_from_path`) and creates the malformed fixture corpus.
2. **Implement Proposal 3 (Wave 2)**:
   - Wire Maestro E2E test flows and accessibility identifiers once the smoke harness is operational.
3. **Implement Proposal 4 (Wave 3)**:
   - Deploy pure Rust parser fuzzing and the state-aware UI monkey tester, configuring nightly unattended execution on the Mac mini.
