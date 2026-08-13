## ADDED Requirements

### Requirement: Composition shares govern Optimal Session membership

The Documents / Extracts / Flashcards shares in Queue Settings SHALL be the sole control
over which item types an Optimal Session contains. A type with a share above 0 SHALL be
eligible for the session; a type with a share of 0 SHALL contribute no items.

The Customize Queue item-type toggles SHALL NOT remove a type from an Optimal Session.
Those toggles govern the Queue list and the list-sourced Scroll Mode session only.

Feed types not covered by the three shares (RSS articles, podcast episodes) SHALL continue
to draw from the Documents share, as they do today.

#### Scenario: Flashcards at 40%, Documents at 60%, Extracts at 0%
- **WHEN** the user sets Documents to 60, Flashcards to 40, Extracts to 0 and starts an Optimal Session
- **THEN** the session contains documents and flashcards in a 60:40 ratio
- **AND** no extract appears in the session

#### Scenario: Composition wins over an unchecked toggle
- **WHEN** Flashcards is unchecked in Customize Queue but the Flashcards share is 50
- **THEN** the Optimal Session still contains flashcards at the 50% share
- **AND** the Queue list still hides flashcard rows, because the toggles still govern the list

#### Scenario: Zero share excludes a type that is checked
- **WHEN** Extracts is checked in Customize Queue but the Extracts share is 0
- **THEN** the Optimal Session contains no extracts

#### Scenario: Every share at zero
- **WHEN** all three shares are 0
- **THEN** the Optimal Session shows its empty state rather than falling back to an unfiltered mix

### Requirement: Default item-type toggles match the default composition

The shipped default for the Customize Queue item-type toggles SHALL enable Documents,
Extracts and Flashcards, so a new user's Queue list agrees with the default composition
shares instead of contradicting them.

A user's saved toggle selection SHALL be preserved; only the default for users who have
never customized the toggles changes.

#### Scenario: New user starts an Optimal Session
- **WHEN** a user who has never opened Customize Queue starts an Optimal Session under the default shares
- **THEN** the session contains documents, extracts and flashcards
- **AND** the Queue list shows all three types under every filter mode

#### Scenario: Existing customized selection survives
- **WHEN** a user has previously unchecked Extracts in Customize Queue and the app is updated
- **THEN** Extracts remains unchecked in the Queue list

### Requirement: Counts follow the configured ratio within availability

An Optimal Session SHALL allocate items to each type in proportion to its configured share,
capped by how many items of that type are actually available. When a type cannot fill its
share, the unfillable remainder SHALL be redistributed proportionally across the types that
still have items, so the session is not shortened.

#### Scenario: All types are plentiful
- **WHEN** the shares are 60/0/40 and both documents and flashcards exceed their allocation
- **THEN** the session's document and flashcard counts hold the 60:40 ratio

#### Scenario: A type is scarce
- **WHEN** the shares are 60/0/40 and only 12 flashcards are available
- **THEN** the session contains all 12 flashcards
- **AND** the remaining slots go to documents rather than shrinking the session

#### Scenario: Only one type has items
- **WHEN** the shares are 60/0/40 and no flashcards are available
- **THEN** the session is documents-only

### Requirement: Presentation order reflects the configured mix

The order in which an Optimal Session presents its items SHALL track the configured shares.
The combined-criterion sort's proportion bias SHALL target the configured reading-to-review
ratio rather than a fixed 50/50 alternation, so the mix a user perceives while scrolling
matches the mix the totals encode. Priority SHALL remain the primary ordering signal.

#### Scenario: A 60/40 session reads as 60/40
- **WHEN** the shares are 60/0/40 and the user scrolls through the first 20 items
- **THEN** roughly 12 are documents and roughly 8 are flashcards
- **AND** no more than three items of the same type appear consecutively

#### Scenario: A single-type session is not forced to alternate
- **WHEN** the shares are 100/0/0
- **THEN** the ordering applies no cross-type proportion bias
- **AND** items are ordered by priority

#### Scenario: Priority still leads
- **WHEN** two items of different types have clearly different priority
- **THEN** the higher-priority item appears earlier, subject only to the same-type run guard

#### Scenario: Advancing does not recompose the remaining session
- **WHEN** the user rates or dismisses the current item and the next queued item is a flashcard
- **THEN** that flashcard remains the current item after the rating/removal transition completes
- **AND** releasing the rating lock does not re-sort the remaining session or replace the flashcard with a document at the same numeric index

### Requirement: Unfillable shares are reported to the user

The Queue Settings composition panel SHALL name any type that could not fill its configured
share, and how many items that type was able to supply. Silence SHALL NOT be the only signal
that a share was not honoured.

#### Scenario: Flashcard share cannot be met
- **WHEN** Flashcards is set to 40% but only 12 flashcards are available for the session
- **THEN** the composition panel notes that flashcards supplied 12 items, short of the 40% target

#### Scenario: Every share is met
- **WHEN** all three types can supply their configured share
- **THEN** no shortfall note is shown
