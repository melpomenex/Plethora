## ADDED Requirements

### Requirement: Low-confidence static results trigger rendered-page fallback
When the best static candidate's confidence is low, the candidate word count is below the configured minimum, no candidate was produced, or sanitization proved degenerate, the pipeline SHALL attempt a rendered-DOM capture (subject to platform availability) instead of accepting the static result.

#### Scenario: JavaScript-rendered article
- **WHEN** a page's static HTML contains only an app shell with no article content
- **THEN** the pipeline performs a rendered-page capture and re-runs extraction on the rendered DOM

#### Scenario: Fallback is not the default
- **WHEN** static extraction yields medium or high confidence
- **THEN** no rendered WebView is created and the import completes on the static path

### Requirement: Rendered extraction re-runs semantic extraction and scoring
After a rendered DOM is captured, the pipeline SHALL re-run both extraction engines against it and SHALL select the overall winner purely by score, with rendered candidates competing against the static candidates rather than winning automatically.

#### Scenario: Rendered candidate must still earn selection
- **WHEN** the rendered DOM produces a candidate that scores below the best static candidate
- **THEN** the static candidate is selected

### Requirement: DOM stability detection without arbitrary sleeps
The rendered capture SHALL wait for page readiness and DOM stability using document readiness state plus sampled DOM mutation signals (stability sustained for a configured window), bounded by a maximum stabilization time, and SHALL NOT rely on fixed long sleeps.

#### Scenario: Hydration completes before capture
- **WHEN** a client-rendered page finishes hydrating after load
- **THEN** the capture waits until the DOM stops mutating for the stability window before extraction runs

#### Scenario: Slow page bounded
- **WHEN** a page keeps mutating past the stabilization cap
- **THEN** the capture proceeds with the current DOM or fails within the overall time budget rather than waiting indefinitely

### Requirement: Timeouts, cancellation, and error handling
The rendered fallback SHALL enforce an overall time budget, SHALL abort on navigation errors and redirect loops, and SHALL be cancellable through the pipeline's abort signal when the user leaves the import, the app is backgrounded, or another import supersedes it.

#### Scenario: User cancels during fallback
- **WHEN** the import is cancelled while the rendered capture is loading
- **THEN** the capture aborts, no document is created, and no capture WebView remains

#### Scenario: Timeout
- **WHEN** the rendered capture exceeds the overall budget
- **THEN** the import fails with `rendered_failed` and the capture resources are released

### Requirement: Capture resource cleanup
Every rendered capture SHALL destroy its WebView/window in a guaranteed cleanup path regardless of success, failure, timeout, or cancellation, and concurrent imports SHALL NOT leak multiple simultaneous capture WebViews beyond the configured single-flight limit.

#### Scenario: Cleanup after failure
- **WHEN** a rendered capture fails mid-load
- **THEN** the offscreen WebView (Android) or hidden window (desktop) is destroyed before the pipeline resolves

### Requirement: Platform capture matrix and graceful degradation
Android SHALL capture via an offscreen native WebView without Tauri IPC exposure; desktop SHALL capture via a hidden Tauri WebviewWindow whose label matches no capability (zero granted permissions); PWA SHALL attempt a hidden iframe best-effort; any platform MAY report capture unavailability, which degrades to the typed `rendered_unavailable` failure/UX path rather than an error.

#### Scenario: Android offscreen WebView is IPC-less
- **WHEN** the Android capture WebView loads remote content
- **THEN** the loaded page has no access to Incrementum's Tauri bridge or commands

#### Scenario: Desktop capture window is capability-free
- **WHEN** a hidden capture window is created on desktop
- **THEN** no capability in the app's capability files matches the capture window label, and the loaded page cannot invoke Tauri APIs

#### Scenario: PWA iframe blocked
- **WHEN** a site refuses framing via X-Frame-Options/CSP in PWA mode
- **THEN** the pipeline reports `rendered_unavailable` and offers the failure UX instead of hanging
