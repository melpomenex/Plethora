## ADDED Requirements

### Requirement: Audiobook Shelf excludes podcast-tagged documents
The Audiobooks Shelf tab SHALL determine audiobook membership from a document's `fileType` and `tags`, and SHALL exclude any document carrying a `"podcast"` tag (case-insensitive) even if that document also has `fileType === "audio"` or an `"audio"` tag.

#### Scenario: Podcast episode with audio fileType and tags is excluded
- **WHEN** a document has `fileType: "audio"` and `tags: ["podcast", "audio"]`
- **THEN** the document does not appear in the Audiobooks Shelf's list of audiobooks

#### Scenario: Genuine audiobook with only audio fileType still appears
- **WHEN** a document has `fileType: "audio"` and no `"podcast"` tag
- **THEN** the document appears in the Audiobooks Shelf's list of audiobooks

#### Scenario: Document explicitly tagged audiobook still appears
- **WHEN** a document has a tag `"audiobook"` (case-insensitive) and no `"podcast"` tag, regardless of `fileType`
- **THEN** the document appears in the Audiobooks Shelf's list of audiobooks
