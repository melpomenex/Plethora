## ADDED Requirements

### Requirement: New Queue dialogs cover the mobile bottom navigation

On mobile presentations, the queue creation and management dialogs (the Customize Session / New Queue dialog and the Manage Queues dialog) SHALL render their scrim and their panel above the app's bottom navigation. While either dialog is open, the bottom navigation SHALL NOT receive pointer input: tapping a navigation destination through the overlay SHALL NOT switch destinations, and the overlay SHALL remain open until the user dismisses it through the dialog's own controls.

#### Scenario: New Queue opened from the mobile queue view

- **WHEN** a mobile user opens New Queue from the saved queue dropdown while the bottom navigation is visible
- **THEN** the dialog and its backdrop cover the navigation area
- **AND** no part of the dialog or its actions is painted beneath the navigation
- **AND** tapping where a navigation destination sits does not change the active destination

#### Scenario: Manage Queues reached from the same dropdown

- **WHEN** a mobile user opens Manage Queues from the saved queue dropdown
- **THEN** that dialog and its backdrop likewise cover the navigation and block its input

#### Scenario: Dismissal only through dialog controls

- **WHEN** the user dismisses an open queue dialog with its close control, its scrim, or Escape
- **THEN** the dialog closes and the bottom navigation becomes interactive again
- **AND** keyboard focus returns to the control that opened the dialog

### Requirement: Customize Session actions are reachable on compact screens

The Customize Session / New Queue dialog SHALL keep its configuration controls and all of its actions reachable by scrolling on compact (phone and portrait tablet) presentations: the primary action (Apply Customization) SHALL be presented as a prominent full-width action, the secondary actions (Reset to Defaults, Save as New Queue, Update Queue when a queue is active, Cancel) SHALL remain individually tappable with touch targets of at least 44 CSS pixels in height, and no action SHALL be obscured by the bottom navigation, the home indicator, or another control. The Save as New Queue name entry SHALL keep its input, Save, and Cancel visible above the safe-area inset while the on-screen keyboard is open.

#### Scenario: Applying customization from a phone

- **WHEN** the user opens New Queue on a phone and scrolls the dialog
- **THEN** the title and close control, the scrollable configuration sections, and the action area remain usable
- **AND** Apply Customization is fully visible and activates on a single tap at its own center point

#### Scenario: Naming a new queue with the keyboard open

- **WHEN** the user taps Save as New Queue and the on-screen keyboard appears
- **THEN** the name input, Save, and Cancel remain visible above the safe-area inset
- **AND** saving a non-empty name creates the queue exactly as before

#### Scenario: Secondary actions remain available

- **WHEN** the dialog is open on a phone with an active saved queue
- **THEN** Reset to Defaults, Save as New Queue, Cancel, and Update Queue with the active queue's name are each reachable and tappable without overlapping the navigation or each other

#### Scenario: Desktop presentation is preserved

- **WHEN** the same dialog is opened at desktop width
- **THEN** it is presented as a centered dialog with the same configuration controls and the same action set and order as before this change
