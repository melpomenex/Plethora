## ADDED Requirements

### Requirement: Plan progress separates material, activity and demonstrated evidence

Each Study Plan node view SHALL independently present material coverage/source status, study activity, and assessment-derived demonstrated evidence/uncertainty. It SHALL NOT combine these into a single progress or mastery percentage. Reading/finished activity and supported material SHALL NOT substitute for demonstrated evidence; assessment evidence SHALL NOT rewrite study activity without explicit user policy/action. Nodes with sparse or absent assessment data SHALL say so directly.

#### Scenario: Read but unassessed topic

- **WHEN** all current sources for a node are covered/read and its activity is Completed but there is no final assessment evidence
- **THEN** coverage/activity show their states while demonstrated evidence is insufficient-evidence/Not assessed, not Complete mastery

#### Scenario: Assessed but unfinished study activity

- **WHEN** a user performs well on an assessment topic but has not finished the linked reading/activity
- **THEN** demonstrated evidence is visible independently and study activity is not automatically changed to Completed

#### Scenario: Concept correction refreshes weak-topic guidance

- **WHEN** a current grade is superseded or later independent successful evidence settles
- **THEN** node evidence/gaps/remediation update from the unique adjusted/new evidence and the UI exposes the reason for any status change

### Requirement: Gap evidence never mutates plan/scheduler authority without review

A learning-gap or evidence-derived plan suggestion SHALL produce only a new reviewable Draft/diff or blueprint/remediation proposal. It SHALL NOT publish/reorder/delete/lock plan nodes automatically, alter review ratings/scheduling, Queue membership/order or user priority, or create flashcards without the learner's explicit action through existing owners.

#### Scenario: Weak prerequisite suggests a draft

- **WHEN** a user chooses Plan Adjustment on a weak prerequisite
- **THEN** a new source-linked Draft proposes the prerequisite emphasis/order with a diff and requires review, while the current published plan and scheduler remain unchanged

## MODIFIED Requirements

### Requirement: Progress is signal-based and honest

Node progress SHALL derive from separate existing reading/extract/card activity, content coverage, and final assessment evidence under `evidence-v1`; these signals SHALL remain independently labeled rather than becoming weighted activity/mastery composites. Path completion SHALL require terminal-node `demonstrated-consistently` evidence or an explicit user declaration of completion shown as such. A numeric targetMastery, reading activity, material coverage or AI self-confidence alone SHALL NOT complete a node/path. Sparse evidence SHALL remain insufficient rather than satisfying an implied target.

#### Scenario: Reading alone doesn't complete nodes

- **WHEN** a user reads all node sources but creates no cards, completes no demonstrated assessment evidence, and makes no explicit declaration
- **THEN** nodes do not auto-complete from reading and the UI shows study/reading separately from insufficient demonstrated evidence

#### Scenario: User declaration is explicit rather than false mastery

- **WHEN** a user deliberately declares a node/path complete without demonstrated-consistently evidence
- **THEN** the activity records user-declared completion and results still show the independent evidence state/uncertainty rather than implying proven understanding
