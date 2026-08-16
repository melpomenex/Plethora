## ADDED Requirements

### Requirement: Scrolling dismisses the touch selection sheet
On touch shells, when the selection actions sheet is open (or a stability-gated selection is active) and the user scrolls the document content, the system SHALL close the sheet and clear the app-level selection state once the scroll exceeds a small jitter threshold. The system SHALL NOT programmatically clear the native selection on touch shells.

#### Scenario: Scroll after selecting reflowed text
- **WHEN** the user has selected text in a reflowed PDF on mobile, dismissed or left the actions sheet, and then scrolls the reflow content
- **THEN** the actions sheet closes (if open), the app-level selection state clears, and the sheet does not re-open as a result of that scroll

#### Scenario: Micro-jitter does not dismiss
- **WHEN** the content scrolls less than the jitter threshold while the sheet is open
- **THEN** the sheet remains open

### Requirement: A dismissed selection cannot re-open the sheet by itself
After the user dismisses the actions sheet for a selection, subsequent selectionchange events for the same selected text — including those caused by DOM mutations around the still-live native selection (e.g. lazy reflow page sections appending) — SHALL NOT re-open the sheet. Suppression SHALL end when the native selection collapses or when the user starts a fresh selection gesture (touchstart/mousedown) in the document content.

#### Scenario: Reflow DOM churn after dismissal
- **WHEN** the user dismisses the sheet for a selection and background reflow analysis appends page sections that mutate the DOM around the live native selection
- **THEN** the sheet stays closed

#### Scenario: Deliberate re-selection of the same text
- **WHEN** the user dismissed the sheet, the native selection collapses or the user starts a new long-press gesture, and the same text is selected again
- **THEN** the actions sheet opens again

### Requirement: Existing dismissal paths remain functional
Scrim tap, Escape, and tap-away dismissal of the actions sheet SHALL continue to work on touch shells.

#### Scenario: Scrim tap
- **WHEN** the sheet is open and the user taps the scrim
- **THEN** the sheet closes and the selection is suppressed from re-opening per the dismissal rule
