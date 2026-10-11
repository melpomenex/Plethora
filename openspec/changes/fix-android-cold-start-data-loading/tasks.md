## 1. Diagnose Android Cold Start

- [x] 1.1 Trace native readiness, startup snapshot dispatch/settlement, store hydration, and first visible items on Android cold launch and resume; verify the trace distinguishes success-with-zero-items from timeout, transport failure, and database error without recording user content.
- [x] 1.2 Add a deterministic delayed/failing startup fixture for populated and empty databases; verify it can reproduce delayed readiness, dropped/timed-out attempts, and eventual recovery without device timing dependencies.

## 2. Coordinate Startup Recovery

- [x] 2.1 Implement one Android startup retry policy keyed by active collection and visible surface, with bounded exponential backoff and a recoverable terminal error; verify coordinator tests cover attempt limits, caller deduplication, and explicit retry.
- [x] 2.2 Track request generations and collection ids so late results cannot overwrite a newer attempt or active collection; verify tests cover late success, collection switching, and stale failure.
- [x] 2.3 Replace component-owned mobile retry timers with the shared coordinator policy; verify active Android surfaces do not issue duplicate startup requests when the shell, overlay, and view request readiness together.
- [x] 2.4 Preserve the backend-ready, integrity, and migration gates while integrating the retry flow; verify native command tests prove reads still wait for completed database initialization.

## 3. Make Mobile Data States Accurate

- [x] 3.1 Gate Android library and queue empty states on successful completion for the active collection; verify component tests show loading before completion, items after populated success, and empty state only after successful zero-item results.
- [x] 3.2 Preserve already-loaded items during pending or failed refreshes and expose a retry action after the automatic budget is exhausted; verify store/component tests cover both behaviors.
- [x] 3.3 Ensure eventual successful startup hydrates the active surface without navigation or relaunch; verify an end-to-end startup test advances a delayed populated response and observes the items on the original surface.

## 4. Android Regression Verification

- [x] 4.1 Run targeted frontend startup/store/component tests and native startup command tests; verify they pass for delayed readiness, transport failure, empty databases, populated databases, collection changes, and retries.
- [ ] 4.2 Build and cold-launch the Android app with populated and empty local databases on standard Android and GrapheneOS; verify populated data appears without view changes, confirmed empty databases show the empty state, and failed loads remain recoverable.
- [ ] 4.3 Capture startup phase durations and request counts from the device runs; verify there is no content in diagnostics, retry count stays within the configured bound, and the report identifies the slow or failed phase.
