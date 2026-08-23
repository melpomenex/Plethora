## Why

While Plethora has extensive Vitest and Playwright test suites, those tests run exclusively inside desktop Node.js or Chromium headless browser environments. They do **not** exercise:
- The actual Tauri iOS runtime and native WKWebView.
- Real native IPC message serialization and deserialization.
- Swift-based iOS plugins (`FolderImportPlugin.swift`, `plethora-storekit`, `sherpa-onnx` TTS).
- Native iOS application lifecycle events (cold launch, warm launch, backgrounding, foregrounding, termination, memory warnings).
- The native iOS Share Extension App Group handoff.
- The iOS document picker or Files system integration.

Consequently, native iOS regressions (such as WKWebView initialization deadlocks, Swift plugin exceptions, or Share Extension staging failures) can escape to manual QA completely undetected by browser tests.

We need real, automated, native iOS simulator end-to-end testing that drives the compiled iOS application on the iPhone Simulator, verifies high-value user workflows deterministically, captures rich visual and log artifacts on failure, and establishes a clear boundary between simulator-verifiable flows and physical-device requirements.

## What Changes

- **Test Framework Selection & Architecture**:
  - Adopt **Maestro** as the primary declarative E2E flow runner for native iOS simulator testing, complemented by `xcrun simctl` CLI helpers for system-level lifecycle and container management.
  - Create the E2E test runner script `scripts/ios-test/e2e.sh` (`npm run test:ios:e2e`).
- **Core Simulator E2E Test Flows** (`tests/ios/flows/`):
  1. `startup_and_navigation.yaml`: Launch app, verify shell readiness, traverse primary tabs (Dashboard, Documents, Queue, Review, Settings), terminate process, cold relaunch, and verify state restoration.
  2. `document_import_and_read.yaml`: Import representative PDF, EPUB, and Markdown fixtures, observe import progress toasts, verify documents appear in the library, open in Reader, scroll/navigate pages, background and foreground app, close, and verify reading position persistence.
  3. `navigation_stress.yaml`: Rapidly alternate between heavy views to stress-test React Query cache invalidation and Zustand state synchronization under native rendering constraints.
  4. `reader_lifecycle.yaml`: Exercise reader position bookmarking, extract creation, font resizing, and theme toggling across application relaunch.
- **Native Share Extension Integration Tests**:
  - Implement automated tests for the iOS Share Extension data contract: inject `.ready` share manifests and files into the App Group container (`group.com.plethora.app.shared`), launch Plethora, verify atomic claim (`.claiming`), ingestion, deduplication, and completion (`.completed`).
- **Simulator Test Fixture Injection**:
  - Provide fast direct staging via `xcrun simctl get_app_container` for rapid regression runs, and system Files-app interaction for complete end-to-end picker validation.
- **Stable Accessibility Identifiers**:
  - Audit and annotate critical React UI components with stable `data-testid` and `accessibilityIdentifier` attributes to prevent test selector fragility.
- **Real-Device Boundary Specification**:
  - Explicitly document which behaviors are validated in Simulator vs what remains gated on physical hardware (StoreKit sandbox purchases, hardware thermal throttling, lock-screen media integration, real Bluetooth audio).

## Capabilities

### New Capabilities

- `native-ios-simulator-e2e`: Declarative, deterministic native iOS simulator end-to-end test suite covering startup, navigation, document ingestion, reading, lifecycle transitions, and share extension workflows.

### Modified Capabilities

None.

## Impact

- New directories and test flows:
  - `tests/ios/flows/*.yaml`
  - `tests/ios/fixtures/`
  - `scripts/ios-test/e2e.sh`
  - `scripts/ios-test/inject-share.sh`
- New NPM scripts in `package.json`:
  - `test:ios:e2e`
  - `test:ios:flows`
- Frontend UI annotations:
  - Add stable `data-testid` / `accessibilityIdentifier` properties to `MobileNavigation.tsx`, `DocumentsPage.tsx`, `ReaderView.tsx`, `QueueTab.tsx`, `SettingsPage.tsx`, and import dialog components.
- Documentation:
  - `docs/testing/ios-e2e.md`
  - `docs/testing/ios-device-boundary.md`

**Owns:** Maestro test flows, iOS E2E runner scripts, fixture injection utilities, accessibility test IDs on UI components.  
**Must NOT change:** Production business logic, native plugin interfaces, database schemas.

## Dependencies

- **Hard:** Depends on Proposal 1 (`establish-ios-reliability-harness-and-crash-observability`) for simulator provisioning and artifact harvesting.
- **Soft:** Consumes hardened import commands from Proposal 2 (`harden-document-import-pipeline`).

## Parallelization Notes

Can be implemented in Wave 2 (after Proposal 1 lands the simulator harness and Proposal 2 consolidates the canonical import pipeline). Flow authoring and accessibility ID tagging can begin immediately in Wave 1.

## Migration / Backward Compatibility

Additive only. Maestro flows run against standard debug/development iOS Simulator builds.

## Risks

- Flaky UI animations: Mitigated by Maestro's built-in element wait conditions and explicit accessibility IDs rather than coordinate-based taps.
