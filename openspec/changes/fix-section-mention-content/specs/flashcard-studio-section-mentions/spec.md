## MODIFIED Requirements

### Requirement: Sections context mode

The Flashcard Studio's Context Control panel SHALL support a `sections` mode (alongside `full`, `chapters`, `pages`, `excerpt`, `search`). When `sections` mode is active (set either by making a `#` selection or by choosing the mode directly), the LLM context for generation SHALL be produced by resolving the focused section(s) with `resolveSectionFocusedContext`, which re-resolves section ranges against freshly fetched document text, applies the configured token budget, and includes neighbor context — identical resolution to the document Assistant.

The resolved context SHALL contain the actual body text of the selected section(s). It SHALL NOT resolve to a document's title page, a front-matter table-of-contents entry, or any other occurrence of the section title that is not followed by the section's prose. When the document has a nested outline (e.g. Part > Chapter > Section), every outline entry SHALL be reconciled against the heading-derived section tree by both title and breadcrumb depth, so that a deep outline section resolves to its own body rather than its parent's title block. The document text used to build the section tree SHALL be the same canonical full-body text regardless of whether it was obtained via `get_document` or `extract_document_text`, so a section tree is never built from a short placeholder, legacy EPUB stub, or sparse browser-import text while the full body is available.

#### Scenario: Generation uses only the focused section

- **WHEN** the user has focused section(s) active and sends a generation request
- **THEN** only the resolved text of the focused section(s) (plus neighbor context, within the token budget) is passed to the LLM as document context — not the whole document

#### Scenario: Focus survives continued prompt editing

- **WHEN** the user inserts a section mention such as `#{008}` and continues typing the generation request over multiple keystrokes
- **THEN** the selected section remains attached to the visible token, and generation uses section 008's resolved transcript/body rather than falling back to the beginning of the document

#### Scenario: Submitted transcript chip is the context contract

- **WHEN** the submitted Assistant message contains a visible `Transcript > 008` chip encoded as `#{008}`, but the pick-time UI selection state is missing or stale
- **THEN** the system re-resolves `008` from the current authoritative transcript sections and sends only section 008's transcript text as document context, excluding the foreword and whole-transcript fallback

#### Scenario: Document Q&A lists the same audiobook chapters

- **WHEN** an audiobook exposes transcript-backed chapters such as `001` through `050` and the user types `#` in Document Q&A while focused on that audiobook
- **THEN** Document Q&A lists the same complete authoritative chapter catalog as the Assistant beside the audiobook, with the same titles, transcript previews, and section identities rather than a partial heading list rebuilt from flattened transcript text

#### Scenario: Document Q&A opens without a resident audiobook viewer

- **WHEN** Document Q&A is opened directly or after restart and no viewer-published chapter catalog is resident
- **THEN** it rebuilds the catalog from stored audiobook chapters plus timed transcript segments (falling back to parsed metadata and persisted transcription), shows a transcript-chapter loading state while doing so, and only falls back to document headings when no timed catalog is available

#### Scenario: Document Q&A sends a timed chapter directly

- **WHEN** the user chooses chapter `008` from Document Q&A and submits a prompt containing the visible `#{008}` chip
- **THEN** the token is rehydrated against the current chapter catalog and chapter 008's attached transcript content is sent directly, without requiring document character offsets and without including chapter 001 or foreword content

#### Scenario: Flashcard Studio accepts an audiobook chapter catalog as context

- **WHEN** the user selects an audiobook whose `documents.content` is empty or unavailable but whose viewer-published or reconstructed chapter catalog contains transcript text
- **THEN** Flashcard Studio treats that catalog as loaded document context, keeps the `#` chapter menu available, and does not show an instruction to close and reopen the studio

#### Scenario: Flashcard Studio sends a timed chapter without document extraction

- **WHEN** the user focuses transcript-backed chapter `008` in Flashcard Studio and generates cards
- **THEN** chapter 008's attached transcript is sent directly, the foreword and other chapters are excluded, and neither canonical document extraction nor character-range resolution is required

#### Scenario: Section range resolved against current document text

- **WHEN** the selected section's stored character range is stale relative to the freshly loaded document text
- **THEN** the system re-resolves the section by structural match and outline-text recovery before generating, falling back to an error if it cannot be resolved

#### Scenario: Resolved section yields the chapter body, not the title page

- **WHEN** a document's title or table of contents repeats a chapter's title verbatim before the chapter's actual body, and the user focuses that chapter
- **THEN** the resolved context contains the chapter's prose body (text that appears after the chapter heading and is not itself another table-of-contents or title-page line), and does not contain the front-matter/table-of-contents occurrence

#### Scenario: Deep-nested outline section resolves on first send

- **WHEN** the focused section is a multi-level outline entry (for example `Part Three > Chapter 11: Darwin's Delay`) and the document's heuristic heading tree assigns differentiated depths to part, chapter, and section headings
- **THEN** the section resolves to its own body range by matching both title and breadcrumb depth, the generation request proceeds on the first send, and the user is not asked to reselect the section

#### Scenario: Section tree built from full document text

- **WHEN** a document's stored content is a short placeholder, a legacy EPUB stub, or sparse browser-import text while the full body is recoverable (by re-extraction for Epub/Markdown/Html, or from the browser import's saved article HTML)
- **THEN** both `get_document` and `extract_document_text` return the recovered full body text, and the section tree is built from that full body so that resolved section ranges point at real prose

#### Scenario: Token budget enforced

- **WHEN** the focused section(s) exceed the model's context token budget
- **THEN** the resolved context is truncated to fit the budget and the user is informed that truncation occurred

### Requirement: Graceful handling of unresolved sections

If a focused section cannot be resolved at generation time, or can only be resolved to a range that yields no body text (an empty section, a mis-resolved table-of-contents entry, or a title-page occurrence), the system SHALL surface a clear, actionable validation message that includes the specific failure reason (the section belongs to a different document, matched multiple headings ambiguously, or had no current document-text range) and SHALL NOT silently fall back to whole-document generation. A section whose resolved range would produce empty or heading-only body SHALL be treated as unresolved and trigger this validation rather than being sent as context.

#### Scenario: Empty section focus in sections mode

- **WHEN** `sections` mode is active but no sections are focused and the user attempts to generate
- **THEN** the system shows a validation message instructing the user to select a section, and does not send a generation request

#### Scenario: Section cannot be resolved

- **WHEN** a focused section cannot be matched in the current document text at generation time
- **THEN** the system reports that the section could not be resolved, includes the failure reason (different document, ambiguous match, or no current text range) in the message, and does not fall back to whole-document generation

#### Scenario: Resolved range with no body is treated as unresolved

- **WHEN** a section's only resolvable range yields a body that is empty or shorter than its own heading line (for example a table-of-contents line immediately followed by another table-of-contents line), and no alternative candidate range yields real body text
- **THEN** the system reports the section as unresolved with that reason, and does not send the empty or heading-only text as the document context

#### Scenario: Ambiguous match reports candidate count

- **WHEN** a focused section title matches multiple current headings and the breadcrumb cannot disambiguate them
- **THEN** the validation message states that the section matched multiple headings, including the count of considered candidates, and does not pick one arbitrarily

#### Scenario: Visible chip cannot be rehydrated

- **WHEN** the submitted message contains a section chip whose token is absent from the current section list, or whose title matches multiple sections without a pick-time disambiguator
- **THEN** the system reports that the visible chip is unavailable or ambiguous, makes no provider request, and does not silently send full-document content

### Requirement: Generated flashcard artifact actions

When the beside-document Assistant, Podcast Assistant, or Document Q&A creates flashcards, the generated-card collection SHALL
preserve the normalized tool-call tags and use its `deck:<name>` tag to expose a
state-aware primary action in the collection header. If the named deck does not
exist, the action SHALL create a document-bound deck for those cards when a
document id is present (otherwise a tag-filtered deck). If it exists, the action
SHALL open Review with that deck selected. The header SHALL also
provide a compact action to copy the complete generated batch. These controls
SHALL have accessible names, keyboard focus treatment, and status feedback,
without displacing per-card open/retry behavior.

For a `batch_create_cards` call, the collection SHALL render one artifact per
valid card and SHALL map the batch's persisted result ids and errors to the
corresponding artifacts. The batch call SHALL NOT also appear as generic raw
tool JSON. A partially failed batch SHALL NOT offer a whole-batch retry that
would duplicate successful sibling cards.

#### Scenario: Generated cards do not yet have a deck

- **WHEN** a generated flashcard collection carries `deck:A Thousand Brains` and no case-insensitive exact-name deck exists
- **THEN** the header shows `Create deck`, creates `A Thousand Brains` bound to the current document (retaining its title tag metadata), and then reflects that the deck exists

#### Scenario: Unbound generated deck excludes unrelated cards

- **WHEN** a generated collection without a document id creates a deck carrying the tag filter `Podcast Episode`
- **THEN** the deck uses tag filtering, includes cards tagged `Podcast Episode` or `deck:Podcast Episode`, and excludes untagged cards and cards belonging to other named decks

#### Scenario: Generated cards already have a deck

- **WHEN** the generated flashcard collection's tagged deck already exists
- **THEN** the header shows `Open deck`, and activation opens the Review deck manager focused on that deck

#### Scenario: Copy generated batch

- **WHEN** the user activates the header's copy action
- **THEN** every generated card in the response is copied in a readable Q&A/cloze format and the control provides success feedback

#### Scenario: Podcast Assistant renders a batch as a card collection

- **WHEN** Podcast Assistant successfully executes `batch_create_cards` for a transcript and the normalized call carries `deck:<episode title>`
- **THEN** it shows each generated card in the shared Flashcards collection with persisted state, copy, and the state-aware `Create deck` / `Open deck` action, and does not expose the batch parameter JSON as a generic tool row

#### Scenario: Partial Podcast batch failure avoids duplicate retry

- **WHEN** some cards in a Podcast Assistant batch save successfully and another card fails
- **THEN** each result is shown on its corresponding card, and the failed row does not offer an action that would resubmit the entire batch and duplicate its successful siblings

### Requirement: Resizable Podcast Assistant

On desktop, the Podcast View Assistant panel SHALL be horizontally resizable
through the shared Assistant resize handle, constrained to 300–800 pixels, and
the selected width SHALL persist through the existing Assistant width setting.
The resize control SHALL expose vertical-separator semantics and support arrow
keys. On mobile, Podcast Assistant SHALL fill the swipe sheet and SHALL NOT show
the desktop resize handle.

#### Scenario: Resize Podcast Assistant with pointer or keyboard

- **WHEN** a desktop user drags the Podcast Assistant's left edge or focuses the resize separator and presses an arrow key
- **THEN** the Podcast chat host and Assistant content resize together within 300–800 pixels and the updated width is restored on the next open

#### Scenario: Podcast Assistant remains full-width on mobile

- **WHEN** Podcast Assistant is opened in the mobile swipe sheet
- **THEN** it fills the sheet width and omits the desktop resize separator without changing swipe-to-dismiss behavior

### Requirement: Imported and generated deck membership isolation

An unbound deck with one or more tag filters SHALL default to tag-filtered
membership and SHALL NOT behave as an all-library deck. A document-bound deck
may use `all` membership only within its matching document. Persisted unbound
decks created by the former all-library default SHALL be repaired to tag
filtering while retaining their ids, names, and filters.

An Anki APKG import SHALL create or repair a tag-filtered study deck for every
source deck name represented by the imported cards. This SHALL apply to Review
and Documents drag/drop import surfaces. When older card-only Anki imports are
present without study-deck records, Review SHALL reconstruct the missing named
decks from the persisted Anki import tags without duplicating or rewriting the
cards.

#### Scenario: Legacy named deck no longer matches the whole library

- **WHEN** persisted study-deck state contains an unbound deck with non-empty tag filters and `filterType: all`
- **THEN** migration changes that deck to `filterType: tags`, preserves its stable identity, and unrelated or untagged cards no longer appear in it

#### Scenario: Anki import creates its named deck

- **WHEN** an APKG imports cards tagged with `anki-import`, their note model, and source deck name `Anatomy 1K`
- **THEN** a tag-filtered `Anatomy 1K` study deck exists and includes those cards without including cards from other imports or cards with no matching deck tag

#### Scenario: Historical Anki cards restore a missing deck

- **WHEN** the library contains card-only Anki imports whose final import tag records a source deck name but no matching study-deck record exists
- **THEN** opening Review Home or Deck Manager creates the missing tag-filtered deck once, without creating documents or changing the imported card rows

#### Scenario: Documents drag/drop persists Anki cards and deck

- **WHEN** the user drops an APKG onto Documents
- **THEN** the application runs the same learning-item import used by Review, creates the source-named tag deck, refreshes card search data, and reports the imported card count

### Requirement: Document card saves include document-deck membership

When the Assistant beside a document or audiobook, or Document Q&A focused on a document, saves a generated card, the save parameters SHALL include the current `document_id` and a
`deck:<document title>` tag. The document title SHALL be resolved from Assistant
context metadata, the document store, or the persisted document record. The
matching title deck SHALL be upserted as a document-bound deck after a successful
card write. Batch card creation SHALL apply the same shared document-deck tag to
every persisted card. If the document title cannot be resolved, the system SHALL
not persist the card without deck membership and SHALL surface a retryable error.

#### Scenario: Audiobook context initially omits its title

- **WHEN** the Assistant creates cards for an audiobook whose context has a document id but no `metadata.title`
- **THEN** the save path resolves the title from the document store or persisted document, writes every card with `document_id` and `deck:<audiobook title>`, and upserts that title as a document-bound deck

#### Scenario: Batch card creation carries the title deck

- **WHEN** `batch_create_cards` receives a shared `deck:<document title>` tag
- **THEN** every created learning item persists that tag, merged without duplication with any per-card tags

#### Scenario: Document title remains unavailable

- **WHEN** a document-associated card is ready to save but context, store, and persisted-document lookup provide no title
- **THEN** the card tool is not invoked, the artifact reports that it was not saved without its document deck, and no unassigned card is created

#### Scenario: Previously saved untagged audiobook cards are restored to the title deck

- **WHEN** a persisted Assistant conversation contains successful card tool calls for the current audiobook from a build that saved `document_id` but omitted deck tags
- **THEN** reopening the audiobook upserts its title as a document-bound deck, and those existing cards are included through their document ownership without requiring destructive database rewriting

#### Scenario: Document Q&A generated set has deck actions and ownership

- **WHEN** Document Q&A creates or retries a flashcard set while focused on a document
- **THEN** every saved card carries that document's id and title deck tag, the generated-set header offers copy plus state-aware create/open-deck actions, and the resulting deck is bound to the source document
