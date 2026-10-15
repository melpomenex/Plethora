## ADDED Requirements

### Requirement: Flashcard Studio context state is null-safe
Flashcard Studio SHALL normalize new, restored, and seeded context values before reading string or collection properties.

#### Scenario: Legacy state contains null collections
- **WHEN** restored context state contains `null` for chapters, search results, EPUB table-of-contents data, or another optional collection
- **THEN** context management opens using safe empty values without a `null is not an object` error

#### Scenario: Document content is null
- **WHEN** the selected document record has null or omitted content
- **THEN** Flashcard Studio shows a loading, extraction, empty, or error state and does not evaluate string length on the null value

### Requirement: EPUB context uses canonical extracted content
Flashcard Studio SHALL load canonical extracted text and available EPUB structure when a document listing does not include the EPUB body.

#### Scenario: EPUB is opened from a document surface
- **WHEN** a user opens Flashcard Studio context management for an EPUB whose list record omits content
- **THEN** the studio loads or extracts that EPUB's text and presents its available context choices without crashing

#### Scenario: EPUB extraction fails
- **WHEN** canonical EPUB text cannot be loaded or extracted
- **THEN** the studio displays a recoverable error with retry guidance and disables context-dependent generation

### Requirement: Explicit context modes never fall back to document beginning
Flashcard Studio MUST NOT substitute the first token-budget slice of a document when a user-selected chapter, section, search result, excerpt, or page range is empty, stale, or unresolved.

#### Scenario: Selected chapter is unavailable
- **WHEN** chapter mode contains a selected chapter that cannot be resolved in current document content
- **THEN** generation is blocked with guidance to refresh or reselect context

#### Scenario: Search context has no selected result
- **WHEN** search mode is active but no valid result excerpt is selected
- **THEN** generation is blocked or the user is asked to select a result instead of using document-opening content

### Requirement: Context is reset safely across documents
Document-bound context selections SHALL be cleared or revalidated when the selected document changes.

#### Scenario: User changes the selected document
- **WHEN** a user switches from one document to another in Flashcard Studio
- **THEN** stale chapter, section, excerpt, page, and search selections from the prior document are not applied to the new document

#### Scenario: Studio is opened with an explicit document seed
- **WHEN** Flashcard Studio receives a seed containing a document ID and excerpt for that same document
- **THEN** it preserves and validates the seeded excerpt as the active context

### Requirement: Card creation flow is consistent across assistant surfaces
Document Q&A and Assistant MUST apply the same create-versus-preview intent policy, flashcard tool normalization, source attachment, execution states, and user-facing card feedback.

#### Scenario: User asks to create cards
- **WHEN** a user requests that cards be created from available document context in either assistant surface
- **THEN** valid card tools execute and the resulting cards appear once as interactive chat artifacts rather than duplicated prose or raw tool payloads

#### Scenario: User asks for card ideas only
- **WHEN** a user explicitly asks to preview or discuss possible cards without saving them
- **THEN** the assistant does not persist cards automatically and clearly presents the result as a draft or discussion

