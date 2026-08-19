# Spec Delta: selection-intent-resolution

## ADDED Requirements

### Requirement: Shared selection-intent resolver
The system SHALL classify settled text selections through a single shared, framework-free intent resolver that maps selection text to exactly one intent kind — single lexical word, phrase (multi-word), URL, or none — and reading surfaces MUST NOT implement their own word-splitting or intent heuristics.

#### Scenario: Resolver is the only word-classification path
- **WHEN** the codebase is searched for single-word detection on reader selections
- **THEN** only the shared intent resolver module performs classification, and no reading surface duplicates it

### Requirement: Unicode-aware single-word classification
The resolver MUST treat a selection as a single lexical word when, after trimming surrounding whitespace and punctuation, it contains exactly one word-like token, using `Intl.Segmenter` where available and a Unicode-property fallback otherwise. Internal apostrophes and hyphens MUST be preserved as part of the word.

#### Scenario: Plain word
- **WHEN** the settled selection is `epistemological`
- **THEN** the intent is single lexical word with display word `epistemological` and query word `epistemological`

#### Scenario: Surrounding punctuation is stripped for the query
- **WHEN** the settled selection is `"ephemeral,"` or `(word).`
- **THEN** the intent is single lexical word, the query word is `ephemeral` / `word` with punctuation removed

#### Scenario: Internal punctuation is preserved
- **WHEN** the settled selection is `can't` or `mother-in-law`
- **THEN** the intent is single lexical word and the word is unchanged (one token, not split)

#### Scenario: Accented and non-Latin scripts
- **WHEN** the settled selection is `résumé`, `naïve`, `über`, or a single CJK run such as `日本語`
- **THEN** the intent is single lexical word

#### Scenario: Multi-word selection
- **WHEN** the settled selection is `epistemological foundations` or a full sentence
- **THEN** the intent is phrase

#### Scenario: URL selection
- **WHEN** the settled selection is a URL such as `https://example.com/a`
- **THEN** the intent is URL

#### Scenario: Empty or whitespace selection
- **WHEN** the settled selection is empty or whitespace/punctuation only
- **THEN** the intent is none and no selection action UI is presented

#### Scenario: Platform without Intl.Segmenter
- **WHEN** the runtime does not expose `Intl.Segmenter`
- **THEN** the fallback classifier runs, and any token it cannot confidently classify as a single word resolves to phrase (never to a single-word dictionary intent)

### Requirement: Intent resolved at selection settle, not at gesture threshold
The system SHALL resolve intent only when a selection reaches the controller's READY phase (stability observed after the gesture ends) and MUST NOT present dictionary UI at the moment a long-press threshold is crossed or while selection handles are still moving.

#### Scenario: Long-press then handle drag then release on one word
- **WHEN** a touch user long-presses a word, drags selection handles, and releases with exactly one lexical word selected
- **THEN** the intent for the settled selection is single lexical word

#### Scenario: No dictionary during gesture
- **WHEN** the long-press threshold is reached but the user continues adjusting the selection
- **THEN** no dictionary UI appears until the selection settles

### Requirement: Selection expansion cancels single-word presentation
When a previously settled single-word selection is expanded or changed, the system MUST close any dictionary presentation for it and MUST re-resolve intent for the new selection, presenting the multi-word selection action UX for phrases.

#### Scenario: Expand word to phrase
- **WHEN** a single word settles, its dictionary presentation appears or is pending, and the user then expands the selection to a phrase
- **THEN** the dictionary presentation closes without running further dictionary work and the standard selection action bar is presented once the expanded selection settles

#### Scenario: No simultaneous dictionary and action sheet
- **WHEN** any selection interaction finalizes
- **THEN** at most one of the dictionary peek and the generic selection action UI is active for that interaction

### Requirement: Identical intent behavior across reading surfaces
The same resolved intent MUST produce the same action on every supported reading surface — Documents reader, Queue Scroll Mode (document and RSS items), EPUB, PDF fixed, PDF reflow, PDF OCR-HTML, Markdown, HTML article, and RSS article reader — regardless of which shell (Documents tab, Queue tab, Scroll Mode) launched the reader. Reader-specific differences SHALL be limited to technically necessary selection-capture mechanics.

#### Scenario: Dictionary works identically from Queue and Documents
- **WHEN** equivalent content is opened from the Documents tab and from the Queue and a single word is long-pressed and released in each
- **THEN** both readers present the same dictionary peek behavior

#### Scenario: Queue RSS item parity
- **WHEN** a single word is long-pressed and released in a Queue Scroll Mode RSS article
- **THEN** the dictionary peek opens, and no reader-local dictionary implementation is used

### Requirement: Desktop invocation semantics
On pointer devices, automatic single-word dictionary presentation SHALL be limited to double-click word selections; mouse-dragged and keyboard single-word selections SHALL present the standard selection action UX with dictionary reachable as an explicit action.

#### Scenario: Double-click a word on desktop
- **WHEN** a desktop user double-clicks a word and the selection settles
- **THEN** the compact dictionary presentation opens anchored near the word

#### Scenario: Mouse-drag selection of one word
- **WHEN** a desktop user drag-selects exactly one word and releases
- **THEN** the standard selection action UI is presented, with dictionary available as an explicit action rather than auto-opened
