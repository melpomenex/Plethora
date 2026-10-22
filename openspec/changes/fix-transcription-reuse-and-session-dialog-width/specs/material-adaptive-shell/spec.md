## ADDED Requirements

### Requirement: Customize Session retains bounded desktop geometry

On desktop dialog presentations, Customize Session SHALL be centered horizontally and vertically, SHALL have a maximum outer width of 42rem, and SHALL fit within the visible viewport with edge clearance. Its header and footer SHALL remain visible while long content scrolls within the dialog body. Content volume SHALL NOT expand the desktop dialog across the window.

#### Scenario: Wide desktop window
- **WHEN** the user opens Customize Session in a wide desktop window
- **THEN** the dialog's outer width does not exceed 42rem
- **AND** its horizontal and vertical center match the visible viewport center within rendering tolerance

#### Scenario: Many tags and ranking controls
- **WHEN** Customize Session contains many tags, long labels, and expanded adaptive-ranking controls
- **THEN** the desktop width remains bounded and content wraps without horizontal page overflow
- **AND** all controls remain reachable through the scrollable body with footer actions visible

#### Scenario: Resize or zoom
- **WHEN** the available viewport changes through resizing or zoom
- **THEN** the dialog stays inside the visible viewport
- **AND** crossing presentation boundaries uses the existing adaptive dialog or sheet behavior

### Requirement: Session width restoration preserves compact dialog behavior

Restoring Customize Session's desktop width SHALL preserve its compact sheet presentation, modal layering, focus containment and return, safe-area handling, keyboard-aware viewport bounds, and reachable primary and secondary actions.

#### Scenario: Phone and portrait tablet
- **WHEN** Customize Session opens on a phone or a tablet presentation
- **THEN** it retains the existing sheet width and compact action arrangement
- **AND** its scrim and surface remain above navigation chrome with each footer action visible and hit-testable

#### Scenario: On-screen keyboard
- **WHEN** an input is focused and the on-screen keyboard reduces the visible viewport
- **THEN** the sheet re-bounds to that viewport and the focused input and footer actions remain accessible

#### Scenario: Keyboard dismissal and focus restoration
- **WHEN** the user navigates through the modal with the keyboard and dismisses it with Escape
- **THEN** focus remains contained while open and returns to the invoking control after dismissal
