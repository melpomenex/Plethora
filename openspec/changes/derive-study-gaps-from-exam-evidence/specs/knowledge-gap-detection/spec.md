## ADDED Requirements

### Requirement: Learning evidence persists final demonstrated outcomes with provenance

The system SHALL append one uniquely keyed evidence row per concept and evaluated response submission after a deterministic, AI or manual grade becomes Final. Evidence SHALL identify source kind/id, attempt/group, question fingerprint, score/outcome, misconception, hint level, grader origin, plan/node lineage, occurrence time and policy version. Superseding a grade SHALL adjust that existing evidence row transactionally instead of counting the answer twice. Cancelled/unsubmitted, failed, pending and needs-review grades SHALL NOT become final performance evidence.

#### Scenario: Objective and rubric outcomes become evidence

- **WHEN** a mixed attempt receives final objective scores and criterion-derived/manual-final free-response grades
- **THEN** each linked concept receives inspectable evidence tied to its immutable response submission/question revision and current grade

#### Scenario: Grade correction does not double-count

- **WHEN** a manual grade supersedes an AI result for the same response submission
- **THEN** the evidence source identity remains unique, score/outcome/provenance update atomically and historical AI judgment remains in grade history rather than as a second independent observation

#### Scenario: Failed grading produces no false evidence

- **WHEN** AI grading fails or a result is Needs Review
- **THEN** no final performance score/gap inference is derived from it, while the submitted learner answer remains available for retry/review

### Requirement: Superseded and deleted history is reconciled transactionally

Current-grade changes, official attempt totals, learning-evidence adjustments, affected summaries and gaps SHALL be reconciled atomically or through a restart-safe deterministic reconciliation pass. Explicit exam-history deletion SHALL remove its evidence/remediation links and recompute affected projections before confirming deletion, without touching library data, scheduled cards or review records.

#### Scenario: Historical deletion leaves no stale weak-topic claim

- **WHEN** a user permanently deletes the only attempt supporting a Repeated Failure gap
- **THEN** its evidence is removed and the affected summary/gap recomputed or marked insufficient/resolved before success is confirmed

#### Scenario: Upgrade reconciliation is idempotent

- **WHEN** pre-evidence exam history is reconciled in batches or retried after restart
- **THEN** unique source/concept keys prevent duplicate evidence and all final current grades are eventually represented

### Requirement: Historical comparisons describe evidence rather than prove equivalent learning gains

Attempt history SHALL show final scores, response/rubric provenance and evidence dates. Same blueprint-revision retakes MAY show a numeric score delta labelled as same-paper performance with memory/repetition caveats; cross-paper comparisons SHALL remain descriptive because difficulty and question sets differ. Improvement or decline SHALL NOT be inferred from unfinished attempts, null totals or a single sparse observation.

#### Scenario: Retake comparison is qualified

- **WHEN** the same paper receives 60% then 80% in two Final attempts
- **THEN** history shows +20 percentage points for that fixed paper and a repetition caveat, not a claim of 20% mastery gain

#### Scenario: Different papers avoid false equivalence

- **WHEN** scores differ across two distinct blueprint revisions
- **THEN** both are displayed with their configurations/evidence scope and no equivalent-difficulty or causal improvement claim is made

### Requirement: Remediation recommendations are actionable, optional and reversible

Every active evidence-based gap SHALL generate appropriate source-linked recommendation records for current source/extract, targeted practice/follow-up assessment, plan adjustment and, when Change 7 integration is available, tutor/card proposals. Recommendations SHALL carry concept/objectives/misconception/evidence summary and validated source refs. Users SHALL be able to accept, dismiss or complete a recommendation; dismissal/disposition SHALL persist. No recommendation SHALL auto-start inference, create a card, change the curriculum head or modify Queue/FSRS.

#### Scenario: Weak concept offers source-linked next steps

- **WHEN** an examined concept has two independently poor outcomes and current source evidence
- **THEN** the results/Plan view explains why and offers Open Source plus optional practice/follow-up/plan actions with the same refs and objectives

#### Scenario: Source unavailable limits remediation

- **WHEN** the cited source is missing or stale
- **THEN** remediation names that limitation and offers Find/choose material or plan review rather than pretending to open an exact current passage

#### Scenario: User rejection is honored

- **WHEN** a user dismisses a remediation or gap
- **THEN** it no longer shows as active unless materially new evidence after the suppression cutoff satisfies the documented re-emergence rule

## MODIFIED Requirements

### Requirement: Gap detection covers defined gap kinds with explicit rules

The system SHALL detect at least: weak prerequisite, missing concept, repeatedly failed, read-but-never-reviewed, disconnected cluster, and weak transfer via `evidence-v1` rules over final assessment outcomes, explicitly read review history, semantic/material coverage, confirmed graph relations and reading activity. Assessment-derived gap updates SHALL run deterministically after final-grade settlement; broader historical reading/review/graph scans SHALL be explicit local, bounded and restart-safe. Detection SHALL NOT interrupt active reading/review and SHALL NOT require an LLM or a continuously running background watcher.

#### Scenario: Weak prerequisite detected

- **WHEN** an actively studied dependent node Needs Attention and its DAG prerequisite has Needs Attention or insufficient demonstrated evidence with linked supporting outcomes
- **THEN** a weak_prerequisite gap is produced with the dependency edge and underlying evidence, while insufficient prerequisite evidence is labelled uncertain rather than proof of ignorance

#### Scenario: Weak prerequisite resolves or re-emerges from defined evidence

- **WHEN** the dependent no longer Needs Attention, the prerequisite earns a later independent group of at least 0.8 without unresolved misconception, or the relationship is removed
- **THEN** that relation's weak_prerequisite gap resolves without deleting evidence; if dismissed, only material evidence after its cutoff may re-surface it, and restoring a relation triggers a fresh evaluation rather than an unexplained permanent gap

#### Scenario: Read-never-reviewed surfaces

- **WHEN** a document was fully read 30+ days ago and produced no extracts, cards or reviews and the user invokes/refreshes local gap analysis
- **THEN** a read_never_reviewed gap lists the document with its activity evidence without changing the user's schedule

#### Scenario: One wrong answer is insufficient for repeated failure

- **WHEN** a concept receives its first low-scoring answer
- **THEN** its summary remains insufficient-evidence and no repeatedly_failed gap is created until the independent-session/review-lapse rule is actually satisfied

#### Scenario: Transfer requires distinct evidence classes

- **WHEN** recall/comprehension and application/multi-step outcomes are present but only one has at least two independent evidence groups
- **THEN** weak_transfer does not fire; the missing comparison class is shown as insufficient evidence rather than inferred weakness

### Requirement: Every gap is explainable and disputable

Each gap SHALL carry its exact rule id, evidence records (review results with text ids, unreviewed chunks, confirmed graph edges with citations or final assessments), affected plan/node lineage and current uncertainty reasons. Users SHALL be able to inspect every source/record, open current evidence when available and suppress a gap as not-applicable. Suppression SHALL persist with an evidence cutoff. A gap SHALL reappear only when later materially new evidence satisfies that rule; dismissal SHALL never erase or rewrite the underlying learner/review history.

#### Scenario: Evidence resolves

- **WHEN** the user opens Why for a repeatedly-failed gap
- **THEN** the two independent failing groups or applicable review-lapse events are listed with source links and rule thresholds, not an unexplained score

#### Scenario: Suppression honored

- **WHEN** a user suppresses a gap and no new evidence after its cutoff arrives
- **THEN** it remains absent from active surfaces; a later independent outcome after that cutoff may be evaluated and re-surface it with the new evidence visible

#### Scenario: Contradictory evidence remains inspectable

- **WHEN** recent success conflicts with earlier failure
- **THEN** the UI lists both outcomes, dates/repetition/grader/hints and uncertainty reasons instead of hiding history behind one scalar

### Requirement: Mastery estimates express uncertainty

Plethora SHALL present conservative concept evidence states—`insufficient-evidence`, `needs-attention`, `developing` and `demonstrated-consistently`—under deterministic `evidence-v1` thresholds instead of claiming a calibrated probability or exact “percent mastery”. Any displayed observed mean SHALL be labelled weighted observed performance, accompanied by independent-session/day/fingerprint counts and uncertainty reasons. Only final assessment outcomes feed this performance measure. Content coverage, reading activity and AI self-confidence SHALL NOT raise it; FSRS review lapses are separate supporting gap evidence and FSRS scheduling remains user-controlled. Weighting SHALL use documented base/repetition/recency/hint/AI adjustments and SHALL NOT be described as statistical independent sample size or calibrated variance.

#### Scenario: Estimate reflects evidence strength

- **WHEN** sparse evidence from one assessed session is shown
- **THEN** level is insufficient-evidence with one-independent-session/few-independent-sessions reasons, even if its answer was correct

#### Scenario: Repeated response is not independent mastery proof

- **WHEN** the same fingerprint is answered successfully in repeated groups
- **THEN** later same-question groups receive the 0.25 repeat weight and same-question-repetition uncertainty is shown

#### Scenario: Consistent demonstration has strict criteria

- **WHEN** three independent sessions over at least two UTC days each score at least 0.8, cover at least three distinct question fingerprints, include deterministic/manual evidence and have no unresolved latest misconception
- **THEN** the level may be demonstrated-consistently while retaining recency/grader/difficulty limitations and avoiding certainty language

### Requirement: Local-first with capability-gated model analysis

Evidence folding, gap detection, suppression, history and source/plan-linked recommendation generation SHALL run locally without a model for all users. They SHALL operate incrementally after grade settlement or by explicit bounded local historical refresh, honoring feature/source exclusions. Optional future model-assisted wording MAY run through the existing `knowledge_gap_detection` feature/provider/destination controls over compact evidence summaries only, never raw library text, and SHALL NOT change rule outcomes or require cloud access. No remote fallback SHALL occur without separate consent.

#### Scenario: Evidence summaries only

- **WHEN** an optional cloud gap-wording/analysis run is explicitly authorized
- **THEN** payloads contain bounded aggregated evidence metadata and no full document text, and deterministic gap points/rules remain application-computed

#### Scenario: Offline gaps are fully usable

- **WHEN** the device has no network or configured AI provider after final grades are already stored
- **THEN** evidence states, uncertainty, gaps, history and local source/remediation actions still update and render normally
