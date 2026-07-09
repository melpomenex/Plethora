# window-state-recovery Specification

## Purpose
TBD - created by archiving change fix-dashboard-macos-opml-import. Update Purpose after archive.
## Requirements
### Requirement: Auto-Validation of Window State File
The system SHALL validate the integrity of the window state file at startup and delete it if it is corrupted or empty.

#### Scenario: Startup with corrupted window state file
- **WHEN** the app starts with a corrupted or empty window state file
- **THEN** the system SHALL delete the corrupted file, recreate it with default window configuration, and launch successfully

### Requirement: CLI Window State Reset
The system SHALL support resetting the window state file via a command line argument.

#### Scenario: Launch with --clear-window-state argument
- **WHEN** the user launches the application with `--clear-window-state` or `--reset-window-state` command line flag
- **THEN** the system SHALL delete the persisted window state file and print confirmation

### Requirement: Native Menu Item for Window State Reset
The system SHALL expose a native menu item on macOS to clear the window state.

#### Scenario: Click Clear Window State in Menu
- **WHEN** the user clicks "Clear Window State" in the native macOS application menu
- **THEN** the system SHALL delete the window state file and prompt the user to restart the application

