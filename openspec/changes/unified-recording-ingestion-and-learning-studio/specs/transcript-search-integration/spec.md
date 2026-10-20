## ADDED Requirements

### Requirement: Canonical session retrieval with honest locators
Canonical session transcript text SHALL be searchable through existing library indexes subject to privacy exclusions. Grounded Ask answers SHALL cite only retrieved/validated passage references within the explicit session or course scope. Exact navigation SHALL depend on actual segment evidence; untimed, stale or media-missing sources SHALL degrade honestly.

#### Scenario: Transcript-only grounded answer
- **WHEN** the user asks about an imported plain-text transcript
- **THEN** supported answers cite actual source paragraphs and no fabricated playback timestamps appear

#### Scenario: Course question
- **WHEN** the user chooses a course scope containing several recordings
- **THEN** retrieval is restricted to that collection's allowed documents and citations open the supporting session passages

#### Scenario: Corrected transcript search
- **WHEN** a canonical technical term is corrected
- **THEN** search/index data updates for that revision and stale citations do not silently highlight unrelated text
