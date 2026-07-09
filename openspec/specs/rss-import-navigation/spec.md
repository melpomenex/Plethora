# rss-import-navigation Specification

## Purpose
TBD - created by archiving change fix-rss-tab-regression. Update Purpose after archive.
## Requirements
### Requirement: OPML File Selection Trigger
The system SHALL initiate the file picker for OPML files when the user clicks the "Import OPML" button in the RSS Dashboard.

#### Scenario: Click Import OPML in Dashboard
- **WHEN** user clicks "Import OPML" in the RSS Dashboard
- **THEN** a local file selector dialog SHALL open allowing OPML or XML file selection

### Requirement: Exact Feed Count in Import Success Feedback
The system SHALL show the exact number of successfully imported feeds in the user alert message when importing an OPML file via the HTTP backend or Tauri.

#### Scenario: OPML import via HTTP backend
- **WHEN** user imports an OPML file containing 5 feeds in Web mode with HTTP backend enabled
- **THEN** the system SHALL show an alert stating that 5 feeds were successfully imported

### Requirement: Throttled Tauri OPML Feed Import
The system SHALL throttle or sequence IPC/network calls when importing multiple feeds from an OPML file in Tauri mode, avoiding concurrent resource exhaustion.

#### Scenario: Large OPML import in Tauri mode
- **WHEN** user imports an OPML file containing multiple feeds in Tauri mode
- **THEN** the system SHALL process the feeds sequentially or in batches, avoiding all-at-once concurrent fetch commands

### Requirement: Folder and Category Feed Navigation
The system SHALL allow users to click folders or categories in the RSS sidebar, displaying combined articles from all feeds inside that folder or category.

#### Scenario: Select folder in sidebar
- **WHEN** user clicks a folder section header in the sidebar
- **THEN** the folder SHALL be highlighted, and the article list SHALL display articles from all feeds nested in that folder

### Requirement: Protocol-Agnostic and Case-Insensitive OPML Import
The system SHALL parse feed URLs with protocols like `feed://` and `feed:` by converting them into standard web protocols (`http://` or `https://`), and SHALL traverse outline/body elements case-insensitively when parsing OPML files.

#### Scenario: Import OPML with feed protocol and capitalized tags
- **WHEN** the user imports an OPML file containing feeds with `feed://` protocol and mixed-case tags like `<BODY>` or `<OUTLINE>`
- **THEN** the system SHALL successfully normalize the feed URLs, parse all outlines, and subscribe the user to the feeds

