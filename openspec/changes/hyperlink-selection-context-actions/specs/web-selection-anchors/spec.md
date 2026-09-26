## Purpose

Defines durable, re-locatable anchors for selections made in saved web articles so extracts, highlights, and flashcards keep pointing at their originating passage even after the article's internal representation changes, and so opening a source returns the user to that passage.

## ADDED Requirements

### Requirement: Web selections capture a durable anchor at selection time

When a selection settles in a saved web article, the system SHALL capture, alongside any character offsets, a text-quote anchor consisting of the exact selected text plus surrounding prefix and suffix context, and a stable container reference where one can be derived. The anchor SHALL be persisted with any extract, note, or highlight created from the selection.

#### Scenario: Extract stores a text-quote anchor

- **WHEN** the user creates an extract from a web article selection
- **THEN** the persisted extract carries the selected text plus prefix/suffix context and a container reference in addition to offsets

### Requirement: Opening the source of a web-derived item restores the originating passage

When the user opens the source of an extract, highlight, or flashcard created from a web article selection, Plethora SHALL open the saved article and attempt to reveal and highlight the originating passage, resolving by exact quote match first and offsets as a fast path. When the passage cannot be uniquely resolved, the system SHALL degrade gracefully to the nearest recoverable position or a coarse location rather than failing to open the document.

#### Scenario: Flashcard view-source lands on the passage

- **WHEN** the user chooses to view the source of a flashcard created from a web article selection
- **THEN** the saved article opens, scrolls to the originating passage, and highlights it

#### Scenario: Anchor survives content regeneration

- **GIVEN** an extract whose offsets no longer align because the article was re-imported or re-rendered with different settings
- **WHEN** the user opens the extract's source
- **THEN** the passage is still located via the text-quote anchor when the text remains uniquely present

#### Scenario: Unresolvable anchor degrades instead of erroring

- **GIVEN** an extract whose passage no longer exists in the article
- **WHEN** the user opens the extract's source
- **THEN** the article opens without an error, at the best available location

### Requirement: Highlights repaint from quote anchors after content changes

Persisted highlights and extract markers in web articles SHALL be repainted after the document reopens, using quote-anchor resolution when offsets no longer align. Anchors that cannot be resolved at all SHALL be skipped without preventing the remaining highlights from painting.

#### Scenario: Highlight survives re-import

- **GIVEN** a highlight created before the article was re-imported with regenerated internal HTML
- **WHEN** the user reopens the article
- **THEN** the highlight is painted on the matching text located via its quote anchor

### Requirement: Previously created offsets-only contexts keep working

Selection contexts created before this capability that contain offsets but no quote anchor SHALL continue to resolve through the existing text-match fallback, with no migration required.

#### Scenario: Legacy extract still navigates

- **WHEN** the user opens the source of a pre-existing extract that stores offsets only
- **THEN** navigation resolves via the existing quote fallback against the document text
