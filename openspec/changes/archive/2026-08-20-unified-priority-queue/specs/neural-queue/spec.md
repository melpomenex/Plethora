## ADDED Requirements

> This capability is Plethora's **neural queue** — the optional "Go neural"
> creative-exploration mode that builds a review sequence by **spreading
> activation** through the knowledge tree. It is distinct from the
> [`priority-queue`](../priority-queue/spec.md) capability (the backbone of
> normal incremental reading). The neural queue **reads intrinsic priority
> from the priority queue** as one input to the formula below.

### Requirement: Neural review is an opt-in mode layered on the priority queue

The neural queue SHALL be an opt-in review mode (Plethora's *Learn : Go
neural*), not the default learning flow. Normal learning SHALL continue to use
the priority queue. Entering neural review SHALL build a neural queue by
spreading activation from a seed element; exiting SHALL return to the priority
queue without mutating it.

#### Scenario: Neural review is opt-in
- **WHEN** the user is learning normally
- **THEN** the session is ordered by the priority queue, not by spreading activation
- **AND** no neural queue is built or consumed

#### Scenario: Entering Go neural builds the queue
- **WHEN** the user invokes neural review on the current element
- **THEN** a neural queue is built by spreading activation seeded at that element
- **AND** the neural review session presents that queue's order

### Requirement: Spreading activation combines via probabilistic OR

The neural-queue build algorithm SHALL combine activation and link priorities
using the formula `f(x, y) = x + y - x * y` (probabilistic OR, bounded [0,1]),
matching Plethora's `FUN_00c17aa0`. The activation seed SHALL be the constant
`0.05` (Plethora's production value), not a value derived from the element's
learning state.

#### Scenario: Combine formula is bounded
- **WHEN** the algorithm combines activation 0.05 with link priority 0.95
- **THEN** the result is `0.05 + 0.95 - 0.0475 = 0.9525`
- **AND** the result is always within [0, 1]

#### Scenario: Zero link priority passes activation through
- **WHEN** descendants are propagated with link priority 0.0
- **THEN** the combined value equals the activation (0.05) unchanged

### Requirement: Propagation uses the Plethora link weights

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

### Requirement: Propagation uses the four relationship types

The spreading-activation pass SHALL propagate through the four relationship
types, in the order documented in `neural_queue_algorithm.md`: concept links,
inter-element links, descendants (max 22), then parent and siblings
(root-article-aware). Each propagation calls InsertOrUpdate, which combines
activation with the link weight via probabilistic OR.

#### Scenario: Descendants receive full activation
- **WHEN** activation spreads to descendants
- **THEN** they are propagated with link priority 0.0
- **AND** therefore receive the full activation value (0.05) unchanged

#### Scenario: Propagation order
- **WHEN** a spreading-activation pass runs
- **THEN** concept links propagate before inter-element links, before descendants, before siblings

### Requirement: Neural-queue depletion triggers refill

The spreading-activation pass SHALL run when the neural queue's remaining
(unstudied) elements fall below a threshold (default 20), seeded at the element
just studied. It SHALL NOT run on every grade or every render.

When the queue is still under the threshold after the initial pass, a recursive
layer-expansion SHALL re-seed from the newly-added elements until the threshold
is met or no more elements are reachable.

#### Scenario: Queue depletion triggers refill
- **WHEN** the user studies elements in neural review until fewer than 20 remain in the neural queue
- **THEN** a spreading-activation pass runs seeded at the most recently studied element
- **AND** its neighbors are inserted into the neural queue

#### Scenario: No refill on every grade
- **WHEN** the user grades a single flashcard in neural review and the neural queue still has more than 20 elements remaining
- **THEN** no spreading-activation pass runs
- **AND** only that flashcard's scheduling columns update

### Requirement: Update only lowers neural-queue position (monotonicity)

During a propagation pass, an element already in the neural queue SHALL be
updated only if the newly-combined priority is strictly lower than its current
value (lower = earlier position = higher urgency). An element SHALL never be
demoted by a propagation pass. Multiple propagation paths to the same element
SHALL resolve to the lowest combined priority.

#### Scenario: Existing element not demoted
- **WHEN** a propagation path computes combined priority 0.6 for an element whose current priority is 0.4
- **THEN** the element's priority is unchanged (0.4 stays)

#### Scenario: Lower priority wins
- **WHEN** two propagation paths reach the same element with 0.5 and 0.3
- **THEN** the element's priority becomes 0.3

### Requirement: New neural-queue elements combine activation with intrinsic priority

A new element reached by a propagation pass SHALL be inserted into the neural
queue with a priority that combines the spreading activation with the element's
intrinsic priority. The intrinsic priority SHALL be read from the
[priority queue](../priority-queue/spec.md) (the element's user-set priority
normalized to [0,1]), or the maximum-urgency default if the element has no
priority-queue position yet. This matches Plethora's `FUN_00c18110`
InsertOrUpdate new-element branch.

#### Scenario: New element added during refill
- **WHEN** a sibling not in the neural queue is reached by activation
- **THEN** it is inserted with a priority combining activation 0.05 with its priority-queue-derived intrinsic priority

#### Scenario: Element with no priority-queue position
- **WHEN** a reached element has no position in the priority queue
- **THEN** it is inserted with the maximum-urgency default combined with the activation
