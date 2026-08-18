# Delta: startup-animation-lifecycle

## ADDED Requirements

### Requirement: Readiness-driven startup lifecycle
The startup animation SHALL be governed by an explicit state machine whose progression to the application is coordinated with real application readiness — the conjunction of startup data readiness (`useStartupStore.ensureStartup` reaching `ready`, which transitively implies the Rust backend-ready gate) and the main route having painted at least one frame. The lifecycle SHALL NOT depend on a fixed wall-clock delay to hide or show the application.

#### Scenario: Normal cold startup
- **WHEN** the application launches and both readiness flags become true after the canonical choreography has begun
- **THEN** the state machine plays the choreography through consolidation, resolves into the Plethora mark, and crossfades to reveal the already-rendered application UI beneath the overlay

#### Scenario: Readiness coordinates real initialization
- **WHEN** the overlay mounts on the main route
- **THEN** it initiates or joins the deduplicated startup snapshot hydration and tracks its status, and it treats the main layout's first painted frame as the route-ready signal; no other condition (network, noncritical deferred tasks) delays the reveal

### Requirement: Fast startup still plays the full metaphor without blocking
When application readiness arrives before the canonical choreography has completed, the system SHALL compress the remaining choreography — including every un-played metaphor beat (fragments, pecks, connections) — at a higher playback tempo within a bounded fast-play budget, and SHALL NOT skip beats to exit early. It SHALL begin the reveal within 900 ms of readiness; the overlay SHALL be fully removed within 1150 ms of readiness. Pointer interaction with the application SHALL be unblocked at the start of the reveal fade.

#### Scenario: Application ready early
- **WHEN** readiness arrives while pecking phases are still playing
- **THEN** the remaining choreography plays at compressed tempo with no beats skipped, and the overlay is gone within the hard budget — verified with fake timers against the pure timeline/machine modules

#### Scenario: Application ready before the overlay would animate
- **WHEN** readiness is already satisfied at overlay mount
- **THEN** the complete composition (entrance through wordmark) plays at compressed tempo — the pecks are never skipped — and the overlay adds no more than the fast-play budget plus the crossfade to time-to-interactive

### Requirement: Slow startup settles into a stable idle state
If application readiness has not arrived by the end of the canonical timeline, the animation SHALL transition to a stable idle state (mascot resting beside the completed knowledge structure with restrained breathing/blink micro-motion) and SHALL NOT replay the peck sequence or loop the full choreography. When readiness later arrives, the idle state SHALL resolve into the mark and reveal.

#### Scenario: Initialization slower than the animation
- **WHEN** readiness arrives several seconds after the canonical timeline ends
- **THEN** the overlay holds the idle state without restarting the sequence, and upon readiness plays the resolve and reveal phases once

### Requirement: Startup errors are never concealed
If startup initialization fails (startup snapshot and its legacy fallback both fail, surfacing `status: "error"`), or the application's root error boundary triggers, or a pre-React startup error occurs, the branded overlay SHALL exit (fast fade) so the application's existing error/recovery UI is visible. A watchdog SHALL force-exit the overlay after at most 15 seconds from mount regardless of any store state.

#### Scenario: Snapshot and fallback both fail
- **WHEN** `ensureStartup` settles in the error state while the overlay is visible
- **THEN** the overlay transitions to its aborted stage and unmounts within its fast-fade duration, revealing the application error/recovery surfaces

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
A user setting `interface.startupAnimationEnabled` (default `true`) SHALL disable the branded startup animation entirely. When disabled, the launch MUST NOT be delayed by this feature beyond a plain fade on readiness, and no other behavior changes.

#### Scenario: Setting disabled
- **WHEN** the setting is `false` at launch
- **THEN** no branded choreography plays and the application is revealed as soon as it is ready, with no added fixed delay

### Requirement: Fully offline launch
The startup animation MUST be completely local: no network requests, remote assets, remote fonts, or API calls. It SHALL function identically with no connectivity.

#### Scenario: Offline launch
- **WHEN** the application launches with no network access
- **THEN** the branded launch experience renders and completes identically, using only bundled/inline assets (asserted by a static source check for external URL references)
