## ADDED Requirements

### Requirement: Outside Interaction Dismissal
The system SHALL close the open context menu if a mouse click (left-click, right-click, middle-click) occurs outside of the context menu container.

#### Scenario: Left click outside
- **WHEN** a context menu is open and the user left-clicks on an area outside the menu
- **THEN** the context menu SHALL be closed

#### Scenario: Right click outside
- **WHEN** a context menu is open and the user right-clicks on an area outside the menu
- **THEN** the context menu SHALL be closed

### Requirement: Non-dismissal of Menus on Safe Inside Interaction
The system SHALL NOT close the open context menu when a click occurs on a disabled item, a separator, or a submenu trigger item inside the context menu.

#### Scenario: Click on disabled item
- **WHEN** the user clicks on a disabled context menu item
- **THEN** the context menu SHALL remain open

#### Scenario: Click on submenu item trigger
- **WHEN** the user clicks on a submenu trigger item in the context menu
- **THEN** the submenu SHALL open or toggle, and the parent context menu SHALL remain open

### Requirement: Window and Layout Event Dismissal
The system SHALL close the open context menu when a window scroll, resize, window blur, or document visibility change event occurs.

#### Scenario: Window scroll
- **WHEN** a context menu is open and the user scrolls the page or window
- **THEN** the context menu SHALL be closed

#### Scenario: Window resize
- **WHEN** a context menu is open and the user resizes the window
- **THEN** the context menu SHALL be closed

#### Scenario: Window blur
- **WHEN** a context menu is open and the window loses focus (blur) or the document becomes hidden
- **THEN** the context menu SHALL be closed

### Requirement: Exclusive Single Context Menu
The system SHALL ensure that only one context menu is visible at a time. Showing a new context menu SHALL automatically close all previously open context menus.

#### Scenario: Opening another context menu
- **WHEN** a context menu is open and the user right-clicks on another element to open a different context menu
- **THEN** the first context menu SHALL close, and the new context menu SHALL open at the new position
