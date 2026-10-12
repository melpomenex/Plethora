## Purpose

Defines how the Review Complete screen fits inside the mobile app viewport so users can reach every completion action when the summary is taller than the visible area.

## ADDED Requirements

### Requirement: Mobile review completion remains scrollable above fixed navigation

When the Review Complete content exceeds the available mobile viewport, the system SHALL allow vertical scrolling through the full summary and its actions. At the end of the scroll range, the final action SHALL be fully visible and operable above the fixed bottom navigation and the device's bottom safe area.

#### Scenario: Long completion summary on a phone
- **WHEN** a user finishes a review on a phone and the completion summary is taller than the available content area
- **THEN** the summary can be scrolled vertically from its heading through its final action
- **AND** the final action, including the return-to-review action when present, is fully visible above the bottom navigation

#### Scenario: Completion summary on a device with a home indicator
- **WHEN** a user scrolls a mobile Review Complete screen to its end on a device with a bottom safe-area inset
- **THEN** the final action remains operable without being covered by the bottom navigation or home-indicator area

#### Scenario: Completion content fits the viewport
- **WHEN** the Review Complete content fits within the available content area
- **THEN** the existing completion layout remains readable and its actions remain visible without requiring scrolling
