## ADDED Requirements

### Requirement: Import does not create a whole-document extract

Importing an article SHALL NOT produce an extract whose content is the entire document body. Extracts are user-selected passages; the full text belongs to the document.

#### Scenario: Importing an article by URL

- **WHEN** a user imports an article via URL import, the command palette, or "save page" from the in-app browser
- **THEN** a document is created holding the article text
- **AND** no extract is created automatically for that import

#### Scenario: Extract created from a selection

- **WHEN** a user creates an extract from a selection in an imported article
- **THEN** the extract's content is the selected passage only

#### Scenario: Regression guard

- **WHEN** the import paths run in tests
- **THEN** an assertion verifies no created extract's content length approaches the source document's length

### Requirement: Existing whole-article extracts are identifiable

Where a whole-article extract already exists in a user's data, the system SHALL make it distinguishable rather than silently correct it, because the extract may carry the user's own scheduling history.

#### Scenario: Reporting oversized extracts

- **WHEN** an extract's content covers effectively the whole of its source document
- **THEN** it is surfaced to the user as oversized
- **AND** it is not deleted or rewritten without the user's action
