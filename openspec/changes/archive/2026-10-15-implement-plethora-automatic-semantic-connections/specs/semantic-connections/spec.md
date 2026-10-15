## ADDED Requirements

### Requirement: Connection suggestions are evidence-backed proposals
Every surfaced connection SHALL carry structured evidence: relation type, both endpoint citations (`RagCitation`), confidence, and optional context facts (temporal gap, related-card count, queue hits). Suggestions SHALL be proposals (accept/dismiss/snooze) — nothing is silently written into the user's knowledge structures.

#### Scenario: Evidence renders precisely
- **WHEN** a suggestion with temporal gap 7 months and 4 related cards is displayed
- **THEN** the statement shown matches the facts ("encountered 7 months ago… four related cards") and each claim links to its source

### Requirement: Discovery respects budgets and deduplication
Discovery SHALL be bounded: hard per-document daily cap (default 5, user-tunable 0–20) and the global AI-links-per-day budget. Dismissed pairs SHALL be fingerprint-blocked from re-proposal. Discovery work SHALL be asynchronous and never on the reading render path.

#### Scenario: Cap enforced across triggers
- **WHEN** reader-dwell, highlight, and idle triggers fire repeatedly for one document in a day
- **THEN** accepted+dismissed+pending suggestions for that document never exceed the cap

#### Scenario: Dismissal is permanent per pair
- **WHEN** the user dismisses a document↔document contradicts suggestion
- **THEN** that pair is never re-proposed (fingerprint check)

### Requirement: Surfacing is calm and contextual
Connection UI SHALL be collapsed-by-default margin affordances (bird-marked, count-badged), never modals or auto-expansions, suppressed during active review sessions and focus timer, with an e-ink-appropriate static variant and keyboard/palette access. A Connections inbox SHALL list suggestions with accept/dismiss/snooze and an accepted-connections history.

#### Scenario: No interruption during review
- **WHEN** a review session is active
- **THEN** connection affordances do not update or animate and emit no prompts

### Requirement: Local execution remains available; cloud is capability-gated
On-device (Nano) or BYO-provider discovery SHALL function without any subscription. Model-based cloud discovery SHALL require the `semantic_connections` capability, run as jobs with quotas, honor AI-exclusion flags, and disclose what content leaves the device.

#### Scenario: Free user gets retrieval-based connections
- **WHEN** a Free user reads with local embeddings indexed
- **THEN** similarity-based suggestions still surface (model-based route marked unavailable with reason)

### Requirement: Accepted connections enrich shared structures
Accepting a suggestion SHALL persist it through the concept-link store (typed relation + provenance) available to the knowledge graph (proposal 9) and gap detection (proposal 10) via existing commands/events; accept/dismiss are user-only actions.

#### Scenario: Acceptance visible in graph inputs
- **WHEN** a suggestion is accepted
- **THEN** `connection-accepted` fires and the relation is queryable by graph extraction
