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
The system SHALL show the exact number of successfully imported feeds via visible in-app feedback when importing an OPML file, and SHALL ensure these feeds are immediately persisted on the chosen backend (Tauri SQLite, HTTP backend, or local storage fallback) and loaded into client feed list state without requiring a view switch, tab reload, or manual refresh.

#### Scenario: OPML import via HTTP backend
- **WHEN** user imports an OPML file containing 5 feeds in Web mode with HTTP backend enabled
- **THEN** the system SHALL show feedback stating that 5 feeds were successfully imported, and those feeds SHALL be persisted to the HTTP backend and immediately loaded in the RSS feed list

#### Scenario: Immediate display after OPML import in Tauri
- **WHEN** user imports an OPML file in Tauri mode
- **THEN** the imported feeds SHALL immediately appear in the RSS feed sidebar and dashboard stats without requiring the user to change views or click refresh

### Requirement: Throttled Tauri OPML Feed Import
The system SHALL persist all feeds from an OPML import immediately to storage before or alongside fetching article content, and SHALL fetch feed articles in the background using bounded concurrency, ensuring network operations do not block feed registration or UI responsiveness.

#### Scenario: Large OPML import in Tauri mode
- **WHEN** user imports an OPML file containing multiple feeds in Tauri mode
- **THEN** the system SHALL register the feeds immediately, display them in the UI, and synchronize articles with bounded concurrency (e.g. 4 concurrent requests) without blocking UI interactivity

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

### Requirement: RSS Sidebar Toolbar Stays Within Sidebar Bounds
On desktop (`lg:` breakpoint and above), the RSS sidebar header toolbar — containing the Add Feed, Import by URL, Newsletter Directory, Scroll Mode, Select Mode, Refresh All, and Options buttons — SHALL be constrained so its full content remains within the sidebar's configured width (`lg:w-72`) and SHALL NOT overflow or spill into the adjacent items-list or article pane.

#### Scenario: Many toolbar buttons rendered in a narrow sidebar
- **WHEN** the RSS view is displayed at desktop width (`lg:` breakpoint and above) and all sidebar header toolbar buttons (Add, Import URL, Newsletter, Scroll, Select, Refresh, Options) are rendered
- **THEN** the toolbar content SHALL remain within the horizontal bounds of the `lg:w-72` sidebar with no portion overlapping or spilling into the items-list pane or article pane next to it

#### Scenario: Toolbar width constrained when sidebar has a fixed basis
- **WHEN** the sidebar is sized to its `lg:w-72` flex basis and the toolbar's intrinsic content width would exceed that basis
- **THEN** the sidebar column SHALL allow flexbox to clamp its width (via `min-w-0`) and the toolbar SHALL wrap or clip within the sidebar rather than expanding the column

### Requirement: RSS Feed List Scrolls Vertically
The RSS sidebar feed list SHALL scroll vertically when the number of feeds exceeds the available sidebar height, so that all feeds remain reachable regardless of how many are subscribed.

#### Scenario: Feed list taller than sidebar viewport
- **WHEN** the user has subscribed to more feeds than fit vertically in the visible sidebar height on desktop
- **THEN** the feed list region SHALL become vertically scrollable (`overflow-y-auto`) and the user SHALL be able to scroll to reach feeds below the fold without the header toolbar or filter controls scrolling away

#### Scenario: Bounded height propagated to feed list
- **WHEN** the RSS view is rendered on desktop inside a sized parent container
- **THEN** the layout chain from the outer container down through the sidebar column to the feed list SHALL propagate a bounded height (via `min-h-0` and `flex-col`) so that the feed list's `flex-1 overflow-y-auto` region engages scrolling rather than collapsing or overflowing the viewport

### Requirement: Non-Blocking In-App Import Feedback
The system SHALL present import progress and completion feedback using in-app indicators (such as sync status feedback or non-blocking toasts) rather than native browser `window.alert()` dialogs that are suppressed in desktop WebViews.

#### Scenario: OPML import completed in desktop WebView
- **WHEN** an OPML import completes in the desktop WebView
- **THEN** the system SHALL display non-blocking in-app feedback indicating the number of imported feeds rather than invoking `window.alert()`
