# Delta: startup-animation-lifecycle

## ADDED Requirements

### Requirement: Readiness-driven startup lifecycle
The startup animation SHALL play while the application navigation shell is loading. When that shell can present usable controls, the covering layer and its input shield SHALL yield on the shell’s ready frame. The animation SHALL NOT initiate local data hydration or wait for it to finish.

#### Scenario: The navigation shell becomes ready
- **WHEN** the application navigation shell is ready while the launch animation is playing
- **THEN** the shell is visible and accepts pointer, touch, and supported keyboard input on its ready frame
- **AND** any part of the choreography that would obscure or block the shell is ended immediately

#### Scenario: The shell is already ready when the overlay would mount
- **WHEN** a launch prepares the navigation shell before the animation can mount
- **THEN** the animation does not cover the shell or delay input

### Requirement: Slow startup settles into a stable idle state
If application readiness has not arrived by the end of the canonical timeline, the animation SHALL transition to a stable idle state (mascot resting beside the completed knowledge structure with restrained breathing/blink micro-motion) and SHALL NOT replay the peck sequence or loop the full choreography. The idle state SHALL end on the shell’s ready frame.

#### Scenario: Shell preparation slower than the animation
- **WHEN** shell readiness arrives several seconds after the canonical timeline ends
- **THEN** the overlay holds the idle state without restarting the sequence, and upon readiness plays the resolve and reveal phases once

### Requirement: Startup errors are never concealed
A startup failure, including a pre-React failure, SHALL expose application recovery above any launch presentation. A watchdog SHALL force-exit the overlay after at most 15 seconds from mount regardless of any store state.

#### Scenario: Required local initialization fails
- **WHEN** local initialization fails after the shell is available
- **THEN** the visible shell exposes the startup recovery action

#### Scenario: Initialization hangs
- **WHEN** no readiness or error signal ever arrives
- **THEN** the watchdog exits the overlay at its deadline so the underlying application state (including any error UI) is exposed

### Requirement: Play exactly once per genuine application start
The branded startup animation SHALL play at most once per JavaScript runtime (module lifetime) and only for the main application route. It MUST NOT play for the `#/screenshot-overlay` or `#/auth/callback` routes, internal tab/route navigation, window focus changes, or mobile resume without an actual webview/runtime restart.

#### Scenario: Internal navigation does not replay
- **WHEN** the user switches tabs or navigates within the running application
- **THEN** the startup animation does not appear

#### Scenario: Mobile resume does not replay
- **WHEN** the mobile app returns from the background without the OS having restarted it
- **THEN** the startup animation does not appear, because the runtime guard persists in the live JavaScript context

#### Scenario: Genuine restart replays
- **WHEN** the application process/webview cold-starts or the main window performs a full document reload
- **THEN** the branded startup experience plays once

#### Scenario: Utility routes are excluded
- **WHEN** the initial hash routes to the screenshot overlay or auth callback
- **THEN** no branded animation is mounted and those routes keep the existing generic loading fallback

### Requirement: User kill switch
A user setting `interface.startupAnimationEnabled` (default `true`) SHALL disable the branded startup animation entirely. When disabled, the launch MUST NOT be delayed by this feature and the shell appears on its ready frame.

#### Scenario: Setting disabled
- **WHEN** the setting is `false` at launch
- **THEN** no branded choreography plays and the application is revealed as soon as it is ready, with no added fixed delay

### Requirement: Fully offline launch
The startup animation MUST be completely local: no network requests, remote assets, remote fonts, or API calls. It SHALL function identically with no connectivity.

#### Scenario: Offline launch
- **WHEN** the application launches with no network access
- **THEN** the branded launch experience renders and completes identically, using only bundled/inline assets (asserted by a static source check for external URL references)
