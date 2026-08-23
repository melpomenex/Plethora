## ADDED Requirements

### Requirement: Native iOS Simulator End-to-End Test Execution SHALL be automated
The repository SHALL provide an automated E2E test command (`npm run test:ios:e2e` / `scripts/ios-test/e2e.sh`) using Maestro and `xcrun simctl` to drive the compiled iOS application on the configured iOS Simulator without requiring manual touch interaction.

#### Scenario: Full E2E flow execution passes
- **WHEN** `npm run test:ios:e2e` is executed
- **THEN** Maestro executes all declarative test flows in `tests/ios/flows/` against the iOS Simulator, verifies element accessibility IDs, and reports a passing suite verdict

### Requirement: Core User Workflows SHALL be exercised on Real Simulator Runtime
The E2E test suite SHALL verify startup, tab navigation, document ingestion, reading view rendering, reading position persistence across process termination, and share extension App Group handoffs on the iOS Simulator.

#### Scenario: Document imported, read, and persisted across app kill
- **WHEN** an EPUB fixture is injected and imported via the UI
- **THEN** the document appears in the library, opens in the reader, scrolls, retains position when the app process is terminated and relaunched, and renders without visual anomalies

#### Scenario: App Group share extension handoff processed on launch
- **WHEN** a share manifest is written to the App Group container `group.com.plethora.app.shared/shares/.ready/` while Plethora is terminated
- **THEN** launching Plethora automatically claims the share, imports the content into the library, and marks the manifest as completed

### Requirement: Interactive Elements SHALL provide Stable Accessibility Identifiers
Interactive elements across primary surfaces (navigation bar, toolbar buttons, document cards, reader viewport, dialog buttons) SHALL expose stable `data-testid` attributes that map directly to native accessibility identifiers in WKWebView.

#### Scenario: UI selectors do not break on text or style changes
- **WHEN** UI text translations or CSS styles change
- **THEN** Maestro tests querying by `id` (e.g. `nav-tab-documents`, `btn-import-document`) continue to resolve elements deterministically
