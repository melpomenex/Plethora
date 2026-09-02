## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Non-Blocking In-App Import Feedback
The system SHALL present import progress and completion feedback using in-app indicators (such as sync status feedback or non-blocking toasts) rather than native browser `window.alert()` dialogs that are suppressed in desktop WebViews.

#### Scenario: OPML import completed in desktop WebView
- **WHEN** an OPML import completes in the desktop WebView
- **THEN** the system SHALL display non-blocking in-app feedback indicating the number of imported feeds rather than invoking `window.alert()`
