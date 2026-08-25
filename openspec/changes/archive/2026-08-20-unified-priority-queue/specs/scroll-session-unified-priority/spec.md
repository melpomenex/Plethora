## ADDED Requirements

### Requirement: Scroll Mode assembles the session from a unified outstanding set

Scroll Mode SHALL build its session from a unified set of items outstanding
today — due documents, due extracts, and due learning items combined — rather
than from whichever rows the active Queue filter happened to return. The active
filter (Due Today / Due All / All Items / New Only) SHALL be a browsing
convenience for the Queue list; it SHALL NOT change the membership of the
learning session.

When the unified set lacks enough of a type to meet its composition target, the
session SHALL draw the remainder from the wider due pools of that type, so a
flashcard-leaning filter does not produce a flashcards-only session.

#### Scenario: Flashcard-leaning filter still interleaves
- **WHEN** the active Queue filter is "Due All" and returns mostly learning items, the user has due documents in the library, and the Documents slider is non-zero
- **THEN** the Scroll session contains both documents and learning items
- **AND** they interleave rather than the documents appearing as a block after all flashcards

#### Scenario: Document-leaning filter still surfaces flashcards
- **WHEN** the active Queue filter is "Due Today" (which returns documents only) and the Flashcards slider is non-zero with due flashcards available
- **THEN** the Scroll session contains flashcards drawn from the due-flashcard pool alongside the documents

#### Scenario: Filter choice does not change session membership
- **WHEN** the user opens Scroll Mode from "Due All", closes it, switches the Queue to "Due Today", and reopens Scroll Mode with the same items outstanding
- **THEN** the two sessions contain the same set of items (modulo what was studied in between)
- **AND** only their presentation in the Queue list differs

### Requirement: Scroll Mode orders the session by priority

The Scroll session SHALL be ordered by item priority (the existing
`getPriorityScore` / `orderQueueItems`), not by type-even-spacing interleaving.
Priority is the arrangement principle: higher-priority items appear earlier.

A gentle variety guard SHALL prevent more than a configurable number (default
3) of the same item type from appearing consecutively, so a cluster of
equally-prioritized cards does not dominate. This guard SHALL NOT reorder
items across priority boundaries — it only breaks long same-type runs.

The previous `interleaveScrollItems` (type-even-spacing) and
`applyVarietyMixing` (engagement reshuffle) SHALL NOT be the primary ordering
path. They may be retained only as the variety guard's implementation, or
removed.

#### Scenario: Priority orders the session
- **WHEN** two documents and five flashcards are outstanding, and one document has higher priority than the flashcards
- **THEN** that document appears before the flashcards in the Scroll session
- **AND** the flashcards are not all clustered at one end

#### Scenario: Variety guard breaks same-type runs
- **WHEN** six flashcards in a row would otherwise be consecutive because they share the top priority
- **THEN** at most three appear consecutively before a different type is interleaved
- **AND** the relative priority order is otherwise preserved

### Requirement: Session is resumable and stable across re-entry

The Scroll session's order SHALL remain stable when the user navigates away
and returns (closing the Scroll tab, switching tabs, opening a document), as
long as no item was studied, postponed, or had its priority changed. This
preserves the property established by the `stabilize-queue-order-on-reactivation`
capability.

Rebuilding the session order SHALL only happen when the underlying priorities
change or when items are consumed — not on every render or tab re-entry.

#### Scenario: Order survives tab close and reopen
- **WHEN** the user closes the Scroll tab without studying anything and reopens it
- **THEN** the items appear in the same order as before
