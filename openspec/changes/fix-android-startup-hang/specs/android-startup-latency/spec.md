## Purpose

Ensure Android launches reach a usable local screen promptly, expose bounded recovery when startup stalls, and provide diagnostic evidence that separates native initialization from frontend and bridge delays.

## ADDED Requirements

### Requirement: Android startup has one automatic completion deadline

Android automatic startup SHALL share a deadline of 15 seconds measured from frontend bootstrap entry. Main application loading, native readiness checks, local-data requests, retry backoff, and startup presentation SHALL consume that same deadline without extending or restarting it. Successful startup SHALL end the startup deadline so it does not limit later ordinary application operations.

#### Scenario: Native readiness never responds

- **WHEN** an Android launch receives no completion from the native readiness checks
- **THEN** automatic startup stops scheduling retries and presents a recoverable failure within 15 seconds of bootstrap entry
- **AND** concurrent startup callers receive the same terminal outcome without starting independent retry cycles

#### Scenario: A local-data request stalls after readiness

- **WHEN** native readiness completes after part of the startup budget has elapsed and the initial local-data response stalls
- **THEN** data attempts and backoff use only the remaining startup budget
- **AND** the total automatic wait does not exceed the original deadline

#### Scenario: Main application loading never settles

- **WHEN** Android bootstrap has rendered but the main application has not finished loading by the shared deadline
- **THEN** the available bootstrap surface presents a visible failure and reload control
- **AND** a permanently loading placeholder does not remain the only available action

#### Scenario: Startup has already completed

- **WHEN** an Android user invokes an ordinary feature after successful startup
- **THEN** expiry of the earlier startup deadline does not reject that operation

### Requirement: Startup recovery remains visible and usable

On deadline expiry or terminal startup failure, Android SHALL expose a recovery surface with an explicit retry or reload action without waiting for another native response. Startup presentation SHALL NOT obstruct this recovery surface. An explicit retry SHALL start one fresh shared automatic budget; concurrent callers SHALL join it. Expired or superseded launch results SHALL NOT replace the active collection, overwrite a newer result, or conceal the current recovery state.

#### Scenario: Startup presentation is still visible when the deadline expires

- **WHEN** automatic startup reaches its deadline while a loading overlay is displayed
- **THEN** the overlay stops blocking interaction and the recovery controls become usable by that deadline

#### Scenario: The user retries after the backend recovers

- **WHEN** the user explicitly retries a failed Android launch and native readiness and local-data requests now succeed
- **THEN** one new startup sequence loads the current collection and reveals its usable local screen
- **AND** old pending responses cannot override that sequence

#### Scenario: A previous request responds after a collection change

- **WHEN** a response from an expired launch arrives after the active collection or startup sequence has changed
- **THEN** the response is ignored for current presentation and hydration
- **AND** data already available for the current collection remains intact

### Requirement: Local startup does not depend on optional integrations

Android SHALL reach its first usable local screen without requiring completion of optional account, billing, remote-provider, logging-forwarding, haptics, enrichment, or background integration initialization. Automatic optional initialization SHALL begin only after successful local startup, occur once per live application runtime, and remain responsive to user input. Explicit user actions and incoming external intents SHALL retain supported initialization or queuing behavior for their required features.

#### Scenario: Optional services are unavailable during offline launch

- **WHEN** Android starts with local data and configured optional services are unreachable
- **THEN** the local screen completes startup without waiting for those services
- **AND** later optional failures do not clear local data or restart startup

#### Scenario: Automatic startup fails before local data is usable

- **WHEN** Android startup enters a recoverable failure before the first usable local screen
- **THEN** automatic optional initialization remains deferred
- **AND** a later successful explicit retry admits that initialization once

#### Scenario: An external share arrives during startup

- **WHEN** a supported share or deep-link intent arrives before its required native and local state is ready
- **THEN** the intent is retained and handled after that state becomes ready
- **AND** deferring optional initialization does not silently discard the intent

### Requirement: Startup diagnostics survive a stalled native bridge

Android startup diagnostics SHALL identify a launch and distinguish activity/native setup, frontend loading and paint, command dispatch/handler entry/response delivery, local-data hydration, and usable-screen presentation using elapsed timings and outcomes. Frontend startup markers SHALL remain observable when native command transport does not respond. Diagnostics SHALL be bounded and SHALL NOT include document titles, content, identifiers, credentials, or command arguments, nor create recursive logging traffic.

#### Scenario: The backend is ready but a response is delayed

- **WHEN** native setup completes and a startup command's response does not reach the frontend promptly
- **THEN** diagnostics distinguish completed native setup from the outstanding command transport boundary
- **AND** frontend timeout/recovery markers remain observable without successful native forwarding

#### Scenario: Many startup warnings occur during a bridge failure

- **WHEN** startup generates repeated transport warnings while native forwarding is unavailable
- **THEN** diagnostics retain a bounded record of allowed timing, count, phase, and outcome fields
- **AND** warnings do not cause unbounded forwarding requests or expose user content

### Requirement: Android local startup meets a release performance target

On the reference Pixel 9 Pro XL, a release build with remote WebView debugging disabled and an already-migrated local fixture of approximately 1,000 documents and 5,000 learning items SHALL reach the first usable local screen within five seconds at p95 over at least 20 process-cold launches. The endpoint SHALL require current local data or a confirmed empty result on the visible screen, a committed frame, and usable input after blocking startup presentation ends. The measurement SHALL report build/device/WebView identity, every sample, median, p95, and startup request counts; activity-start timing alone SHALL NOT count as success.

#### Scenario: Populated local fixture launches offline

- **WHEN** the release performance harness runs at least 20 offline process-cold launches on the reference device with the populated fixture
- **THEN** p95 time from activity creation to the first usable local screen is at most five seconds
- **AND** phase timings and request counts demonstrate that the former long bridge wait is absent

#### Scenario: Startup animation and unavailable integrations are exercised

- **WHEN** reference launch runs include animation enabled and disabled, plus configured optional integrations whose services are unavailable
- **THEN** each measured configuration satisfies the same usable-local-screen target
- **AND** a painted loading placeholder or completed activity launch cannot prematurely stop the measurement

### Requirement: Startup acceleration preserves native initialization safety

Android database-dependent commands SHALL remain gated until database integrity handling, migrations, and required command state initialization have completed. Reaching the frontend startup deadline SHALL NOT cancel database migrations, declare the backend ready early, or modify stored user data to achieve the timing target. Existing loading, successful-empty, populated, and recoverable-failure semantics SHALL remain distinct.

#### Scenario: A required migration exceeds the automatic budget

- **WHEN** a required database migration is still running when the Android startup deadline expires
- **THEN** the frontend exposes recovery while the native migration continues safely
- **AND** no database-dependent read is permitted before initialization actually completes

#### Scenario: Startup completes with an empty database

- **WHEN** safe native initialization and the initial local-data request complete successfully with no items
- **THEN** the visible screen shows the confirmed empty state and counts as completed local startup
- **AND** it does not begin retries intended for a transport or initialization failure
