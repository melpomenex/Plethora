## Purpose

Defines the deterministic composite ranker that decides the order of items in a
session: one auditable score built from five separately-inspectable terms —
spaced-repetition urgency, goal relevance, energy fit, an interleaving penalty,
and a friction penalty — with every term normalized to a common range so no
single term can silently dominate.

## ADDED Requirements

### Requirement: Composite queue score uses five normalized terms

The system SHALL compute one composite score per candidate item on every queue
re-sort:

`S(i) = w_srs · R_srs(i) + w_goal · M_relevance(i) + w_fit · M_energy_fit(i, K_energy) − P_interleave(i, H_recent) − P_friction(i)`

Each of the five terms SHALL be normalized to `[0,1]` **before** its weight is
applied, and the weights SHALL be the user-configured knob values. The two
penalty terms SHALL be subtracted, never weighted. `R_srs(i)` SHALL be derived
from the item's scheduling state (retrievability and due-date urgency) and
SHALL NOT be a per-item-type constant. Candidates SHALL be ordered by `S(i)`
descending, with deterministic tie-breakers (existing queue position, then item
id) so an unchanged pool always yields an unchanged order.

#### Scenario: Urgency outranks a slightly better-fitting item

- **GIVEN** item A is overdue with low retrievability and item B is due today but far above the energy target
- **AND** `srsDecayWeight` is high and `energyTarget` is set low
- **THEN** A SHALL be ordered ahead of B
- **AND** the reason SHALL be attributable to the `R_srs` term, not to any other term

#### Scenario: Equal scores order deterministically

- **GIVEN** two candidate items produce byte-identical `S(i)` values
- **WHEN** the queue is re-sorted twice with no intervening study, postpone, or reprioritise
- **THEN** both sorts SHALL produce the same order
- **AND** the tie SHALL be broken by existing queue position and then item id

#### Scenario: Ranking never mutates scheduling state

- **WHEN** any item is ranked under any knob configuration
- **THEN** no scheduler field — stability, difficulty, interval, due date, lapses, or memory state — SHALL be modified

### Requirement: Every term is inspectable, never a meaning-less composite

The ranker SHALL return, alongside each item's total `S(i)`, the value and
signed weight of all five terms, plus the recent-history window and item
attributes that fed them. No ranking surface SHALL display a bare total score
without the ability to reveal its components.

#### Scenario: Score breakdown is available for any ranked item

- **WHEN** a user inspects why an item was placed at a given queue position
- **THEN** the five term values and their applied weights SHALL be shown
- **AND** the interleaving penalty SHALL name the recent items it was measured against

#### Scenario: Terms derived from unavailable signals are marked, not invented

- **WHEN** a term could not be computed because its input signal is absent (for example no decision model is available to produce a complexity tier)
- **THEN** that term SHALL be reported as unavailable with its neutral value
- **AND** it SHALL NOT be presented as a measured value

### Requirement: Energy fit measures distance from the user's energy target

`M_energy_fit(i, K_energy)` SHALL be computed as
`1 − |ItemComplexity(i) − K_energy| / 4`, where `ItemComplexity(i)` is a
complexity value on the same `1..5` scale as the `energyTarget` knob and
`K_energy` is the effective energy target. The result SHALL be clamped to
`[0,1]`. When no decision model supplies a complexity value, a deterministic
per-item-type default complexity SHALL be used and the term SHALL be marked as
defaulted.

#### Scenario: Complexity exactly at the energy target

- **GIVEN** an item whose complexity is 4 and an effective `energyTarget` of 4
- **THEN** `M_energy_fit` SHALL be `1.0`

#### Scenario: Maximum distance from the energy target

- **GIVEN** an item whose complexity is 1 and an effective `energyTarget` of 5
- **THEN** `M_energy_fit` SHALL be `0.0`

#### Scenario: Effective energy target is lowered by measured fatigue

- **GIVEN** reading velocity has fallen below 40% of the user's historical baseline over the measured window
- **WHEN** the queue is re-ranked
- **THEN** the effective energy target SHALL be reduced below the user's configured `energyTarget`
- **AND** the breakdown SHALL report the effective target and the reason it differs from the configured one

#### Scenario: Deterministic complexity fallback with no decision model

- **GIVEN** no decision model provider is available
- **WHEN** an item is ranked
- **THEN** a fixed per-item-type default complexity SHALL be used
- **AND** the `M_energy_fit` term SHALL be reported as defaulted rather than measured

### Requirement: Interleaving penalty measures topic similarity to recent items

`P_interleave(i, H_recent)` SHALL be derived from the similarity between item
`i` and the items in the recent session history window `H_recent`, and SHALL be
scaled by the `interleavingDiversity` knob. Raising `interleavingDiversity`
SHALL monotonically increase the penalty applied to an item whose topic closely
matches recently reviewed items, and SHALL leave the penalty of an item with no
topic overlap unchanged. The penalty SHALL NOT reorder items across item-type
composition boundaries established by session composition.

#### Scenario: Repeating the same topic is penalised

- **GIVEN** the last three reviewed items in the session all share a topic with candidate item `i`
- **WHEN** `interleavingDiversity` is raised above its default
- **THEN** `i`'s `P_interleave` SHALL increase relative to its value at the default
- **AND** `i` SHALL be ordered later than a topic-dissimilar candidate with an otherwise equal `S(i)`

#### Scenario: Novel topic is never penalised

- **GIVEN** candidate item `i` shares no topic with any item in `H_recent`
- **THEN** `P_interleave` SHALL be `0.0` regardless of the `interleavingDiversity` value

#### Scenario: Composition boundaries are respected

- **GIVEN** session composition requires a specific number of documents, extracts, and flashcards
- **WHEN** the interleaving penalty is applied
- **THEN** it SHALL NOT cause any item type's composed quota to be violated

### Requirement: Friction penalty accrues from resistance signals

`P_friction(i)` SHALL accrue from the item's observed resistance history:
repeated postponements, long idle periods without interaction, and reviews that
were abandoned or completed with minimal dwell. `P_friction` SHALL be scaled by
the `pruningAggressiveness` knob, SHALL be bounded to `[0,1]`, and SHALL be
derived only from recorded telemetry — never from a per-item-type constant.

#### Scenario: Frequently postponed item is pushed down

- **GIVEN** candidate item `i` has been postponed three or more times in the current window
- **WHEN** the queue is re-ranked with `pruningAggressiveness` above its default
- **THEN** `i`'s `P_friction` SHALL be strictly greater than that of an item with no postponements
- **AND** `i` SHALL be ordered after that item when all other terms are equal

#### Scenario: Long idle dwell counts as resistance

- **GIVEN** candidate item `i` accumulated `idleTimeMs` greater than `activeDwellMs` across its recorded sessions
- **THEN** `P_friction` SHALL include a contribution from that imbalance

#### Scenario: No telemetry means no friction

- **GIVEN** candidate item `i` has no recorded dwell, postponement, or abandonment history
- **THEN** `P_friction` SHALL be `0.0` rather than an imputed default

### Requirement: Ranking is non-blocking and bounded by a latency budget

Queue re-ranking SHALL NOT execute on the UI thread. Ranking SHALL run
asynchronously, and the ranked order for the next ten items SHALL be available
within 150 ms of a queue rebuild request on the reference fixture. A queue SHALL
render its previously known order rather than an empty state while a re-rank is
in flight, and SHALL update when the re-rank completes.

#### Scenario: Queue is usable before ranking finishes

- **GIVEN** a queue rebuild triggers a full adaptive re-rank
- **WHEN** the user views the queue during the re-rank
- **THEN** the previously ranked order SHALL still be displayed
- **AND** the re-ranked order SHALL replace it on completion

#### Scenario: Top ten within budget

- **WHEN** a queue rebuild is requested on the reference due-candidate fixture
- **THEN** the ranked order for the first ten items SHALL be available within 150 ms

### Requirement: Ranking degrades deterministically when inputs are unavailable

The ranker SHALL produce a valid ordering under every partial-failure
condition, and SHALL never surface an error to the queue for a missing or
failing input. When a term's input is unavailable, the term SHALL take its
documented neutral value: `M_relevance` and `M_energy_fit` fall back to
deterministic local values, `P_interleave` to `0.0`, and `P_friction` to `0.0`.
With **every** non-SRS term neutral, ordering SHALL reduce exactly to the
existing due-first, priority-descending, due-date-ascending sort.

#### Scenario: All knobs at zero

- **GIVEN** every weight knob is set to `0.0`
- **WHEN** the queue is re-ranked
- **THEN** ordering SHALL be produced by the SRS term alone
- **AND** the result SHALL match the pre-DAQE due-first ordering

#### Scenario: Decision model offline

- **GIVEN** the configured decision model is unreachable, failing, or exceeding its timeout
- **WHEN** the queue is re-ranked
- **THEN** ranking SHALL complete using local fallbacks for the affected terms
- **AND** no error SHALL be surfaced to the queue surface

#### Scenario: Cache unavailable or cold

- **GIVEN** the decision-model cache is empty, unreadable, or missing entries
- **WHEN** the queue is re-ranked
- **THEN** ranking SHALL complete with deterministic local fallbacks
- **AND** a cache read failure SHALL NOT block the ranking

### Requirement: Knob changes re-rank without touching the pool

Changing any ranking knob SHALL re-rank the existing due-candidate pool
in place. It SHALL NOT change which items are eligible (session membership),
SHALL NOT change FSRS memory state, and SHALL NOT require a database write to
any scheduler table.

#### Scenario: Knob change preserves membership

- **GIVEN** a session composed of a fixed set of items
- **WHEN** the user changes `goalRelevance`
- **THEN** the session's item set SHALL be identical before and after
- **AND** only the order SHALL change

### Requirement: Adaptive learning updates priors without model fine-tuning

The engine SHALL adjust item priors and session context from telemetry, with no
model retraining or fine-tuning. A high `activeDwellMs` combined with a high
extraction rate SHALL raise the priority contribution of the item's collection
and its semantic cluster. Repeated rapid skips, or `idleTimeMs` dominating
`activeDwellMs` without interaction, SHALL raise a `split-candidate` or
`auto-demote` recommendation flag. Each recommendation flag SHALL record the
telemetry evidence that raised it, SHALL be dismissible by the user, and SHALL
NOT by itself remove or dismiss an item.

#### Scenario: High engagement promotes a cluster

- **GIVEN** item `i` shows high `activeDwellMs` and at least one extract created from it
- **WHEN** the queue is next re-ranked
- **THEN** other items in `i`'s collection and semantic cluster SHALL receive a raised priority contribution
- **AND** the promotion SHALL be attributable to recorded telemetry

#### Scenario: Resistance raises a recommendation flag

- **GIVEN** item `i` was skipped repeatedly, or shows `idleTimeMs` exceeding `activeDwellMs` with no interaction
- **WHEN** the queue is next re-ranked
- **THEN** a `split-candidate` or `auto-demote` flag SHALL be raised with its supporting evidence attached
- **AND** the user SHALL be able to dismiss the flag
- **AND** the item SHALL NOT be removed from the library

#### Scenario: Velocity collapse lowers effective energy target

- **GIVEN** the user's reading velocity over the measured window has fallen below 40% of their historical baseline
- **WHEN** the queue is next re-ranked
- **THEN** the effective energy target SHALL be reduced below the configured `energyTarget`
- **AND** the user's configured value SHALL be preserved unchanged