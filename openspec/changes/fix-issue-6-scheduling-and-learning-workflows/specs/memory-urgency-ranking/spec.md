## Purpose

Provide bounded, explainable queue urgency while keeping scheduling dates, factual recall evidence, and user importance separate.

## ADDED Requirements

### Requirement: Normalized memory urgency has independent temporal and manual inputs
Queue memory urgency SHALL be `M=0.8T+0.2P`, with finite T and P in [0,1]. P SHALL be canonical current positional importance, higher meaning more important. Manual importance SHALL enter this score exactly once and SHALL NOT modify temporal readiness, recall probability, or a scheduling interval. These coefficients SHALL be documented as initial product heuristics.

#### Scenario: Manual ranks vary with scheduling fixed
- **WHEN** identical items have P values 0, .25, .5, .75, and 1 with the same T
- **THEN** their M values increase in steps of .05 and remain finite in [0,1]
- **AND** their temporal terms and due dates remain identical

#### Scenario: Equal importance with different memory states
- **WHEN** two items have the same P and different valid scheduling evidence
- **THEN** the score difference depends only on T and contains no additional slider, rating, or priority-score multiplier

### Requirement: Overdue readiness is monotone and bounded
For valid due timestamps at or before the ranking instant, the system SHALL compute fractional overdue days `d=max(0,(now-due)/86400 seconds)` and `O=-expm1(-d/14)`, with readiness `A=.5+.5O`. Exact equality SHALL be due with O=0. Missing/invalid dates SHALL NOT receive maximum overdue credit. Extreme values SHALL saturate safely without NaN or infinity.

#### Scenario: Due and overdue boundaries
- **WHEN** lateness is 0, 1, 7, 14, 30, 90, and 300 days at a fixed clock
- **THEN** O is respectively approximately 0, .068937, .393469, .632121, .882681, .998385, and 1
- **AND** increasing lateness never decreases A or M with other inputs fixed

#### Scenario: Future and missing dates
- **WHEN** an item is due later today, genuinely new without a due date, or has an invalid date
- **THEN** none is classified as maximally overdue and each uses its documented type-specific fallback

### Requirement: Temporal evidence respects item semantics
Rotational documents and text/video extracts SHALL use T=0 for future due, T=A for due/overdue, and T=.5 for new or unavailable scheduling state. Recall cards SHALL use valid scheduler retrievability r at the ranking instant: T=1-r for future-due cards, T=max(1-r,A) for due cards, and T=.5 for genuinely new/unavailable-date cards. With missing recall evidence, future cards SHALL use T=0 and due cards T=A. Non-finite or out-of-range recall evidence SHALL be unavailable. Recall evaluation SHALL use actual last-review timing, not elapsed-since-due. Document stability/difficulty bonuses SHALL NOT separately alter ranking.

#### Scenario: Document memory bonuses do not duplicate timing
- **WHEN** document due date and P are fixed while stability and difficulty vary
- **THEN** M remains unchanged and the stored scheduler memory remains intact

#### Scenario: Due card with weak recall
- **WHEN** a card has r=.2, is due exactly now, and P=.5
- **THEN** T=.8 and M=.74

#### Scenario: Missing memory and invalid numeric data
- **WHEN** scheduling evidence contains missing stability, NaN, infinity, or invalid retrievability
- **THEN** the system uses the documented available-date fallback, records unavailable evidence, and returns a finite bounded M

### Requirement: Ranking remains separate from rescheduling
Ranking and priority changes SHALL NOT write due dates, review histories, counts, FSRS state, or interval modifiers. Document rotation and flashcard review histories SHALL remain independent. Opening material SHALL NOT constitute a rated recall event.

#### Scenario: Ranking a large backlog
- **WHEN** a queue of new, due, future, and extremely late items is ranked repeatedly
- **THEN** only ordering/diagnostics change and every persisted scheduling field remains byte-equivalent

### Requirement: Queue strategies expose the same authoritative urgency
Adaptive Ranking SHALL use M once inside its existing weighted score. SRS-only selection SHALL preserve due/new/future eligibility buckets and use the same M within buckets. Bare priority sorting SHALL retain positional ordering. An already ranked queue SHALL NOT receive another priority-containing ranking pass in session composition. Equal-score pool ordering SHALL be deterministic across input permutations, using due date then stable entity identity; active sessions SHALL preserve their current identity during refresh.

#### Scenario: Explainable outer contribution
- **WHEN** the adaptive memory weight is .4 and P changes from 0 to 1 with all other evidence fixed
- **THEN** the final adaptive score changes by .08

#### Scenario: Stable comparisons and session mixing
- **WHEN** the same candidate pool arrives in different source orders or enters Scroll Mode from a ranked list
- **THEN** equal-score ordering is deterministic and list-order mode preserves the returned list sequence

### Requirement: Backlog behavior is measurable without suppressing new work
With other adaptive terms equal, a new top-priority document SHALL outrank a seven-day-overdue bottom-priority document in mixed ranking. A severely overdue low-priority document SHALL be able to outrank a recently reviewed future-due high-priority document. Existing new/review budgets SHALL continue to admit their configured classes; consuming a finite pool without replacement SHALL drain it without resurrecting completed identities.

#### Scenario: Important new work is reachable
- **WHEN** new P=1 and seven-day-late P=0 documents compete in mixed ranking
- **THEN** their M values are .6 and approximately .557388 respectively

#### Scenario: Ancient backlog has bounded influence
- **WHEN** lateness grows from 90 to hundreds of days
- **THEN** urgency approaches its finite ceiling without reducing urgency or changing the due date
