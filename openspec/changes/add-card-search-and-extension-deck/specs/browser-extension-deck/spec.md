## ADDED Requirements

### Requirement: Extension-created learning items carry provenance tags

Every learning item created through the local browser-extension server SHALL carry the tag `browser-extension`, plus a kind tag describing how it was created: `image-occlusion` for image occlusion cards and `ai-generated` for cards produced by the AI flashcard generator. The tag list SHALL be produced by a single shared helper in the browser-extension server so that a card-creating route cannot omit provenance.

#### Scenario: Image occlusion card import

- **WHEN** the user creates an image occlusion card from the browser extension
- **THEN** the saved learning item carries the tags `browser-extension` and `image-occlusion`

#### Scenario: AI-generated card import

- **WHEN** the extension generates flashcards with the AI action and saving is enabled
- **THEN** each saved learning item carries the tags `browser-extension` and `ai-generated`

#### Scenario: Provenance tags come from one source

- **WHEN** a card-creating route in the browser-extension server assigns tags
- **THEN** it obtains them from the shared provenance helper rather than an inline tag literal

#### Scenario: Provenance tags are searchable

- **WHEN** the user searches `tag:browser-extension` in the Documents view
- **THEN** every card imported from the extension appears in the Cards result group

### Requirement: A Browser Extension deck surfaces imported cards

The app SHALL ensure a deck named `Browser Extension`, with tag filter `browser-extension` and tag-based filtering, exists whenever at least one learning item carries the `browser-extension` tag. The deck SHALL be created idempotently — repeated checks MUST NOT create duplicates — and SHALL appear in the Deck Manager alongside user-created decks with a correct card count.

#### Scenario: Deck appears after the first import

- **WHEN** the user imports their first card from the browser extension and opens the Deck Manager
- **THEN** a `Browser Extension` deck is listed and contains that card

#### Scenario: No deck without imports

- **WHEN** no learning item carries the `browser-extension` tag
- **THEN** no `Browser Extension` deck is created

#### Scenario: Repeated opens do not duplicate the deck

- **WHEN** the Deck Manager is opened repeatedly with extension-created cards present
- **THEN** exactly one `Browser Extension` deck exists

#### Scenario: User deletion of the deck is respected within the session

- **WHEN** the user deletes the `Browser Extension` deck
- **THEN** it is not immediately recreated while the Deck Manager stays open

### Requirement: The Browser Extension deck behaves like a normal deck

The `Browser Extension` deck SHALL support the same operations as user-created decks — studying, renaming, per-card context menu actions, suspending, and export — so it is not a read-only special case.

#### Scenario: Studying the deck

- **WHEN** the user starts a review from the `Browser Extension` deck
- **THEN** a review session runs over the cards matching that deck, as it would for any tag-filtered deck

#### Scenario: Renaming the deck

- **WHEN** the user renames the `Browser Extension` deck
- **THEN** the renamed deck keeps its `browser-extension` tag filter and is not replaced by a freshly created `Browser Extension` deck

### Requirement: Moving a card between decks preserves non-deck tags

Moving a card to another deck SHALL replace only the tags that act as deck filters for the card's current decks, and SHALL preserve every other tag on the card — including provenance tags (`browser-extension`, `image-occlusion`, `ai-generated`, `manual`) and user tags unrelated to any deck.

#### Scenario: Extension card moved to a user deck

- **WHEN** the user moves an image occlusion card out of the `Browser Extension` deck into a deck named `Anatomy` whose tag filter is `anatomy`
- **THEN** the card carries `anatomy`, `browser-extension`, and `image-occlusion`, appears in the `Anatomy` deck, and is still found by a `tag:browser-extension` search

#### Scenario: Unrelated user tags survive a move

- **WHEN** a card tagged `exam-2027` — a tag that is not any deck's filter — is moved to another deck
- **THEN** `exam-2027` remains on the card

#### Scenario: Previous deck tag is removed

- **WHEN** a card in the `Anatomy` deck (tag filter `anatomy`) is moved to the `Physiology` deck (tag filter `physiology`)
- **THEN** the card carries `physiology` and no longer carries `anatomy`

#### Scenario: Move failure restores the previous tags

- **WHEN** persisting the tag change fails
- **THEN** the card's displayed tags revert to their pre-move values and an error is surfaced to the user
