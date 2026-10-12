## Purpose

Allow users to customize RSS article presentation and reading appearance reliably across supported views, retain preferences across sessions, and interact with settings above app navigation.

## ADDED Requirements

### Requirement: Complete scoped persistence
The system SHALL persist every exposed customization field in native and HTTP modes, resolve global defaults with feed overrides, preserve unrelated fields during partial saves, and allow explicit clearing of filters and overrides.

#### Scenario: Partial save survives reload
- **WHEN** a user changes font size after previously saving author visibility and filters, then reloads
- **THEN** the new font size and all unrelated saved settings remain effective in both storage modes

#### Scenario: Global and feed settings remain isolated
- **WHEN** a user saves global defaults and a different font size for one feed
- **THEN** that feed uses its override while other feeds inherit global settings
- **AND** clearing the override restores inheritance without reading another feed's record

#### Scenario: Clearing a filter
- **WHEN** a user empties a previously saved keyword, author, or category filter and saves
- **THEN** that filter no longer restricts articles after reload in either storage mode

### Requirement: Accurate modal state and save feedback
The customization dialog SHALL display effective saved values for its current scope, discard canceled changes, preserve fractional numeric input, and report save success only after persistence succeeds. Reset SHALL be available without prior edits and stage all default values, including cleared filters, for saving.

#### Scenario: Reopening and switching feeds
- **WHEN** the user reopens the dialog or switches its feed scope
- **THEN** controls display the effective values for that scope without stale values or unsaved changes from another scope

#### Scenario: Decimal line height
- **WHEN** a user selects line height 1.7 and saves
- **THEN** the stored value and rendered article line height retain 1.7

#### Scenario: Save failure
- **WHEN** persistence fails
- **THEN** the dialog reports failure, retains the edited values for retry, and does not announce success

#### Scenario: Complete reset
- **WHEN** a user resets customization and saves
- **THEN** all appearance and sorting controls use declared defaults and all five filters are empty for the reset scope

### Requirement: Shared reader appearance
Font family, font size, line height, content width, text alignment, and theme SHALL affect app-rendered basic RSS content, extracted full content, Story view, and Scroll view. In-reader typography controls SHALL update the same effective preferences. External Original pages SHALL be identified as outside reader styling applicability.

#### Scenario: Font size changes visible text
- **WHEN** a user saves a change from 16px to 24px
- **THEN** article paragraphs render at 24px in each supported reader path immediately and after reload

#### Scenario: Other reader controls
- **WHEN** a user changes font family, line height, width, alignment, or theme
- **THEN** each supported reader reflects the corresponding setting
- **AND** narrow mobile screens remain usable without horizontal article overflow

#### Scenario: Existing reader preferences
- **WHEN** a user with legacy full-content typography settings opens the updated reader
- **THEN** those settings supply missing shared values once while explicit RSS values retain precedence
- **AND** subsequent typography changes use one shared preference source

### Requirement: Effective article display and layout controls
Card, List, and Compact SHALL have distinct presentations. Density, excerpt length, card height, thumbnail visibility and size, author visibility, date visibility, and feed icon visibility SHALL affect their applicable article presentations. Column count SHALL affect Magazine and Grid within available viewport space. The UI SHALL explain applicability where a control does not affect the active view.

#### Scenario: Independent image and excerpt settings
- **WHEN** a user selects Small or Large thumbnails or changes card height
- **THEN** the applicable card image size or content structure changes visibly
- **AND** the saved excerpt length remains unchanged

#### Scenario: Metadata and density across layouts
- **WHEN** a user changes metadata visibility or density in List, Magazine, or Grid
- **THEN** supported metadata is shown or hidden and spacing reflects the selected density
- **AND** hidden metadata leaves no orphan separator

#### Scenario: Responsive columns
- **WHEN** a user changes columns from two to four in Magazine or Grid
- **THEN** a sufficiently wide viewport shows four columns
- **AND** smaller viewports limit columns to maintain readable cards

### Requirement: Filters and sorting have consistent semantics
Keyword include/exclude, allowed/blocked authors, and category filters SHALL affect article lists and the Scroll sequence in the current RSS scope. Sorting SHALL apply to that same sequence. Date and reading-time ascending order SHALL mean oldest and shortest first respectively; title ascending SHALL mean A–Z; read-status ascending SHALL mean unread first. Descending SHALL reverse these primary orders, and labels SHALL describe the actual behavior.

#### Scenario: All filters are applied
- **WHEN** a user saves any of the five filter controls
- **THEN** articles are included or excluded according to that control in applicable lists and Scroll mode

#### Scenario: Sorting directions
- **WHEN** a user selects each sort field and either direction
- **THEN** displayed articles follow that direction with deterministic tie handling
- **AND** reading time is estimated from article text rather than markup

### Requirement: Presets advertise supported behavior
The system SHALL offer accurately named presets composed of supported presentation and sorting settings. Presets SHALL NOT claim a 24-hour restriction, long-form filtering, or popularity ranking unless those behaviors are implemented.

#### Scenario: Applying a preset
- **WHEN** a user chooses Compact List, Reading List, or Unread First and saves
- **THEN** its documented settings are applied and retained after reload
- **AND** Unread First puts unread articles before read articles

### Requirement: Customization dialog covers navigation
The RSS customization dialog and backdrop SHALL render above the app bottom toolbar, block interaction with background navigation, and remain usable on desktop and mobile within the visible viewport and safe-area insets. Keyboard focus SHALL remain within the open dialog and return to its trigger on dismissal.

#### Scenario: Mobile bottom toolbar
- **WHEN** a user opens RSS Customization with the mobile bottom toolbar visible
- **THEN** the dialog and backdrop cover the toolbar
- **AND** the toolbar cannot receive pointer input through the overlay
- **AND** tabs, Save, Reset, Close, and settings remain reachable by scrolling as needed

#### Scenario: Keyboard dismissal
- **WHEN** the user navigates the open dialog with Tab and then presses Escape
- **THEN** focus stays inside while open, Escape dismisses it, and focus returns to the opening control
