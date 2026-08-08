## ADDED Requirements

### Requirement: Priority is derived from neural-queue position

An element's priority SHALL be derived from its position in a sorted neural
queue by linear interpolation: `priority = (position - 1) / (queue_size - 1) *
100`, where position 1 is the front (next to study, highest priority). There
SHALL be no independently-stored priority column on element_tree; the
`priority_value` column on `neural_queue` is a denormalized cache of this
formula and is always consistent with `position`.

The priority +/- UI SHALL reposition the element within the neural queue
(smaller position = higher priority), and the derived priority updates
accordingly. This mirrors SuperMemo's `FUN_00cb1630` and `FUN_00cb21c0`.

#### Scenario: Front element has highest priority
- **WHEN** the neural queue has 100 elements and an element sits at position 1
- **THEN** its derived priority is the minimum value (highest urgency)

#### Scenario: Priority buttons reposition
- **WHEN** the user clicks "increase priority" on an element at position 50
- **THEN** the element moves to a smaller position number
- **AND** its derived priority decreases (higher urgency)

### Requirement: Spreading activation combines via probabilistic OR

The neural-queue refill algorithm SHALL combine activation and link priorities
using the formula `f(x, y) = x + y - x * y` (probabilistic OR, bounded [0,1]),
matching SuperMemo's `FUN_00c17aa0`. The activation seed SHALL be the constant
`0.05` (SuperMemo's production value), not a value derived from the element's
learning state.

#### Scenario: Combine formula is bounded
- **WHEN** the algorithm combines activation 0.05 with link priority 0.95
- **THEN** the result is `0.05 + 0.95 - 0.0475 = 0.9525`
- **AND** the result is always within [0, 1]

#### Scenario: Zero link priority passes activation through
- **WHEN** descendants are propagated with link priority 0.0
- **THEN** the combined value equals the activation (0.05) unchanged

### Requirement: Propagation uses the SuperMemo link weights

The spreading-activation pass SHALL use the per-link-type weights extracted
from the orchestrator `FUN_00c19a30`: concept links 0.01, inter-element links
0.05, descendants 0.10, siblings 0.95 (normal) or 0.13 (root-article branch),
parent 0.99. Within the concept-link propagator, parent concepts use 0.4 and
child concepts 0.3. Within the sibling propagator, the link priority SHALL grow
by a factor of 1.1 per generation from an initial 0.3 (sibling "decay" that
increases with distance), up to 8 generations.

A root-article-aware branch SHALL choose the lower sibling weight (0.13) when
the seed element is a root article, and the higher weight (0.95) otherwise.

#### Scenario: Concept link weight
- **WHEN** spreading activation reaches a concept link from a concept-type seed
- **THEN** the link priority used is 0.01, combined with activation 0.05

#### Scenario: Sibling weight grows with distance
- **WHEN** activation spreads to the 4th sibling generation
- **THEN** the link priority is `0.3 * 1.1^4 = 0.4392` (approximately)

### Requirement: Propagation fires on neural-queue depletion

The spreading-activation pass SHALL run when the neural queue's remaining
(unstudied) elements fall below a threshold (default 20), seeded at the element
just studied. It SHALL NOT run on every grade or every render. This mirrors
SuperMemo's learning state-machine phase 3 ("feed next element from neural
queue" / "No more elements in the neural queue").

When the queue is still under the threshold after the initial pass, a recursive
layer-expansion SHALL re-seed from the newly-added elements until the threshold
is met or no more elements are reachable.

#### Scenario: Queue depletion triggers refill
- **WHEN** the user studies elements until fewer than 20 remain in the neural queue
- **THEN** a spreading-activation pass runs seeded at the most recently studied element
- **AND** its neighbors' positions are lowered (urgency raised) in the queue

#### Scenario: No refill on every grade
- **WHEN** the user grades a single flashcard and the queue still has more than 20 elements remaining
- **THEN** no spreading-activation pass runs
- **AND** only that flashcard's scheduling columns update

### Requirement: Update only lowers priority (monotonicity)

During a propagation pass, an element already in the neural queue SHALL be
updated only if the newly-combined priority is strictly lower than its current
value (lower = higher urgency). An element SHALL never be demoted (have its
priority raised) by a propagation pass. Multiple propagation paths to the same
element SHALL resolve to the lowest combined priority.

#### Scenario: Existing element not demoted
- **WHEN** a propagation path computes combined priority 0.6 for an element whose current priority is 0.4
- **THEN** the element's priority is unchanged (0.4 stays)

#### Scenario: Lower priority wins
- **WHEN** two propagation paths reach the same element with 0.5 and 0.3
- **THEN** the element's priority becomes 0.3

### Requirement: New queue elements SHALL combine activation with intrinsic priority

A new element reached by a propagation pass SHALL be inserted into the neural
queue with a priority that combines the spreading activation with the element's
intrinsic priority. The element's intrinsic priority is its current queue
position normalized to [0,1] (or the maximum-urgency default if it has no
position yet), fetched via the SuperMemo `intrinsic_priority(position, size)`
formula and divided by 100 before combining. This matches SuperMemo's
`FUN_00c18110` InsertOrUpdate new-element branch.
activation with the element's intrinsic priority (its current queue position
normalized to [0,1], or the maximum-urgency default if it has no position yet).
The intrinsic-priority term SHALL be fetched via the SuperMemo
`intrinsic_priority(position, size)` formula, then normalized by dividing by
100 before combining. This matches SuperMemo's `FUN_00c18110` InsertOrUpdate
new-element branch.

#### Scenario: New element added during refill
- **WHEN** a sibling not in the neural queue is reached by activation
- **THEN** it is inserted with a priority combining activation 0.05 with its intrinsic priority

### Requirement: The Scroll session is the front slice of the neural queue

The Scroll session SHALL present the front N elements of the neural queue (by
position), where N is governed by the composition targets (max session size).
Studying an element consumes it from the front. This unifies the "what to
study" and "in what order" answers into the single neural queue.

#### Scenario: Scroll session reflects queue order
- **WHEN** the neural queue's front 50 elements are a mix of documents, extracts, and cards in priority order
- **THEN** the Scroll session (sized by composition) presents them in that order
