## ADDED Requirements

### Requirement: Deliberate tap controls overlay visibility
Queue Scroll Mode SHALL change overlay visibility only in response to a completed stationary tap on eligible, non-interactive reading content.

#### Scenario: Stationary tap reveals hidden controls
- **WHEN** the controls are hidden and the user completes a stationary tap on eligible reading content
- **THEN** the system SHALL reveal the Queue Scroll Mode overlay, including its applicable rating controls

#### Scenario: Stationary tap hides visible controls
- **WHEN** the controls are visible and the user completes a stationary tap on eligible reading content
- **THEN** the system SHALL hide the Queue Scroll Mode overlay

#### Scenario: Interactive target does not toggle controls
- **WHEN** the user taps a button, link, form control, or element marked as interactive
- **THEN** the system SHALL leave overlay visibility unchanged and allow the target interaction to proceed

#### Scenario: Text-selection gesture does not toggle controls
- **WHEN** the user completes a gesture that creates or retains a text selection
- **THEN** the system SHALL leave overlay visibility unchanged

### Requirement: Touch scrolling does not activate the overlay
Queue Scroll Mode MUST distinguish a stationary tap from a touch gesture that moves content, and scrolling or swiping MUST NOT change overlay visibility.

#### Scenario: Finger scroll keeps hidden controls hidden
- **WHEN** the controls are hidden and the user drags a finger to scroll within the current document or content surface
- **THEN** the content SHALL scroll according to the gesture
- **AND** the system SHALL keep the overlay hidden

#### Scenario: Finger scroll preserves visible controls
- **WHEN** the controls are visible and the user drags a finger to scroll within the current document or content surface
- **THEN** the content SHALL scroll according to the gesture
- **AND** the system SHALL keep the overlay visible

#### Scenario: Queue swipe does not toggle controls
- **WHEN** a touch gesture qualifies for existing queue-item or document-page navigation
- **THEN** the system SHALL perform the applicable navigation
- **AND** the system SHALL leave overlay visibility unchanged

#### Scenario: Minor tap jitter remains a tap
- **WHEN** a touch begins and ends within the configured stationary-tap movement tolerance without scrolling content
- **THEN** the system SHALL treat the gesture as a stationary tap

### Requirement: Volume-key scrolling is content-only
When volume keys are configured to scroll in Queue Scroll Mode, the system SHALL use them only to move through the current content and SHALL NOT use them to activate or toggle the overlay.

#### Scenario: Volume key scrolls while controls are hidden
- **WHEN** the controls are hidden and the user presses a configured volume key while the current content can scroll in that direction
- **THEN** the system SHALL scroll the current content in the configured direction
- **AND** the system SHALL keep the overlay hidden

#### Scenario: Volume key preserves a visible overlay
- **WHEN** the controls are visible and the user presses a configured volume key while the current content can scroll in that direction
- **THEN** the system SHALL scroll the current content in the configured direction
- **AND** the system SHALL keep the overlay visible

#### Scenario: Volume key at content boundary does not reveal controls
- **WHEN** the controls are hidden and the user presses a configured volume key at a content boundary
- **THEN** the system SHALL apply only the existing boundary-navigation behavior, if any
- **AND** the system SHALL keep the overlay hidden

### Requirement: EPUB bottom toolbar is absent
The system MUST NOT render the EPUB mobile bottom toolbar containing progress, previous, next, reading settings, table of contents, or close controls.

#### Scenario: EPUB is viewed in Queue Scroll Mode
- **WHEN** the user reads an EPUB embedded in Queue Scroll Mode
- **THEN** the EPUB previous/next, font settings, and table-of-contents bottom bar SHALL NOT be rendered

#### Scenario: EPUB is viewed outside Queue Scroll Mode
- **WHEN** the user reads an EPUB in the standalone document reader
- **THEN** progress, previous/next, table-of-contents, and reading-settings controls SHALL be available from the EPUB top bar
- **AND** the EPUB bottom toolbar SHALL NOT be rendered

#### Scenario: Embedded EPUB actions remain accessible
- **WHEN** the user reads an EPUB embedded in Queue Scroll Mode
- **THEN** table-of-contents, reading-settings, and EPUB page previous/next actions SHALL be available from Queue Scroll Mode's top bar

### Requirement: Mobile rating controls require a long press
Queue Scroll Mode MUST keep mobile rating orbs hidden by default and SHALL reveal them temporarily only after an eligible long press.

#### Scenario: Long press reveals rating controls
- **WHEN** the user holds a stationary touch on eligible reading content for the configured long-press duration
- **THEN** the system SHALL reveal the rating controls temporarily

#### Scenario: Movement cancels rating reveal
- **WHEN** the user's touch moves beyond the stationary tolerance before the long-press duration elapses
- **THEN** the system SHALL keep the rating controls hidden

#### Scenario: Embedded EPUB forwards long press
- **WHEN** the user completes an eligible long press inside an embedded EPUB iframe
- **THEN** the embedded viewer SHALL request that Queue Scroll Mode reveal its rating controls
