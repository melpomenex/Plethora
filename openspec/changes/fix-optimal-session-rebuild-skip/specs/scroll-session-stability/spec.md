## ADDED Requirements

### Requirement: Session rebuilds preserve the item in view

Any rebuild of a Scroll Mode session list SHALL keep the item currently in
view as the current item. When the rebuilt list still contains the item, the
current index SHALL be moved to the item's new position in the rebuilt list.
This SHALL hold for both the optimal build path and the queue-list
(`customQueueItems`) build path, and for every trigger that causes a rebuild
— including dependency-identity changes that arrive after a rating lock has
been released.

#### Scenario: Flashcard preserved across a post-rating rebuild
- **WHEN** an optimal session presents a document followed by a flashcard, the user rates the document, the rating lock releases, and a session rebuild then occurs (for example a documents store reload) before the user interacts with the flashcard
- **THEN** the flashcard remains the current and rendered item
- **AND** the flashcard has not been rated, dismissed, or removed from the session by the rebuild
- **AND** the next item the user advances to is the item that followed the flashcard in the pre-rebuild session order at the flashcard's new position

#### Scenario: Position follows the item when the rebuild reorders
- **WHEN** a rebuild reorders the session so that the current item moves from index N to index M
- **THEN** the current index and rendered index both address index M after the rebuild
- **AND** no transition animation or scroll reset occurs, because the item on screen is unchanged

#### Scenario: Queue-list sessions get the same guarantee
- **WHEN** a queue-list Scroll Mode session (opened with explicit items) is rebuilt after a rating and a later dependency change
- **THEN** the item the user is currently viewing remains the current item under the same rules as the optimal path

### Requirement: The current item is never dropped by a rebuild

A rebuild that produces a session list not containing the current item SHALL
re-insert the current item at the current index rather than advancing the
user past it. Items the user has already passed MAY be dropped by the
rebuild; the item in view and items not yet reached SHALL NOT be silently
removed without re-insertion.

#### Scenario: Composition shrink cannot swallow the card in view
- **WHEN** a rating reduces the document pool such that the recomposed session is smaller and no longer contains the current flashcard in its slice
- **THEN** the flashcard is re-inserted at the current index and remains rateable
- **AND** the user's next advance goes to the rebuilt session's successor, not past an unseen item

#### Scenario: Externally deleted items still leave the view
- **WHEN** the current item's backing entity was deleted or suspended elsewhere so that the rebuild can no longer meaningfully present it
- **THEN** the session advances from that item as an explicit removal, indistinguishable from today's delete/suspend advance behavior

### Requirement: Optimal session composition is stable for the session lifetime

An optimal session's composed per-type counts SHALL be computed when the
session is established and SHALL NOT shrink as a direct consequence of
rating items already presented by that session. Rebuilds SHALL apply the
established counts, clamped to current availability, so that cards the
session promised are presented unless their pool is genuinely emptied by
external changes.

#### Scenario: Rating a document does not shrink the card budget
- **WHEN** an optimal session composed with document and flashcard counts (D, F) has a document rated mid-session and a rebuild occurs
- **THEN** the rebuilt session still presents F flashcards (clamped only if fewer than F remain available)
- **AND** the tail flashcards are not dropped because of the reduced document pool

#### Scenario: A genuinely emptied pool still shrinks
- **WHEN** external changes (suspension, deletion) empty or reduce a pool below the established count
- **THEN** the rebuilt session clamps that type's count to availability and reports shortfall as it does today

### Requirement: Flashcard reveal state survives rebuilds and item changes

The page's reveal state SHALL reflect the flashcard actually in view. A
rebuild that preserves the current card SHALL not reset its reveal state,
and when the current item changes to a different flashcard, the reveal state
SHALL be reset for the new card as soon as the change is registered by the
page, independent of the card component's own mount timing.

#### Scenario: Reveal survives an incidental rebuild
- **WHEN** the user reveals the current flashcard's answer and a session rebuild occurs that keeps the card current
- **THEN** the answer remains revealed with no visible flash of the hidden state

#### Scenario: Reveal resets promptly on card change
- **WHEN** the current item changes from one flashcard to another (after rating or navigation)
- **THEN** rating shortcuts gated on reveal are disabled for the new card until the user reveals its answer, with no interval in which the previous card's revealed state applies to the new card
