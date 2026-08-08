## ADDED Requirements

### Requirement: Documents view search matches learning items

The Documents view search SHALL match learning items (flashcards) in addition to documents. When the active search query matches at least one learning item, the view SHALL render a "Cards" result group separate from the document results, showing the matching cards.

A learning item SHALL be considered a text match when the query's free text appears, case-insensitively, in its question, answer, cloze text, or any of its tags.

#### Scenario: Free-text query matches a card but no document

- **WHEN** the user types `mitochondria` into the Documents view search and no document title, category, or tag contains that text, but a flashcard's question does
- **THEN** the document result list is empty and the Cards group lists that flashcard

#### Scenario: Query matches both documents and cards

- **WHEN** the user types a query that matches both a document title and a card question
- **THEN** both the document results and the Cards group are shown, each with its own count

#### Scenario: Empty query shows no Cards group

- **WHEN** the search input is empty
- **THEN** no Cards group is rendered and the Documents view behaves exactly as before this change

### Requirement: Card search honours the document search token grammar

Card matching SHALL reuse the existing search token grammar parsed by `parseDocumentSearch`. The `tag:` token SHALL filter cards by tag. Tokens that have no meaning for a card — `source:`, `queue:`, `extracts<N>` — SHALL exclude all cards from the results rather than being silently ignored, so a document-only query does not return an unrelated card list.

#### Scenario: Tag token filters cards

- **WHEN** the user searches `tag:browser-extension`
- **THEN** the Cards group lists exactly the learning items carrying the `browser-extension` tag

#### Scenario: Tag token combined with free text

- **WHEN** the user searches `tag:image-occlusion heart`
- **THEN** the Cards group lists only learning items that carry the `image-occlusion` tag AND whose question, answer, cloze text, or tags contain `heart`

#### Scenario: Document-only token suppresses card results

- **WHEN** the user searches `source:pdf`
- **THEN** the Cards group is not rendered, because `source:` describes documents only

### Requirement: Card results are actionable

Each card result SHALL show enough of the card to identify it — its question text (or cloze text for cloze items), a card-type indicator, and its tags — and SHALL open that card for viewing and editing when activated.

#### Scenario: Opening a card result

- **WHEN** the user clicks a card in the Cards group
- **THEN** the app navigates to the Deck Manager with that card selected in the card editor

#### Scenario: Image occlusion card result

- **WHEN** a matching learning item is an image occlusion card
- **THEN** its result row is labelled as an image occlusion card rather than showing raw region metadata

### Requirement: Card data is loaded lazily and does not slow the Documents view

Learning items SHALL NOT be fetched when the Documents view mounts. They SHALL be fetched once, on the first non-empty search query, and reused for subsequent queries within the same view session. Filtering SHALL happen client-side against that cached list.

#### Scenario: No fetch without a search

- **WHEN** the Documents view mounts and the user never types a search query
- **THEN** no learning item fetch is issued

#### Scenario: Single fetch across many queries

- **WHEN** the user types several different search queries in a row
- **THEN** learning items are fetched once and each subsequent query filters the already-loaded list

#### Scenario: Fetch failure degrades gracefully

- **WHEN** the learning item fetch fails
- **THEN** document results are still shown, the Cards group is omitted, and the failure does not surface as a blocking error
