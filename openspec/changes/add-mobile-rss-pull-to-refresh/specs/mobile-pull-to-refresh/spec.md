## MODIFIED Requirements

### Requirement: Shared mobile refresh animation

Mobile Queue, mobile document content, and the mobile RSS Feeds and Articles panes SHALL use the same pull-to-refresh visual states. The indicator SHALL track pull progress, show a distinct armed state at the refresh threshold, remain visible in a compact form while refreshing, and settle into an outcome state. Feedback SHALL stay near the top of the active content so the user retains context and can see the content during refresh.

#### Scenario: Pull progress below the threshold

- **WHEN** the user pulls down from the top of a supported mobile surface without reaching the refresh threshold
- **THEN** the indicator SHALL reflect the amount pulled and retract when the gesture ends without refreshing

#### Scenario: Threshold reached and refresh released

- **WHEN** the user crosses the refresh threshold and releases the gesture while the indicator is armed
- **THEN** the indicator SHALL transition from its armed state into the shared refreshing state and the active surface SHALL refresh

#### Scenario: Queue and document surfaces use the shared treatment

- **WHEN** the user pulls to refresh on mobile Queue or mobile document content
- **THEN** both surfaces SHALL present the same visual progression and status language

#### Scenario: RSS panes use the shared treatment

- **WHEN** the user pulls to refresh in the mobile RSS Feeds or Articles pane
- **THEN** the pane SHALL present the same visual progression and status language as the other mobile refresh surfaces

## ADDED Requirements

### Requirement: Mobile RSS pull refreshes all subscriptions

In the mobile RSS Feeds and Articles panes, a downward touch gesture SHALL trigger the manual Refresh All operation when it begins at the top of the active list and is released while armed. A refresh SHALL attempt every subscribed feed regardless of the active feed, folder, or filter, and SHALL update content in the current pane. The gesture SHALL be available for short or empty lists whenever there are subscriptions. The Refresh All button SHALL provide an equivalent action without a gesture.

#### Scenario: Pull in a filtered article list

- **WHEN** the user releases an armed pull at the top of the mobile Articles pane while viewing a single feed or a filtered list
- **THEN** the app SHALL refresh every subscribed feed and display updates in the same pane with the selected scope and filter

#### Scenario: Pull in a short feed list or empty article list

- **WHEN** the user releases an armed pull in the mobile Feeds or Articles pane whose content fits within the viewport and there is at least one subscription
- **THEN** the app SHALL refresh all subscriptions and show available updates in that pane

#### Scenario: Gesture starts below the top or is canceled

- **WHEN** the user begins a touch while the list is scrolled away from the top, or the touch is canceled before release
- **THEN** the app SHALL leave the gesture uncommitted and allow normal list interaction

#### Scenario: All-feed refresh is already in progress

- **WHEN** a pull overlaps an active manual or scheduled all-feed refresh
- **THEN** the app SHALL continue the active refresh as a single run

#### Scenario: Some subscriptions fail to refresh

- **WHEN** at least one subscription fails during an all-feed pull refresh
- **THEN** the app SHALL apply any successful updates, show the shared failure outcome, and allow another pull after the refresh settles
