## ADDED Requirements

### Requirement: Web article import creates Document node
The web article import handler SHALL always create a top-level Document node before processing content. The imported article body SHALL NOT be collapsed into a single extract row.

#### Scenario: Web article imported as document
- **WHEN** a user imports a web article URL
- **THEN** the system SHALL create a Document record with the article's title, URL, and full HTML content
- **AND** the document SHALL be navigable as a full document in the viewer

### Requirement: Paragraph segmentation is opt-in
Automatic paragraph/semantic segmentation into extracts SHALL only execute when explicitly configured by the user. The default import behavior SHALL preserve the article as a single document without auto-extracting.

#### Scenario: Default import without segmentation
- **WHEN** a web article is imported with default settings
- **THEN** the system SHALL create one Document with the full article content and zero auto-generated extracts

#### Scenario: Import with segmentation enabled
- **WHEN** a web article is imported with auto-segmentation enabled in settings
- **THEN** the system SHALL create the Document node first, then generate extracts from detected paragraphs or semantic sections
