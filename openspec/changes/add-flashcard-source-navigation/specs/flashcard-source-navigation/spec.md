## Purpose

A flashcard generated from source material SHALL remain connected to the exact passage it came from: the user can jump from review into the original document at the originating location, see the passage highlighted within its surrounding context, and return to the interrupted study session without losing any review state. Covers capture-time provenance, lazy source resolution, the review-surface affordance, navigation and return behavior, and graceful degradation when the source is missing or changed.

## ADDED Requirements

### Requirement: Cards generated from source material retain provenance

When a flashcard is created from source material, the system SHALL persist enough provenance at creation time to locate the originating material later, without relying on post-hoc text matching as the only signal.

#### Scenario: Extract-backed card

- **WHEN** a flashcard is created from an extract that carries positional anchors (selection context, page number)
- **THEN** the card links to that extract, and no duplicate provenance is copied onto the card

#### Scenario: AI-generated cards from a document section carry a source anchor

- **GIVEN** the flashcard studio or assistant resolves a document section as generation context
- **WHEN** the user saves one or more generated cards
- **THEN** each saved card stores a source anchor referencing the document and the section/context it was generated from, including the originating excerpt
- **AND** cards generated from the same source portion each retain the anchor

#### Scenario: Provenance snapshot is self-contained

- **WHEN** a card's source anchor is written
- **THEN** it includes the document identifier, a locator in the application's existing location format, the originating excerpt text, and a fingerprint of the source content at capture time

#### Scenario: Manual and imported cards have no provenance

- **WHEN** a card is created manually, pasted, or imported with no originating source
- **THEN** no source anchor is written for it

### Requirement: Review cards expose an unobtrusive source action when a source resolves

During flashcard review, a card whose source can be resolved SHALL expose a source action that is discoverable but does not compete with the card content. Cards without resolvable provenance SHALL NOT display any source affordance.

#### Scenario: Source action on a provenance-backed card

- **WHEN** a review card's source resolves to an existing document
- **THEN** the existing source-context strip on the card is presented as an activatable control (button semantics, hover/focus states) labelled as a view-source action
- **AND** activating it, or pressing the dedicated review keyboard shortcut, navigates to the source

#### Scenario: No affordance on source-less cards

- **WHEN** a review card has no extract linkage and no stored source anchor
- **THEN** no source affordance is rendered for that card, in any review surface

#### Scenario: Affordance visibility relative to answer reveal

- **WHEN** a provenance-backed card is presented before the answer is revealed
- **THEN** the source affordance is already available (it is metadata, not a spoiler) and remains available after reveal

#### Scenario: Deck browser access

- **WHEN** the user opens a card's context menu in the deck browser
- **THEN** a view-source entry appears when the card's source resolves, and is absent when it does not

#### Scenario: Mobile access

- **WHEN** the review session runs on a touch device
- **THEN** the source action meets the application's minimum touch-target size and does not rely on hover

### Requirement: Activation navigates to the exact originating passage

Activating the source action SHALL open the original document with the originating passage visibly emphasized and enough surrounding content visible to understand where the card came from. The system SHALL NOT open an isolated snippet when the original document is available.

#### Scenario: Extract-backed card jumps to anchored passage

- **GIVEN** a card links to an extract whose selection context contains a structural locator (PDF page/anchor, EPUB CFI range, text offsets, or media timestamp)
- **WHEN** the user activates the source action
- **THEN** the document opens in the reader at that location
- **AND** the originating text span is visibly highlighted using the viewer's existing navigation-highlight treatment

#### Scenario: Anchor-backed card jumps to stored locator

- **GIVEN** a card stores its own source anchor with a locator
- **WHEN** the user activates the source action
- **THEN** the document opens at that locator with the stored excerpt highlighted when it is found

#### Scenario: Media-sourced card seeks to timestamp

- **GIVEN** a card's provenance resolves to a transcript timestamp
- **WHEN** the user activates the source action
- **THEN** the media opens and seeks to that timestamp with the corresponding transcript segment indicated

#### Scenario: Document already open is retargeted, not duplicated

- **WHEN** the user activates the source action while the target document is already open in a reader tab
- **THEN** the existing tab is focused and re-targeted to the passage rather than opening a duplicate document tab

#### Scenario: Highlight respects presentation settings

- **WHEN** reduced-motion or e-ink mode is active
- **THEN** navigation uses non-animated scrolling and the highlight is presented without motion effects, while remaining clearly visible in all themes

### Requirement: Resolution degrades through a confidence hierarchy and never silently lands on wrong text

The system SHALL resolve a card's source through a strict hierarchy: exact structural locator, then stored anchor, then constrained quote match within a bounded region, then coarse location. Each downgrade SHALL be observable to the user; the system SHALL NOT highlight text that was not verified to match the stored excerpt.

#### Scenario: Stale structural locator falls back to quote match

- **GIVEN** a card's structural locator no longer resolves (document reimported, offsets shifted)
- **WHEN** the user activates the source action
- **THEN** the system attempts to match the stored excerpt within the bounded region indicated by the coarse locator
- **AND** on a unique match it navigates there and highlights it

#### Scenario: Quote match fails but coarse location exists

- **GIVEN** the stored excerpt cannot be matched in the document
- **WHEN** the user activates the source action
- **THEN** the document opens at the coarse location (page, section, or start)
- **AND** the user is informed that the exact passage could not be located
- **AND** no text is highlighted

#### Scenario: Duplicate matches do not produce a false highlight

- **GIVEN** the stored excerpt matches multiple locations in the bounded region
- **WHEN** the user activates the source action
- **THEN** the system navigates to the coarse location without asserting a single false highlight, or disambiguates using additional stored anchor data when available

### Requirement: Unavailable sources fail gracefully

When the source cannot be opened at all, the system SHALL present a clear unavailable state that preserves what is known, and SHALL NOT present a broken or dead affordance.

#### Scenario: Source deleted

- **WHEN** the source document of a card no longer exists
- **THEN** activating the source action shows a source-unavailable state that includes the card's stored excerpt
- **AND** the affordance remains visible (the excerpt is still valuable provenance) but performs no failed navigation

#### Scenario: Source document exists but content is gone

- **WHEN** the document exists but cannot yield the stored location or excerpt
- **THEN** the document opens and the user is informed the passage could not be located

#### Scenario: Corrupt provenance is ignored safely

- **WHEN** a card's stored source anchor is malformed or fails validation
- **THEN** it is treated as absent: the card falls back to any extract linkage, and otherwise shows no source affordance
- **AND** the malformed data does not break card rendering or review

### Requirement: Returning from the source preserves study state

After navigating to a source, the user SHALL be able to return to reviewing at the exact point they left, without reconstructing the session.

#### Scenario: Return restores card and session state

- **GIVEN** the user activated the source action mid-session with the answer revealed
- **WHEN** the user returns to review (via the return affordance in the reader, the review tab, or mobile back navigation)
- **THEN** the same card is current, its answer-reveal state is preserved, session position and progress counters are unchanged, and ratings already submitted are intact

#### Scenario: Origin review tab is protected while viewing the source

- **WHEN** a source jump from review is in progress and the reader tab is open
- **THEN** the origin review tab SHALL NOT be evicted or reset as a side effect of opening the reader tab

#### Scenario: Keyboard and touch return paths

- **WHEN** the user is in the reader after a source jump
- **THEN** a visible return affordance is available (mouse, keyboard-activatable, and touch-sized), and mobile back navigation returns to the review session

### Requirement: Source navigation works offline

Source navigation SHALL function entirely offline whenever the source document is stored locally. No network request, AI call, or external service SHALL be required to resolve or open a locally available source.

#### Scenario: Offline review of locally stored source

- **GIVEN** the device has no network connection and the target document is stored locally
- **WHEN** the user activates the source action
- **THEN** the document opens at the originating passage exactly as it would online

#### Scenario: Remote-only source while offline

- **WHEN** the source content is not available locally and the device is offline
- **THEN** the unavailable state is shown rather than a spinner or silent failure

### Requirement: Provenance survives synchronization

Stored source anchors SHALL synchronize across a user's devices using the existing entity sync, and devices running older versions SHALL tolerate the new data without errors.

#### Scenario: Card with provenance syncs to a second device

- **GIVEN** a card with a source anchor is created on one device
- **WHEN** synchronization completes and the card is reviewed on another device
- **THEN** the source action resolves the same passage there

#### Scenario: Deleted source propagates

- **GIVEN** a source document is deleted and the deletion synchronizes
- **WHEN** the user activates the source action for an orphaned card on another device
- **THEN** the unavailable state is shown

### Requirement: Resolution is lazy and does not degrade review performance

Source resolution SHALL NOT run expensive work (document parsing, full-text search, AI calls) during normal card rendering; resolution of the navigable target occurs when the user invokes the source action.

#### Scenario: Card render cost is unaffected

- **WHEN** a review card with provenance is displayed
- **THEN** no document content is parsed and no quote matching is performed as part of rendering the card

#### Scenario: Source-less cards add no work

- **WHEN** a card without extract linkage or a stored anchor is rendered
- **THEN** no source-resolution work is triggered at all

### Requirement: The source action is accessible

The source affordance SHALL be operable by keyboard and assistive technology on parity with pointer and touch.

#### Scenario: Keyboard activation

- **WHEN** focus is on the source affordance and the user presses Enter/Space, or the user presses the dedicated review shortcut
- **THEN** the source navigation activates

#### Scenario: Screen-reader semantics

- **WHEN** the source affordance is rendered
- **THEN** it is exposed as a button/link with an accessible name describing the action and the source (e.g. document title)
- **AND** a failed or degraded navigation outcome is announced via the application's existing live-region convention

#### Scenario: Focus behavior after navigation and return

- **WHEN** the user returns from the source to the review session
- **THEN** keyboard focus is returned to the review card area rather than lost to the document

### Requirement: Excerpt content is treated as untrusted text

Source excerpts, titles, and anchors originating from imported documents, extensions, or sync SHALL be rendered as text only, subject to the application's existing content sanitization; they SHALL NOT be interpreted as trusted HTML anywhere in the review UI or unavailable panels.

#### Scenario: Malicious excerpt cannot inject markup

- **WHEN** a card's stored excerpt or source title contains script or HTML markup
- **THEN** review UI renders it inert, and no markup is injected into the reader document during highlight insertion

### Requirement: Existing card-generation workflows are preserved

Adding provenance capture SHALL NOT alter the scheduling, content, dedupe behavior, or success of any existing card-creation pathway, and cards created by pathways without available provenance continue to work identically.

#### Scenario: Generation without provenance still succeeds

- **WHEN** a card is created through a pathway that has no source context available
- **THEN** creation succeeds with no source anchor and no error

#### Scenario: Existing extract flows unchanged

- **WHEN** cards are generated from extracts as before the change
- **THEN** their review behavior, scheduling, and sync are unchanged apart from the new source action
