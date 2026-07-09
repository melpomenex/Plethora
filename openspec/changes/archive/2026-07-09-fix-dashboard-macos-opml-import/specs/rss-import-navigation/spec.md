## ADDED Requirements

### Requirement: Protocol-Agnostic and Case-Insensitive OPML Import
The system SHALL parse feed URLs with protocols like `feed://` and `feed:` by converting them into standard web protocols (`http://` or `https://`), and SHALL traverse outline/body elements case-insensitively when parsing OPML files.

#### Scenario: Import OPML with feed protocol and capitalized tags
- **WHEN** the user imports an OPML file containing feeds with `feed://` protocol and mixed-case tags like `<BODY>` or `<OUTLINE>`
- **THEN** the system SHALL successfully normalize the feed URLs, parse all outlines, and subscribe the user to the feeds
