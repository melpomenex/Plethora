## ADDED Requirements

### Requirement: Mobile More menu includes an Audiobooks entry
The mobile bottom-navigation "More" overflow menu SHALL include an entry that opens the Audiobooks Shelf tab, alongside the existing RSS, Newsletters, Analytics, and Podcasts entries.

#### Scenario: Audiobooks entry is listed in the More menu
- **WHEN** a user opens the mobile "More" navigation menu
- **THEN** an "Audiobooks" item is shown in the menu's list of sections

#### Scenario: Selecting Audiobooks opens the Audiobooks Shelf tab
- **WHEN** a user taps the "Audiobooks" item in the More menu
- **THEN** a tab of type `"audiobook"` rendering the Audiobooks Shelf is opened (or focused if already open) and the More menu closes

#### Scenario: Audiobooks entry reflects active state
- **WHEN** the currently active tab is the Audiobooks Shelf
- **THEN** the "Audiobooks" item in the More menu is visually marked as active, consistent with how other More-menu items indicate the active tab
