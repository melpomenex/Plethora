## Purpose

Keep the desktop Assistant's AI provider picker visibly anchored and fully operable within the app window, including when the toolbar wraps or available space is limited.

## ADDED Requirements

### Requirement: Desktop provider menu is anchored below its model control

Opening the desktop Assistant model control SHALL display its provider menu below that control, with a visible gap and the menu's heading and management action visible. Placement SHALL remain anchored to the model control when adjacent toolbar controls wrap, for either left- or right-positioned Assistant panels. The menu SHALL NOT extend above the visible app area or obscure its own trigger through vertical centering.

#### Scenario: Open the top-right provider control

- **GIVEN** the desktop Assistant is positioned at the right of the reader
- **WHEN** the user opens its model control
- **THEN** the provider menu begins below the model control
- **AND** its heading and provider-management action are visible and operable

#### Scenario: Toolbar wraps in a narrow panel

- **GIVEN** the Assistant toolbar has wrapped onto multiple rows
- **WHEN** the provider menu opens on either panel side
- **THEN** the menu remains anchored below its model control
- **AND** adjacent mode controls do not move the menu above the app window

### Requirement: Desktop provider menu is contained and independently scrollable

The desktop provider menu's entire surface SHALL remain inside the intersection of the visible Assistant panel and app viewport. Its width SHALL fit the available panel width. When the provider choices exceed available height, only the provider list SHALL scroll, while the heading and management action remain visible. Every provider SHALL be fully revealable and operable through that list. The menu SHALL maintain this behavior after panel or viewport resizing and at supported desktop interface zoom settings, including short windows where the full list cannot fit.

#### Scenario: Short desktop window

- **GIVEN** the open menu contains more providers than fit below the trigger
- **WHEN** the user scrolls to the first and then final provider
- **THEN** each provider can be fully revealed and activated within the list
- **AND** the menu surface remains inside the visible panel and viewport

#### Scenario: Resize or change interface zoom while open

- **WHEN** the user resizes the Assistant panel or app window, or changes desktop interface zoom with the menu open
- **THEN** the menu remains inside the visible panel and viewport
- **AND** its heading, management action, and scrollable provider list remain reachable

### Requirement: Picker scrolling preserves surrounding context

Opening the menu SHALL reveal the active provider within the provider list when one is selected. Revealing a provider, scrolling the list, and dismissing the menu SHALL NOT move the reader, app page, or Assistant panel scroll position. The draft, attachments, and conversation SHALL remain intact.

#### Scenario: Active provider near the end of the list

- **GIVEN** the active provider is near the end of a list longer than the visible menu
- **WHEN** the menu opens
- **THEN** the provider list reveals the active row
- **AND** surrounding scroll positions, the draft, attachments, and conversation are unchanged

#### Scenario: Scroll the list then dismiss

- **WHEN** the user scrolls the provider list and dismisses the menu
- **THEN** the reader and Assistant retain their previous scroll positions and conversation state
- **AND** focus returns to the model control without scrolling the surrounding interface

### Requirement: Existing provider actions survive the positioning correction

Selecting a configured provider SHALL apply that provider and close the menu. Activating an unconfigured provider or the management action SHALL open the existing AI settings location without changing the active provider. Escape and outside activation SHALL dismiss the desktop menu and restore focus to the model control. The mobile Assistant SHALL retain its bounded in-sheet provider picker and existing Back/Escape behavior.

#### Scenario: Select a configured provider

- **WHEN** the user activates a configured provider in the desktop menu
- **THEN** that provider becomes active and the menu closes
- **AND** focus returns to the model control with the draft and conversation preserved

#### Scenario: Configure providers

- **WHEN** the user activates an unconfigured provider or the management action
- **THEN** the existing AI settings location opens
- **AND** the active provider is unchanged

#### Scenario: Dismiss without selecting

- **WHEN** the user presses Escape or activates outside the desktop menu
- **THEN** the menu closes and focus returns to the model control
- **AND** the active provider, draft, and conversation are preserved

#### Scenario: Mobile remains an in-sheet picker

- **WHEN** the model control is activated in the mobile Assistant
- **THEN** the provider picker remains bounded inside the sheet with a scrollable list
- **AND** Back or Escape closes the picker before dismissing the Assistant sheet
