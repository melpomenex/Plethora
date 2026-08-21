## ADDED Requirements

### Requirement: Sidebar width is user-configurable and persisted
The system SHALL expose a setting for the width of Plethora's sidebar (the toolbar rail) with a safe minimum, a safe maximum, and a sane default equal to current Plethora behavior. The width SHALL be persisted across sessions using the established settings persistence (zustand `persist` on `settingsStore`, key `plethora-settings`) and SHALL update the interface immediately when changed.

#### Scenario: Setting changes apply immediately and persist
- **WHEN** the user changes the sidebar-width setting
- **THEN** the sidebar SHALL resize immediately (feeding the `--toolbar-rail-w` / `--toolbar-expanded-w` CSS variables or an inline style on `.toolbar-rail`), and the value SHALL survive an application restart

#### Scenario: Range bounds
- **WHEN** the user moves the width control to its extremes
- **THEN** the width SHALL be clamped to the configured minimum (enough to keep labels/icons usable, e.g. ≥ 3rem collapsed rail) and maximum (e.g. ≤ 20rem expanded), and the interface SHALL NOT break or overflow horizontally

#### Scenario: Default matches current behavior
- **WHEN** a new user (or a user who never changed the setting) opens the app
- **THEN** the sidebar width SHALL equal the current default (3rem rail / 11.5rem expanded), i.e. existing behavior is unchanged

### Requirement: The setting and any manual resize share one source of truth
The sidebar is not currently drag-resizable; the settings value SHALL be the single source of truth for width. If a drag resize is ever added later it must write to the same persisted setting; this change SHALL NOT introduce a second, conflicting width system.

#### Scenario: No conflicting width systems
- **WHEN** the user changes the setting and the app restarts
- **THEN** the rendered width SHALL match the persisted setting exactly (single source of truth)

### Requirement: Mobile ignores/reinterprets the setting
On layouts that do not expose the desktop sidebar (mobile shell, bottom navigation), the sidebar-width setting SHALL be ignored or hidden and SHALL NOT break responsive layouts.

#### Scenario: Narrow/mobile viewport
- **WHEN** the app renders the mobile shell (no desktop toolbar rail)
- **THEN** the sidebar-width setting SHALL NOT affect layout, and responsive layouts SHALL remain intact

### Requirement: Sidebar content remains usable
Labels, icons, and content inside the sidebar SHALL remain usable at every permitted width, with no horizontal overflow elsewhere in the layout.

#### Scenario: Expanded width keeps content readable
- **WHEN** the sidebar is set to a large width
- **THEN** sidebar labels/icons SHALL render fully without clipping, and the content area SHALL not be pushed into horizontal overflow

#### Scenario: Collapsed rail keeps icons visible
- **WHEN** the sidebar is at the minimum width
- **THEN** icons SHALL remain fully visible and tappable, and the hover-expand behavior SHALL continue to work