## ADDED Requirements

### Requirement: Mobile queue controls remain unobscured

When Queue Scroll Mode's overlay is visible on mobile and the current item supports priority, the system SHALL expose a directly tappable Reading Priority control displaying the current named level. Queue session actions, Reading Priority, Details, and reader mode actions SHALL occupy non-overlapping touch targets within the visible safe area, including at 320 CSS pixels wide, in landscape, and with enlarged or localized text. Interactive targets SHALL be at least 44 by 44 CSS pixels and SHALL reflow without horizontal clipping when content cannot fit.

#### Scenario: Priority remains reachable with the reader toolbar visible
- **WHEN** a supported document is displayed on a phone with the queue overlay and document/extract/card toolbar visible
- **THEN** the current priority level SHALL be visible beside its flag
- **AND** tapping its control SHALL open the priority editor without activating a mode action or Details
- **AND** the mode actions, queue exit, and Details SHALL remain individually reachable

#### Scenario: Safe areas and expanded content do not obscure actions
- **WHEN** the overlay is displayed with a top safe-area inset, a large queue count or neural banner, long translated labels, or enlarged text
- **THEN** the upper controls SHALL reflow within the safe viewport without overlap or clipped actions
- **AND** the current priority level SHALL remain readable
- **AND** any visible rating dock SHALL clear the complete upper control region

#### Scenario: Hidden overlay and unsupported priority remain intentional
- **WHEN** the overlay is intentionally hidden or the current item does not support priority
- **THEN** the system SHALL NOT add a persistent priority control outside the overlay or expose an editor for an unsupported item

### Requirement: Mobile Reading Priority uses an accessible contextual sheet

On mobile, activating Reading Priority SHALL open a modal bottom sheet with a visible title, explicit close action, five named presets, and a labeled 0–100 fine-tune slider showing its exact percentage. The selected preset SHALL be identifiable without color alone. All controls SHALL fit within safe viewport bounds or remain reachable through internal vertical scrolling. Desktop priority editing SHALL retain its anchored presentation.

#### Scenario: Open and operate the sheet
- **WHEN** a mobile reader activates Reading Priority
- **THEN** the sheet SHALL show the current item's priority and selected level
- **AND** its content SHALL appear above queue controls, rating controls, the Assistant launcher, and mobile navigation
- **AND** background controls SHALL NOT receive pointer or keyboard interactions while it is open
- **AND** keyboard focus SHALL enter and remain within the sheet

#### Scenario: Presets remain usable on constrained screens
- **WHEN** the sheet is shown on a narrow or short landscape viewport, or with enlarged or translated labels
- **THEN** preset names SHALL remain readable and their targets SHALL remain at least 44 by 44 CSS pixels
- **AND** the fine-tune slider and close action SHALL remain reachable without horizontal scrolling

#### Scenario: Dismiss and resume reading
- **WHEN** the user closes the sheet with its close action, backdrop, Escape, or supported system Back
- **THEN** only the priority editor SHALL close
- **AND** the same item, reading position, and queue-overlay visibility SHALL be preserved
- **AND** focus SHALL return to the priority trigger when it remains available
- **AND** the dismissal interaction SHALL NOT activate a background control

### Requirement: Priority editing preserves persistence and item ownership

Priority editing SHALL preserve existing preset values and priority semantics, save completed edits without an additional confirmation step, and expose saving or failure feedback accessibly. Editor state and asynchronous results SHALL remain associated with the item that initiated them. The editor SHALL close when its item changes, priority becomes unavailable, the overlay intentionally hides, or the reader is closed.

#### Scenario: Successful preset selection
- **WHEN** the reader chooses a preset and persistence succeeds
- **THEN** that priority SHALL be saved for the current item
- **AND** the editor SHALL close and the trigger SHALL display the saved named level

#### Scenario: Fine-tune with touch or keyboard
- **WHEN** the reader completes a slider edit using touch, pointer, or keyboard
- **THEN** the displayed exact percentage SHALL reflect the chosen value
- **AND** the system SHALL persist the completed value without requiring a Save action
- **AND** interacting with the slider SHALL NOT toggle the queue overlay or activate background reading gestures

#### Scenario: Save failure remains recoverable
- **WHEN** a priority save fails
- **THEN** the editor SHALL remain open and expose an announced error
- **AND** the displayed value SHALL return to the last saved value
- **AND** the reader SHALL be able to retry

#### Scenario: Navigation cannot reuse stale editor state
- **WHEN** the current queue item changes while the editor is open or a save is pending
- **THEN** the editor SHALL close
- **AND** later completion of the previous item's request SHALL NOT alter the new item's displayed priority or editor state

#### Scenario: Existing overlay activation behavior is retained
- **WHEN** the reader scrolls, uses configured volume-key scrolling, selects text, or performs the existing rating long press outside the editor
- **THEN** queue-overlay and rating visibility SHALL follow the existing gesture behavior without an additional priority-specific reveal gesture
