## Purpose

Provides a focused, readable mobile workspace for inspecting and editing a Deck Manager card, including its Preview, Edit, and History views, without allowing animated themes to reduce the surface's contrast or hide secondary actions.

## ADDED Requirements

### Requirement: Tapping a card opens a focused Card Details surface

On a mobile-shell presentation, tapping a card in Deck Manager SHALL open a dedicated Card Details surface for that card. The surface SHALL identify the selected card, keep the deck list from receiving accidental input while it is open, and SHALL use an explicitly opaque themed surface so animated backgrounds are not visible through the card content or navigation chrome.

#### Scenario: Campfire theme keeps card details readable

- **WHEN** a user running Android with the Campfire animated theme taps a card in Deck Manager
- **THEN** a focused Card Details surface opens for that card
- **AND** the animated backdrop does not show through the surface, tab bar, header, or card content
- **AND** the Preview, Edit, and History labels remain readable with clear active/inactive contrast

#### Scenario: Card identity stays attached to the detail view

- **WHEN** Card Details is open for a card with a long question or title
- **THEN** the header identifies the card or its deck context without horizontal clipping
- **AND** the full card content remains available in the selected tab's scrollable body

### Requirement: Preview, Edit, and History are primary mobile navigation

Card Details SHALL expose Preview, Edit, and History as simultaneously visible primary tabs or an equivalent segmented navigation. Each tab SHALL have a comfortable touch target, a visible selected state, and SHALL display only its corresponding content while preserving the selected card.

#### Scenario: User switches between card views

- **WHEN** the user taps Edit or History from Card Details
- **THEN** the corresponding view replaces the current tab content for the same card
- **AND** the active tab is visually obvious
- **AND** the tab controls remain reachable while the view body scrolls

#### Scenario: Editing remains single-sourced

- **WHEN** the user edits and saves card content from the mobile Edit tab
- **THEN** the existing Deck Manager save behavior updates the selected card
- **AND** returning to Preview shows the saved content without opening a second editor flow

### Requirement: Secondary card actions remain discoverable without crowding primary navigation

Card Details SHALL provide an obvious overflow or equivalent secondary-action affordance for the selected card. It SHALL expose the existing applicable card actions, including suspend/unsuspend, move, duplicate, copy, source navigation where available, and delete with its existing confirmation, without replacing or hiding the Preview/Edit/History navigation.

#### Scenario: Secondary actions target the open card

- **WHEN** the user opens the secondary-action affordance from Card Details and selects Suspend, Move, Duplicate, or Delete
- **THEN** the action targets the card currently shown in Card Details
- **AND** the Card Details surface closes or updates consistently with the action's result
- **AND** Delete retains its confirmation step

#### Scenario: Inapplicable actions are not presented

- **WHEN** the selected card has no reachable source or is already suspended
- **THEN** source navigation is omitted and the suspend action is replaced by Unsuspend
- **AND** the remaining secondary actions stay available

### Requirement: Mobile dismissal and viewport behavior are safe

Card Details SHALL respect the Android status-bar and navigation-bar safe areas, keep the card body independently scrollable, and support the platform back action, visible Back control, and Escape where available. Dismissing the surface SHALL return the user to the Deck Manager list without losing the selected card's persisted changes.

#### Scenario: Back returns to the card list

- **WHEN** Card Details is open and the user taps Back or uses the Android back action
- **THEN** the Card Details surface closes
- **AND** the Deck Manager list is visible again at the current deck and scroll position

#### Scenario: Keyboard does not hide the editor

- **WHEN** the user focuses a field in the Edit tab and the Android keyboard opens
- **THEN** the detail surface remains above the mobile shell chrome
- **AND** the focused field and its save controls remain reachable by scrolling

### Requirement: Desktop Deck Manager behavior is unchanged

The Card Details presentation SHALL apply only to mobile-shell layouts. Desktop SHALL retain the existing side-panel card preview, Preview/Edit/History tabs, and desktop context-menu interaction.

#### Scenario: Desktop remains side-by-side

- **WHEN** a user opens Deck Manager at desktop presentation and selects a card
- **THEN** the existing desktop card preview panel is used
- **AND** no full-screen mobile Card Details surface or mobile-only overflow treatment is rendered
