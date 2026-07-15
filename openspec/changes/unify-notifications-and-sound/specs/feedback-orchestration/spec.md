# feedback-orchestration

## ADDED Requirements

### Requirement: In-app toasts render on every surface
The application SHALL mount the existing toast container exactly once at the
application root so that every `useToast()` / `useToastStore.addToast()` dispatch
renders a visible toast on Tauri desktop, desktop browser, mobile browser, and
installed PWA, honoring the existing stack limit, pause-on-hover, `role="alert"`,
and action-button semantics.

#### Scenario: Import completion toast is visible
- **GIVEN** the app is running on any supported surface
- **WHEN** a multi-file import completes and `documentStore` dispatches its summary toast
- **THEN** the toast SHALL be visible in the toast region and auto-dismiss after its duration
- **AND** a screen reader SHALL announce it via the existing live region

#### Scenario: No duplicate containers
- **GIVEN** the app has navigated across tabs and routes
- **WHEN** any toast is dispatched
- **THEN** exactly one toast region SHALL exist in the DOM

### Requirement: Policy-driven feedback orchestration
The system SHALL provide a typed `emitFeedback(event, payload)` entry point that
resolves delivery channels (toast, sound, haptic, OS notification, badge) from a
per-event policy registry combined with user settings, platform capabilities,
window focus/visibility, active-review-session state, quiet hours, and per-event
cooldowns. Call sites SHALL NOT branch on permissions, platform, or settings
themselves. Sound SHALL never be the sole channel for any event.

#### Scenario: OS notification downgrades to toast in foreground
- **GIVEN** notifications are enabled with permission granted
- **WHEN** `reminder.reviews-due` fires while the app window is focused and visible
- **THEN** no OS notification SHALL be sent
- **AND** a single actionable toast SHALL be shown instead

#### Scenario: Permission denied downgrades without error
- **GIVEN** browser notification permission is denied
- **WHEN** an event whose policy includes an OS notification fires
- **THEN** the orchestrator SHALL deliver the remaining permitted channels
- **AND** SHALL NOT re-request permission or log an error

#### Scenario: Quiet hours suppress attention channels only
- **GIVEN** quiet hours are enabled and the current time is inside the window
- **WHEN** `reminder.reviews-due` fires
- **THEN** no OS notification and no attention sound SHALL be delivered
- **AND** an error event fired at the same time SHALL still show its toast

#### Scenario: Duplicate events are deduplicated
- **GIVEN** an event with a cooldown fired moments ago
- **WHEN** an identical event fires within its cooldown window
- **THEN** the duplicate SHALL be suppressed across all channels

### Requirement: Review session feedback
Completing a review session SHALL play the `complete` sound role (gated by the
notification-sounds setting), layering the `celebrate` role only when the session
sets a new longest streak, exactly once per session, with the existing completion
screen as the visual channel. Grading an individual card SHALL produce at most an
opt-in `acknowledge` sound and existing inline UI, never a toast or OS notification.
An OS notification for session completion SHALL be sent only when the window is
hidden or unfocused at completion time.

#### Scenario: Rapid grading does not stack sounds
- **GIVEN** UI feedback sounds are enabled
- **WHEN** the user grades three cards within 300 ms
- **THEN** at most two acknowledge sounds SHALL play (150 ms minimum spacing)

### Requirement: Review reminders that actually fire
The system SHALL schedule the daily review reminder from the persisted
`notifications.reminderTime` while the app is running on all surfaces, and
additionally via the existing service-worker periodic sync on installed Chromium
PWAs by keeping the `due-card-count` value in the `incrementum-sw` IndexedDB current
whenever queue statistics are loaded or reviews complete. Reminders SHALL respect
quiet hours, fire at most once per calendar day per device (persisted cooldown),
be suppressed during an active review session, and use the `due-cards` tag so a
newer reminder replaces a stale one.

#### Scenario: Reminder while app closed (installed PWA)
- **GIVEN** an installed Chromium PWA with background reminders enabled and 12 due cards recorded
- **WHEN** the browser wakes the periodic sync after the reminder threshold
- **THEN** a system notification SHALL show the due count with a review action

#### Scenario: No reminder spam
- **GIVEN** a reminder already fired today on this device
- **WHEN** the scheduler re-evaluates (app restart, visibility change, second sync)
- **THEN** no further reminder SHALL be delivered until the next calendar day

### Requirement: Focus timer notifications route through the service
Focus-timer phase completion SHALL deliver its OS notification through the shared
notification service (Tauri command on desktop, Web Notification otherwise) instead
of constructing `new Notification(...)` directly, gated by both the timer's own
`notifications_enabled` config and the global notification gates, with the existing
timer sounds preserved.

#### Scenario: Phase completes on Tauri desktop while minimized
- **GIVEN** the focus timer is running with notifications enabled on Tauri desktop
- **WHEN** a phase completes while the window is minimized
- **THEN** a native notification SHALL be shown via the Tauri plugin

### Requirement: Due-count badge on capable platforms
When the Badging API is available and `notifications.showBadge` is enabled, the app
SHALL set the app badge to the current due count when queue statistics load and
clear or update it when reviews complete, failing silently where unsupported.

#### Scenario: Badge clears after finishing reviews
- **GIVEN** an installed PWA showing a badge of 12
- **WHEN** the user completes all due reviews
- **THEN** the badge SHALL be cleared

### Requirement: Critical data events surface persistently
Database-recovery and sync-corruption events SHALL surface as persistent
(no auto-dismiss) toasts with a recovery action, including wiring the currently
unheard `incrementum:sync-corruption` window event to this pathway, with the
`warning` sound role and never an OS notification.

#### Scenario: Sync corruption is no longer silent
- **GIVEN** the Yjs subsystem dispatches `incrementum:sync-corruption`
- **WHEN** the event fires
- **THEN** a persistent toast SHALL appear describing recovery options

### Requirement: Settings control and recovery
The notification settings UI SHALL present the app preference, the browser/OS
permission state, and platform capability as three distinct facts, provide
per-platform recovery guidance when permission is denied, offer sound preview and
volume controls using existing primitives, and provide a "Reset to recommended
defaults" action backed by `resetCategory("notifications")`. Preferences SHALL
persist across restarts via the existing `incrementum-settings` persistence with no
version migration required for v1.

#### Scenario: Denied permission shows recovery, not a broken toggle
- **GIVEN** browser notification permission is denied
- **WHEN** the user opens notification settings
- **THEN** the UI SHALL show the denied state with instructions to re-enable in the browser/OS
- **AND** in-app toggles SHALL remain usable for toast/sound behavior
