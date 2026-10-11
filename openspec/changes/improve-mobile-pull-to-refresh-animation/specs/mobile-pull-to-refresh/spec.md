## Purpose

Provides a consistent, accessible pull-to-refresh interaction for mobile Queue and document content, with visual feedback that follows the user's gesture and reports the refresh outcome.

## ADDED Requirements

### Requirement: Shared mobile refresh animation
Mobile Queue and mobile document content SHALL use the same pull-to-refresh visual states. The indicator SHALL track pull progress, show a distinct armed state at the refresh threshold, remain visible in a compact form while refreshing, and settle into an outcome state. Feedback SHALL stay near the top of the active content so the user retains context and can see the content during refresh.

#### Scenario: Pull progress below the threshold
- **WHEN** the user pulls down from the top of Queue or document content without reaching the refresh threshold
- **THEN** the indicator SHALL reflect the amount pulled and retract when the gesture ends without refreshing

#### Scenario: Threshold reached and refresh released
- **WHEN** the user crosses the refresh threshold and releases the gesture
- **THEN** the indicator SHALL transition from its armed state into the shared refreshing state and the active surface SHALL refresh

#### Scenario: Queue and document surfaces use the shared treatment
- **WHEN** the user pulls to refresh on mobile Queue or mobile document content
- **THEN** both surfaces SHALL present the same visual progression and status language

### Requirement: Refresh outcome is accurate and accessible
The shared indicator SHALL show success only after the refresh operation succeeds and SHALL show failure when the operation fails. Status labels SHALL use the app's current locale. When reduced motion is enabled, the indicator SHALL reduce nonessential movement while retaining clear progress and outcome states.

#### Scenario: Refresh succeeds
- **WHEN** the active surface completes its refresh successfully
- **THEN** the indicator SHALL briefly show a success state before returning to rest

#### Scenario: Refresh fails
- **WHEN** the active surface's refresh operation fails
- **THEN** the indicator SHALL show a failure state instead of reporting success

#### Scenario: Reduced motion is enabled
- **WHEN** the user has enabled reduced motion
- **THEN** the refresh indicator SHALL limit nonessential animation while still showing whether it is armed, refreshing, successful, or failed
