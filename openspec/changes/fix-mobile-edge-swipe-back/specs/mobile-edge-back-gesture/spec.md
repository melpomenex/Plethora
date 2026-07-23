## ADDED Requirements

### Requirement: Back navigation is restricted to a left-edge gesture

On mobile, the application SHALL request back navigation from a touch gesture only when the single touch begins within the configured left-edge activation zone and then travels inward by at least the configured minimum horizontal distance with horizontal intent.

#### Scenario: Qualifying left-edge gesture requests back

- **WHEN** a single touch begins within the left-edge activation zone
- **AND** the touch moves inward horizontally by at least the minimum distance
- **AND** horizontal travel is greater than vertical travel
- **THEN** the application SHALL request back navigation exactly once when the touch ends

#### Scenario: Mid-screen horizontal swipe does not request back

- **WHEN** a single touch begins outside the left-edge activation zone
- **AND** the touch moves horizontally by at least the minimum distance
- **THEN** the application SHALL NOT request back navigation
- **AND** the active view SHALL retain ownership of the horizontal gesture

#### Scenario: A mid-screen swipe remains ineligible after moving toward the edge

- **WHEN** a touch begins outside the left-edge activation zone
- **AND** the touch later moves into the edge zone before ending
- **THEN** the application SHALL NOT request back navigation for that touch sequence

### Requirement: Non-qualifying movement preserves normal interaction

The back recognizer SHALL ignore movement that is vertical-dominant, outward from the left edge, shorter than the minimum distance, multi-touch, or cancelled.

#### Scenario: Vertical movement from the left edge continues scrolling

- **WHEN** a single touch begins in the left-edge activation zone
- **AND** vertical travel is greater than horizontal travel
- **THEN** the application SHALL NOT request back navigation
- **AND** vertical scrolling SHALL remain available

#### Scenario: Short or outward edge movement does not go back

- **WHEN** a touch begins in the left-edge activation zone
- **AND** it either moves outward or ends before reaching the minimum inward distance
- **THEN** the application SHALL NOT request back navigation

#### Scenario: Multi-touch or cancelled input does not go back

- **WHEN** a tracked edge sequence receives more than one touch or is cancelled
- **THEN** the application SHALL abandon the sequence without requesting back navigation

### Requirement: Gesture exclusions remain protected

The mobile back recognizer SHALL NOT request back navigation for a touch that begins on an existing protected control or gesture-owned target, including interactive controls, dialogs, editable fields, horizontal-scroll surfaces, and local swipeable items.

#### Scenario: Protected target at the left edge is not hijacked

- **WHEN** a touch begins within the left-edge activation zone on a protected target
- **AND** the touch travels inward far enough to otherwise qualify
- **THEN** the application SHALL NOT request back navigation
- **AND** the protected target SHALL retain its gesture behavior

### Requirement: Horizontal swipes remain content-owned

The mobile shell SHALL NOT install a full-width or right-edge horizontal gesture that changes the active tab or view. Horizontal swipes that do not qualify for left-edge back SHALL remain owned by the active view.

#### Scenario: Library horizontal scrolling does not navigate away

- **WHEN** a user performs a horizontal scroll that begins in the Library content area away from the left edge
- **THEN** the current Library view SHALL remain active
- **AND** the Library SHALL be able to process the horizontal scroll

#### Scenario: Mid-screen left swipe does not change tabs

- **WHEN** a horizontal left swipe begins outside the left-edge activation zone
- **THEN** the mobile shell SHALL NOT cycle to another tab or dispatch forward navigation
- **AND** the active view SHALL retain ownership of the gesture

#### Scenario: Right-edge left swipe does not change tabs

- **WHEN** a horizontal left swipe begins at the right edge of the screen
- **THEN** the mobile shell SHALL NOT dispatch a right-edge forward navigation action
- **AND** the active view SHALL retain ownership of the gesture
