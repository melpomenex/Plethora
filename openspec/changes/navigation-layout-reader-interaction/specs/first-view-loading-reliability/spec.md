## ADDED Requirements

### Requirement: Any view renders reliably on first open after startup
The system SHALL render any lazy tab/view correctly the first time the user opens it during the current application session, on both cold application startup and warm state. First navigation SHALL NOT require the user to click away, re-enter, remount, or refresh. Cached/repeated navigation may remain faster, but first navigation must complete normally.

#### Scenario: Cold start — first visit to Settings
- **WHEN** the user launches Plethora (cold start) and navigates to Settings as the first view
- **THEN** Settings SHALL complete its lazy chunk load, hydration, and data fetch and SHALL render its content without the user navigating away and back

#### Scenario: Cold start — first visit to a lazy queue/document view
- **WHEN** the user launches Plethora and opens a previously-unopened view (e.g. Queue, Documents, a document viewer tab)
- **THEN** the view SHALL render on the first open without an indefinite spinner

#### Scenario: Warm start — repeat navigation stays fast
- **WHEN** the user opens a view a second time in the same session
- **THEN** the view SHALL render at least as fast as before, and the first-open reliability SHALL be preserved

### Requirement: First-open stalls are fixed at the root cause
The implementation SHALL locate and fix the actual reason first-time navigation can fail to complete (lazy-chunk fetch stalls, initialization promises, store hydration/race conditions, startup-snapshot dead promises, cache population, missed state updates, or swallowed async errors) rather than hiding the spinner or shortening a timeout. Existing mitigations (`importWithRetry`, `startupStore` watchdog, `loadTabs` guard, collection-hydration race fixes, queue claim-after-success) SHALL be retained and audited for remaining gaps.

#### Scenario: A stalled lazy chunk no longer blocks the view
- **WHEN** a lazy tab chunk fails or stalls during first fetch
- **THEN** the retry/timeout mechanism SHALL recover (retry and/or fall back) so the view renders without requiring the user to reopen it

#### Scenario: Startup snapshot failure does not wedge first views
- **WHEN** the startup snapshot request times out or fails
- **THEN** the system SHALL free the in-flight slot and fall back to legacy loads so first views still load (no dead promise shared across views)

### Requirement: First-view navigation latency is instrumented for development
The system SHALL add development-only diagnostics/tests capable of detecting regressions in first-view navigation latency, covering both cold application startup and warm application state. These SHALL NOT produce noisy production logging.

#### Scenario: Regression test catches a first-open stall
- **WHEN** a test exercises opening a lazy view for the first time (cold and warm) with a stubbed/slow chunk or store
- **THEN** the test SHALL fail if the view fails to render within the expected bound without a navigation-away-and-back

#### Scenario: Diagnostics are dev-only
- **WHEN** the application runs in production
- **THEN** the first-view diagnostic instrumentation SHALL NOT produce log noise (instrumentation gated to development builds or opt-in debugging)