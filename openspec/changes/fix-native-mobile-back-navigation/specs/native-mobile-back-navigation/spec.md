## Purpose

Make Android system Back traverse Plethora application state safely through a bounded native/frontend contract, with intentional root backgrounding and lifecycle recovery.

## ADDED Requirements

### Requirement: Android system Back reaches application navigation once
The Android application SHALL consume system Back while determining an application destination and SHALL dispatch at most one logical application Back action for each committed OS input. Gesture navigation and three-button navigation SHALL use identical navigation policy. The application SHALL NOT use WebView URL history as workspace history or depend on JavaScript event cancellation to prevent Activity exit.

#### Scenario: Gesture navigation follows real visits
- **GIVEN** the user visited Dashboard, Queue, Document and Settings in that order
- **WHEN** a committed Android Back occurs from Settings menu with no overlay or unsaved guard
- **THEN** Document SHALL become active and the app SHALL remain foreground
- **AND** subsequent settled Back actions SHALL select Queue and Dashboard in order

#### Scenario: Three-button parity
- **WHEN** the same navigation sequence is traversed using Android's Back button
- **THEN** destinations, guards, overlays and root behavior SHALL match gesture navigation

#### Scenario: One gesture cannot navigate twice
- **WHEN** a committed OS Back produces duplicate delivery or overlaps a frontend touch sequence
- **THEN** at most one application transition SHALL occur
- **AND** no second transition SHALL be triggered by a fallback JavaScript recognizer

### Requirement: Native Back consumption is explicitly acknowledged
Each native Back request SHALL have a unique session-scoped identity. Only a current, valid request acknowledgment SHALL authorize a native root action. A pending confirmation or blocked action SHALL be acknowledged as consumed without waiting for a user decision. Unknown, stale, malformed and conflicting duplicate acknowledgments SHALL NOT background or terminate the application.

#### Scenario: Delayed root acknowledgment
- **WHEN** a root acknowledgment arrives after its request expired or a new session attached
- **THEN** it SHALL be ignored and the task SHALL remain foreground

#### Scenario: Confirmation remains pending
- **WHEN** Back opens an unsaved-change confirmation
- **THEN** the native request SHALL finish as consumed within its transport deadline
- **AND** waiting for the user's decision SHALL NOT permit Activity default Back

#### Scenario: Rapid committed inputs
- **WHEN** additional Back inputs arrive before the preceding request or transition settles
- **THEN** overlapping inputs SHALL be consumed without queued navigation
- **AND** later independent inputs after settlement SHALL traverse one destination each

### Requirement: Native root policy backgrounds safely
Only when overlays, active context, valid workspace history and safe Dashboard fallback are exhausted SHALL system Back background the Android task. The application SHALL preserve task state and SHALL NOT kill the process, finish the Activity deliberately, or treat transport failure as proof of root.

#### Scenario: Non-Dashboard initial view has no history
- **WHEN** Back occurs on an initial Document or Queue with no eligible history or context
- **THEN** Dashboard SHALL become active without adding a loop back to the source
- **AND** only a subsequent Back at exhausted Dashboard SHALL background the task

#### Scenario: Root Back and resume
- **GIVEN** Dashboard is active with no eligible overlay, context or history
- **WHEN** system Back commits
- **THEN** the task SHALL be backgrounded exactly once without process termination
- **AND** reopening SHALL retain workspace and reader/draft state according to existing persistence

#### Scenario: Root races an external open
- **WHEN** a new foreground activation or incoming external intent intervenes before root authorization completes
- **THEN** obsolete root authorization SHALL NOT background the new destination

### Requirement: Native bridge failure has bounded safe recovery
A native Back delivery SHALL terminate its transport transaction within 1500ms if it cannot obtain a valid acknowledgment. Startup SHALL consume Back without replaying it and offer recovery after a 5s foreground grace if still unready. Failure SHALL preserve application state and provide accessible native Retry connection, Stay and Background app choices; automatic replay or automatic exit is prohibited.

#### Scenario: Back during startup
- **WHEN** Back occurs before the frontend navigation session is ready
- **THEN** no crash, premature background, queued stale navigation or deadlock SHALL occur
- **AND** prolonged startup SHALL expose recovery choices

#### Scenario: Missing bridge or lost acknowledgment
- **WHEN** transport is unavailable, delayed beyond deadline or loses an acknowledgment
- **THEN** the request SHALL expire and recovery choices SHALL become available
- **AND** the application SHALL NOT assume the action failed to execute or replay it automatically

#### Scenario: Explicit background during recovery
- **WHEN** the user selects Background app in native recovery
- **THEN** the task SHALL background without terminating the process or discarding drafts deliberately

#### Scenario: Retry reconnects
- **WHEN** Retry establishes a fresh healthy session
- **THEN** future Back inputs SHALL function normally
- **AND** expired Back inputs SHALL NOT be replayed

### Requirement: Native lifecycle changes invalidate obsolete transport
Activity teardown, frontend replacement and suspension SHALL cancel obsolete native requests and clean up their timers/listeners. Resume SHALL establish a fresh session before navigation dispatch. Existing app state SHALL not be reset solely because the bridge reattaches.

#### Scenario: Background and resume with late messages
- **WHEN** the app resumes after an in-flight request was suspended
- **THEN** messages from the old session SHALL NOT navigate or background the resumed app
- **AND** one new session and one effective native callback SHALL handle subsequent Back

#### Scenario: Activity or process restoration
- **WHEN** Activity recreation or process restoration creates a new host
- **THEN** no old request identity or callback SHALL survive as an actionable request
- **AND** restored workspace history SHALL follow its own validated restoration contract

### Requirement: Predictive Back supports safe cancellation and commit
On supported Android versions, predictive Back SHALL use the supported native dispatch path. Gesture start/progress/cancellation SHALL NOT navigate or produce navigation haptics; commit SHALL produce at most one application action. The always-intercepted root policy SHALL disclose that full OS back-to-home/cross-task preview is not provided by this change.

#### Scenario: Cancel predictive gesture
- **WHEN** a predictive Back gesture is started and cancelled on Android 13 or later
- **THEN** tabs, hierarchy, overlays, history and drafts SHALL remain unchanged

#### Scenario: Commit on API 36
- **WHEN** predictive Back commits on a build targeting API 36
- **THEN** the application SHALL apply its Back policy once without relying on deprecated key/Activity interception

### Requirement: Native navigation respects trusted application ownership
Native root actions SHALL accept authorization only from the attached trusted application session. Remote content, screenshot overlays and arbitrary DOM events SHALL NOT gain permission to background the application.

#### Scenario: Forged request
- **WHEN** an untrusted surface submits an acknowledgment or a DOM event resembling native Back
- **THEN** the native root action SHALL be denied
