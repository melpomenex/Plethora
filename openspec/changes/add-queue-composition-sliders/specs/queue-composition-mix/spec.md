## ADDED Requirements

### Requirement: Three composition sliders govern the Scroll Mode session

Scroll Mode's Queue Settings SHALL expose three sliders — Documents, Extracts and
Flashcards — each expressing that type's target share of the session. The three
targets SHALL be stored as `settings.scrollQueue.composition` and SHALL be the
single control over how the session is composed.

A target is a share of the **assembled session**, not a multiplier on any one
source pool. Raising Flashcards SHALL reduce the number of documents in the
session, not merely add flashcards on top of an unchanged document set.

Targets are normalized: the session is composed from each type's share of the
sum of the three targets. Sliders therefore do not need to add to 100, and no
slider is clamped by the others' positions.

#### Scenario: Slider changes the visible mix
- **WHEN** 300 documents and 1000 due flashcards are available and the user sets Documents 45 / Extracts 0 / Flashcards 55
- **THEN** roughly 55% of the session's items are flashcards and roughly 45% are documents
- **AND** the session contains fewer than 300 documents

#### Scenario: Targets that do not sum to 100
- **WHEN** the user sets Documents 50 / Extracts 50 / Flashcards 50
- **THEN** the session is composed in equal thirds
- **AND** no warning or clamping is applied to any slider

#### Scenario: A type set to zero is excluded
- **WHEN** the user sets Extracts to 0 with plenty of due extracts available
- **THEN** no extract item appears anywhere in the session

#### Scenario: All three targets are zero
- **WHEN** all three sliders are set to 0
- **THEN** Scroll Mode shows its empty state
- **AND** no arithmetic error or unbounded session is produced

### Requirement: Feed items draw from the Documents share

RSS articles and podcast episodes SHALL count toward the Documents share rather
than forming a fourth, uncontrolled group. They are reading material the three
sliders do not name, so folding them into Documents keeps RSS-in-queue and
podcast-in-queue from diluting the flashcard and extract shares the user asked
for.

#### Scenario: RSS enabled does not dilute flashcards
- **WHEN** RSS-in-queue is on, contributing 100 articles, and the user sets Flashcards to 50%
- **THEN** roughly half the session is still flashcards
- **AND** the articles occupy part of the Documents share alongside documents

#### Scenario: Documents at zero with RSS enabled
- **WHEN** the user sets Documents to 0 with RSS-in-queue on
- **THEN** no RSS article and no document appears in the session

### Requirement: Unfillable shares are redistributed

A share that cannot be filled SHALL be redistributed rather than shrinking the
session. When a type has fewer available items than its target share calls for,
the shortfall SHALL be reallocated proportionally across the types that still
have items available, repeating until every type is either satisfied or
exhausted.

The session SHALL NOT be padded beyond what is available: when every type is
exhausted, the session is simply every available item.

#### Scenario: A scarce type does not shrink the session
- **WHEN** the user asks for 20% extracts but only 6 due extracts exist, with documents and flashcards plentiful
- **THEN** all 6 extracts appear
- **AND** the remaining extract share is taken up by documents and flashcards in proportion to their own targets

#### Scenario: Every type exhausted
- **WHEN** the available items are fewer than the session would otherwise hold, for all three types
- **THEN** the session contains every available item
- **AND** no item is duplicated to reach a target

#### Scenario: Only one type has items
- **WHEN** only documents are available and the user asks for an even three-way split
- **THEN** the session is entirely documents

### Requirement: Composition applies to both Scroll Mode entry points

The composition targets SHALL be applied whether Scroll Mode is opened via
"Start Optimal Session" or via the Queue's "Scroll Mode" button. The sequential
`queue-list` path SHALL NOT bypass composition.

When the sequential path's source list does not contain enough of a type to meet
its target, the session SHALL draw the remainder from the same due-flashcard and
due-extract pools the optimal path uses, so a reading-mode queue can still reach
its flashcard target.

Item ordering within the sequential path's own rows SHALL be preserved relative
to each other; composition governs which and how many items appear, and where the
other types are interleaved.

#### Scenario: Scroll Mode button honours the flashcard slider
- **WHEN** the user is in the reading queue, sets Flashcards to 55%, and clicks the "Scroll Mode" button
- **THEN** roughly 55% of the resulting session's items are flashcards
- **AND** the flashcards are drawn from the due-flashcard pool even though the reading queue list contained none

#### Scenario: Optimal session honours the same targets
- **WHEN** the same targets are set and the user clicks "Start Optimal Session"
- **THEN** the session mix matches the targets to the same tolerance as the sequential path

#### Scenario: A hand-picked selection is still composed
- **WHEN** the user selects specific rows in the Queue and opens Scroll Mode with that selection
- **THEN** the selected rows are the source for their own types
- **AND** the targets still govern how many of each type appear

### Requirement: No hidden per-session cap on extracts

Extracts SHALL be limited only by their composition target and by availability.
The previous fixed cap of 20 extracts per session SHALL NOT apply.

#### Scenario: More than twenty extracts
- **WHEN** 50 due extracts are available and the Extracts target implies 30 of them
- **THEN** 30 extracts appear in the session

### Requirement: Composition targets persist and migrate

The three targets SHALL persist across sessions and app restarts. Settings saved
under the previous `flashcardPercentage` / `extractsCountAsFlashcards` shape SHALL
be migrated on load without user action, and SHALL NOT produce an empty or
all-zero composition.

#### Scenario: Migrating an old saved setting
- **WHEN** persisted settings contain `flashcardPercentage: 55` and no `composition`
- **THEN** the sliders open at a composition whose Flashcards share is 55%
- **AND** the remaining share is assigned to Documents and Extracts

#### Scenario: Fresh install default
- **WHEN** no settings have been persisted
- **THEN** the sliders open at the documented default composition
- **AND** the session contains a mix of all three types when all three are available

#### Scenario: Targets survive a restart
- **WHEN** the user sets a composition, closes the app, and reopens Scroll Mode
- **THEN** the sliders show the values they were left at
