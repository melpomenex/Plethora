## ADDED Requirements

### Requirement: Maintenance findings derive from review evidence
Detectors SHALL identify at least: failing-streak wording suspects, excessive-effort complexity, same-fact groups, definition-vs-application splits, stale sources, and orphaned concept links — each backed by inspectable evidence (review records, similarity clusters, source lineage). Detection SHALL be bounded background work and SHALL NOT alter review history or scheduling.

#### Scenario: Failing card flagged with evidence
- **WHEN** a card fails 4+ times with declining stability
- **THEN** a rewrite proposal appears listing the exact failed reviews as evidence

### Requirement: Proposals never silently modify user knowledge
All maintenance actions (rewrite, split, merge, retire, generate variants, flag outdated, clarify) SHALL require explicit confirmation. Auto-apply MAY exist only as an opt-in per-kind setting, default off for all kinds, and retire/merge SHALL never auto-apply under any configuration.

#### Scenario: Default configuration is propose-only
- **WHEN** proposals accumulate with default settings
- **THEN** no card content or state changes until the user applies each proposal

### Requirement: Rewrites preserve history via version lineage
Applying a rewrite or split SHALL create new card versions linked to predecessors (`supersedes`), preserving all prior review records and scheduling truth. Merges SHALL union provenance. Retirement SHALL be reversible (suspend + archive).

#### Scenario: History survives a rewrite
- **WHEN** a rewrite is applied to a card with 120 review records
- **THEN** those records remain intact and the new version links to the old, which is superseded-not-deleted

### Requirement: Dismissal is fingerprinted and time-bounded snooze exists
Dismissed proposals SHALL not re-appear unless materially new evidence fires; snooze windows SHALL be honored. Batch review SHALL exist for same-fact groups.

#### Scenario: Dismissal sticks
- **WHEN** a user dismisses a same-fact group proposal
- **THEN** it is not re-proposed at the next analysis pass without new failing evidence

### Requirement: Session surfaces are minimal
Deck-health surfaces SHALL NOT interrupt active review; at most one post-session summary line per session. E-ink-appropriate text rendering SHALL exist for proposal views.

#### Scenario: Clean session
- **WHEN** maintenance findings exist during a review session
- **THEN** nothing appears mid-session and at most one summary line after

### Requirement: Rule-based detection is free; model drafts are capability-gated
Deterministic detection SHALL run locally for all users. Model-assisted drafts (rewrites, splits, application/prerequisite variants) SHALL run via BYO/on-device backends or, under `card_optimizer`, as quota-bounded cloud jobs with disclosed data flow and exclusion enforcement.

#### Scenario: Free user gets findings without drafts
- **WHEN** a Free user runs deck health with no AI configured
- **THEN** rule-based findings appear; model-drafted content marks unavailable with reason
