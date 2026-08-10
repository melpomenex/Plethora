## ADDED Requirements

### Requirement: Toolbar expands on hover to reveal labels
The toolbar SHALL expand inward — toward the content area — when the pointer rests over it, revealing each button's text label beside its icon, and SHALL collapse back to the icon rail when the pointer leaves.

#### Scenario: Hovering expands the rail
- **WHEN** the pointer rests over the toolbar for the open delay
- **THEN** the toolbar widens and every button shows its text label next to its icon

#### Scenario: Leaving collapses the rail
- **WHEN** the pointer leaves the toolbar and no toolbar button holds keyboard focus
- **THEN** the toolbar collapses back to icons only after the close delay

#### Scenario: Passing over does not flap
- **WHEN** the pointer crosses the toolbar in less than the open delay
- **THEN** the toolbar does not expand

#### Scenario: Expansion does not reflow content
- **WHEN** the toolbar expands
- **THEN** it overlays the content area and the width and scroll position of the content area are unchanged

### Requirement: Keyboard and assistive-technology parity
Toolbar labels SHALL be reachable without a pointer, and the accessible name of each button SHALL be identical whether the toolbar is collapsed or expanded.

#### Scenario: Focus expands the rail
- **WHEN** a toolbar button receives keyboard focus
- **THEN** the toolbar expands and stays expanded until focus leaves the toolbar

#### Scenario: Label is not announced twice
- **WHEN** the toolbar is expanded and a screen reader reads a button
- **THEN** the button's label is announced exactly once

### Requirement: Reduced-motion and position support
The expansion SHALL animate only when motion is permitted, and SHALL open toward the content area for every supported toolbar position.

#### Scenario: Reduced motion
- **WHEN** the user's system requests reduced motion
- **THEN** the toolbar switches between collapsed and expanded without a slide or width animation

#### Scenario: Left, right, and top positions
- **WHEN** the toolbar is positioned left, right, or top
- **THEN** it expands rightward, leftward, and downward respectively, always over the content area and never off-screen
