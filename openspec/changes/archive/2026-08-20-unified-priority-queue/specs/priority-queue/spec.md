## ADDED Requirements

> This capability is Plethora's **priority queue** — the backbone of normal
> incremental reading. Every element is ranked 0%–100% by user-set importance;
> the learning session is auto-sorted by a combined criterion and low-priority
> overflow is auto-postponed. It is distinct from the optional
> [`neural-queue`](../neural-queue/spec.md) creative mode, which reads
> intrinsic priority from this queue.

### Requirement: Every element type carries a user-set priority

Documents, extracts, AND learning items SHALL each carry a user-set priority on
a 0–100 scale. The priority +/- control SHALL work uniformly across all three
types. Today documents and extracts have priority fields; learning items do
not — their queue `priority` is computed from FSRS urgency at read time, which
is scheduling urgency, not importance. This gap SHALL be closed so the priority
queue treats topics and items uniformly, as Plethora does.

#### Scenario: A card has a settable priority
- **WHEN** the user opens the priority control on a learning item
- **THEN** a 0–100 priority can be set, just as on a document
- **AND** the value persists across sessions

#### Scenario: Card priority is independent of FSRS urgency
- **WHEN** a card's FSRS-derived urgency is high (overdue) but the user has set its priority low
- **THEN** the user-set priority governs its position in the priority queue
- **AND** the FSRS urgency continues to govern when it is *scheduled*, not its *importance rank*

### Requirement: Position and priority are interchangeable

An element's priority SHALL be equivalent to its position in the priority
queue, related by linear interpolation: `priority = (position - 1) /
(queue_size - 1) * 100`, where position 1 is the front (highest priority). The
inverse SHALL reposition an element from a desired priority:
`position = round((priority / 100) * (queue_size - 1)) + 1`. This mirrors
Plethora's `FUN_00cb1630` and `FUN_00cb21c0`.

The priority +/- UI SHALL reposition the element (smaller position = higher
priority), and the displayed priority SHALL be the derived value. There SHALL
be no independently-stored priority that can drift out of sync with position.

#### Scenario: Front element has highest priority
- **WHEN** the priority queue has 100 elements and an element sits at position 1
- **THEN** its derived priority is 0% (highest importance)

#### Scenario: Priority buttons reposition
- **WHEN** the user clicks "increase priority" on an element at position 50
- **THEN** the element moves to a smaller position number
- **AND** its derived priority decreases (higher importance)

#### Scenario: Relative position is visible
- **WHEN** the user views an element in the queue
- **THEN** its priority-queue position (1…N) is shown alongside its percentage priority

### Requirement: The learning session is ordered by a combined criterion

The learning session SHALL be auto-sorted by a combined criterion, NOT a pure
priority sort. The criterion SHALL combine: (1) the user-set priority as the
primary term, (2) a proportion-of-topics-vs-items bias so the session is a mix
of reading and review rather than all one type, and (3) a degree of stable
randomization so equally-prioritized elements are not always presented in the
same order. This mirrors Plethora's documented sorting behavior and the
`FUN_00c15fd0` "Probability of a topic/item being placed at the top of the
outstanding queue" criterion.

The sort SHALL run at session start (and on explicit rebuild), not on every
render, preserving resumability.

#### Scenario: High-priority elements surface first
- **WHEN** an element has the highest priority in the queue
- **THEN** it appears at or near the front of the learning session, subject to the topic/item proportion bias

#### Scenario: Session mixes topics and items
- **WHEN** the queue contains 90% items and 10% topics at similar priorities
- **THEN** the session is not 90% items at the front; topics and items interleave per the proportion bias

#### Scenario: Equal priorities vary in order
- **WHEN** two elements have identical priority
- **THEN** their relative order is determined by the stable randomization term
- **AND** the order is deterministic across re-renders within the same session

### Requirement: Low-priority overflow SHALL be auto-postponed

The lowest-priority elements SHALL be auto-postponed when the outstanding
material exceeds what the student can get through, rather than accumulating
unboundedly. The postpone decision SHALL respect priority and difficulty
thresholds (an element above the priority threshold is not postponed), matching
the reverse-engineered algorithm in `~sushi/precision-kernel-re/postpone_algorithm.md`.

Auto-postpone SHALL be configurable (enable/disable, thresholds) and SHALL NOT
postpone elements the user has explicitly flagged as do-not-postpone.

#### Scenario: Overflow is postponed
- **WHEN** 200 elements are outstanding, the user's daily capacity is 50, and auto-postpone is enabled
- **THEN** the lowest-priority 150 elements are postponed to a future date
- **AND** the session contains roughly 50 elements

#### Scenario: High-priority elements are not postponed
- **WHEN** an element's priority is above the postpone threshold
- **THEN** it remains outstanding even when the queue is over capacity

#### Scenario: Auto-postpone can be disabled
- **WHEN** the user disables auto-postpone in settings
- **THEN** all outstanding elements remain in the session regardless of priority
