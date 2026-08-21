# Responsive Extract Dialog

## ADDED Requirements

### Requirement: The Create Extract dialog SHALL present a responsive mobile action hierarchy

On phone-sized layouts, the Create Extract dialog footer SHALL NOT place all actions (Cancel, Create Extract, Create & Generate Cards, Create & Cloze, Create & Q&A) in a single non-wrapping horizontal row. Actions SHALL use a responsive hierarchy — primary actions prominent and always directly reachable; specialized secondary actions either wrapped into a structured grid or grouped behind a compact overflow/menu affordance. No action label SHALL be clipped, truncated mid-word, or compressed to an unusable width.

#### Scenario: The dialog opens on a narrow phone

- **WHEN** Create Extract is opened at a phone viewport width
- **THEN** every action is fully visible or one tap away via the grouped affordance, labels wrap or stack cleanly, and nothing extends beyond the dialog bounds

#### Scenario: Specialized actions are invoked from the grouped affordance

- **WHEN** the user opens the secondary-actions group on a phone and chooses Create & Cloze or Create & Q&A
- **THEN** the corresponding creation flow starts exactly as it does when invoked from the expanded footer on desktop

### Requirement: The dialog body SHALL scroll while header and footer stay reachable

The dialog content area SHALL scroll independently; the header and footer/actions SHALL remain visible and reachable without scrolling away. Content longer than the available height MUST NOT push the footer out of view.

#### Scenario: Long selected text is extracted on a small screen

- **WHEN** the extraction content exceeds the dialog's available height on a phone
- **THEN** the body scrolls internally while the footer actions remain visible and tappable

### Requirement: The dialog SHALL respect platform safe areas and dynamic viewport height

The dialog SHALL size against dynamic viewport height (or the application's viewport tokens) rather than plain `vh`, and bottom-aligned dialog surfaces SHALL respect the platform bottom safe-area inset so controls are not obscured by system gesture bars or the mobile shell.

#### Scenario: The keyboard opens over the dialog

- **WHEN** the soft keyboard opens while using the dialog on Android or iOS
- **THEN** the dialog remains usable within the reduced visual viewport, the footer stays reachable (by scrolling or resizing), and no control is permanently hidden behind the keyboard or navigation chrome

#### Scenario: A device with a gesture inset uses the dialog

- **WHEN** the dialog is displayed on a device reporting a bottom safe-area inset
- **THEN** the lowest interactive elements keep clearance from the inset and remain comfortable touch targets
