## MODIFIED Requirements

### Requirement: Exact Feed Count in Import Success Feedback
The system SHALL show the exact number of successfully imported feeds in the user alert message when importing an OPML file via the HTTP backend or Tauri, and SHALL ensure these feeds are correctly persisted on the chosen backend (HTTP backend when available, or local storage fallback) and loaded on the client.

#### Scenario: OPML import via HTTP backend
- **WHEN** user imports an OPML file containing 5 feeds in Web mode with HTTP backend enabled
- **THEN** the system SHALL show an alert stating that 5 feeds were successfully imported, and those feeds SHALL be persisted to the HTTP backend and loaded in the RSS feed list
