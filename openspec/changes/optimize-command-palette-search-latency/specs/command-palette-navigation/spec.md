## MODIFIED Requirements

### Requirement: Command Palette Surfaces Registered Destinations
The command palette SHALL return every registered navigation destination as a searchable result alongside library results using a two-stage pipeline: Stage A SHALL match registered commands, destinations, URLs, contextual actions, and fast local title matches immediately without blocking on backend IPC; Stage B SHALL execute indexed full-library search across all matching items without hidden scan cutoffs (`maxDocsToScan = 500`), dropping superseded responses on newer keystrokes or palette close.

#### Scenario: Query matches a section label
- **WHEN** the user types a query that exactly matches a registered destination label (for example, "settings")
- **THEN** the command palette includes that destination in the result list
- **AND** the destination is ranked ahead of weaker content and help matches

#### Scenario: Query matches a section alias
- **WHEN** the user types a query that matches a configured destination alias (for example, "prefs" for Settings)
- **THEN** the command palette includes the mapped destination in the result list

#### Scenario: Query matches a feature destination by name
- **WHEN** the user types the name of a registered feature destination (for example, "rss", "podcasts", "audiobooks", or "newsletters")
- **THEN** that destination is included in the result list
- **AND** activating it opens the destination

#### Scenario: Large library item past index 500 is returned cleanly
- **WHEN** a user has 10,000 documents and searches for a unique phrase appearing only in document #9,950's body or transcript
- **THEN** the Command Palette renders immediate command/title feedback cleanly while typing
- **AND** Stage B SQLite FTS5 returns document #9,950 without truncating the underlying search scan at 500 documents

#### Scenario: Rapid keystrokes discard stale search responses
- **WHEN** the user types `"q"`, `"qu"`, `"qua"`, `"quan"` rapidly before earlier backend queries resolve
- **THEN** superseded responses are dropped by generation tracking and only the results matching the final query `"quan"` are displayed
- **AND** closing the palette before Stage B resolves leaves zero stale results or post-close state updates

## ADDED Requirements

### Requirement: Command Palette opens with immediate input focus and zero blocking pre-fetches
Opening `CommandCenter` / `GlobalSearch` SHALL focus the search input immediately without eagerly loading all extracts, extracting missing document text, executing synchronous `DOMParser` HTML scans, or fetching remote YouTube transcripts on the hot keystroke path.

#### Scenario: Opening Command Palette never blocks on extract load or transcript fetch
- **WHEN** the user triggers `Ctrl/Cmd+K` on a large library containing HTML documents, extracts, and un-fetched YouTube videos
- **THEN** the input receives focus cleanly on open
- **AND** typing a query executes zero `fetchYouTubeTranscript` calls and zero main-thread `DOMParser` loops inside the search handler
