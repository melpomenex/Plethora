## ADDED Requirements

### Requirement: Study plans are durable native artifacts

The system SHALL persist a Study Plan, its plan-owned learning goal, resolved source scope, logical node identities, draft/published versions and activity in the existing native SQLite database. The UI SHALL confirm a create/save/publish action only after its transaction commits, and SHALL reopen the same artifacts after application restart without an AI provider or network. The old localStorage path payload SHALL NOT remain a second writable authority.

#### Scenario: Manual plan survives restart

- **WHEN** a user creates and publishes a plan containing a goal, source-linked nodes and objectives and restarts Plethora
- **THEN** Study Plans reopens the same plan version, nodes, source links, lock flags and activity without inference

#### Scenario: Failed save is not acknowledged

- **WHEN** SQLite rejects or fails a draft-save transaction
- **THEN** the UI reports a retryable storage failure and does not mark the draft as saved or advance its revision

#### Scenario: Native storage is unavailable

- **WHEN** Study Plans runs where its native commands/storage are unsupported, including an unimplemented browser backend
- **THEN** the destination explains that durable Study Plans are unavailable and does not present a successful empty/default write

### Requirement: Users can author and edit source-linked curricula without AI

The system SHALL provide manual controls to create a goal; select documents, extracts, collections and tags; choose depth; add/edit/remove topics and objectives; associate current source evidence; add/remove prerequisites; reorder within dependency-safe bounds; lock topics; explicitly set study activity; preview a diff; and save/publish the plan. Every published grounded node SHALL carry at least one validated source reference. Unsupported/custom nodes SHALL be visibly marked and SHALL NOT carry fabricated evidence.

#### Scenario: Complete manual authoring flow

- **WHEN** a user with AI disabled selects two library documents and manually authors a sourced curriculum
- **THEN** the user can preview, publish, reopen, edit and navigate each supported source without provider configuration

#### Scenario: User removes and locks topics

- **WHEN** a user removes one topic and locks another before saving
- **THEN** the removed topic remains as an excluded tombstone for future draft preservation and the locked topic's content and lock status survive restart

#### Scenario: Empty or invalid objective

- **WHEN** a included node has an empty title, no learning objective, or more than the shared bounds
- **THEN** draft validation identifies the exact fields and publication is refused until corrected

### Requirement: Prerequisite graphs reject invalid structure and order deterministically

Study Plan prerequisites SHALL form a directed acyclic graph over included logical nodes in the same version. The system SHALL reject self-edges, duplicate edges, unknown endpoints, cross-version nodes, cross-plan nodes and cycles instead of ignoring them or appending cyclic nodes. Topological order SHALL use previous/manual position, normalized title and stable node id as documented tie-breakers, producing reproducible contiguous positions for unchanged inputs.

#### Scenario: Cycle is refused

- **WHEN** an edit adds an edge from a topic to its transitive prerequisite
- **THEN** the edit returns a dependency-cycle error naming the remaining/cycle nodes and the last valid draft remains intact

#### Scenario: Dangling prerequisite is not ignored

- **WHEN** a prerequisite references a removed, unknown or different-version node
- **THEN** the edit fails with a dangling-prerequisite error instead of producing a valid-looking sequence

#### Scenario: Equal-priority nodes are reproducible

- **WHEN** two independent branches have identical content but different stable ids and generation/edit runs use unchanged inputs
- **THEN** normalized title then stable id resolves the same order across runs

### Requirement: Manual reorder cannot violate prerequisites

A manual position change SHALL preserve every prerequisite-before-dependent invariant. The system SHALL compute the earliest position after transitive prerequisites and latest position before transitive dependents, reject an out-of-range move without persistence, and return those valid bounds to the editor. Locking SHALL express preservation preference, never permission for an impossible graph; version diffs SHALL disclose a forced lock-position adjustment.

#### Scenario: Disallowed reorder is explained

- **WHEN** a learner drags Virtual Memory before its Memory prerequisite
- **THEN** no draft write occurs and the editor shows the permitted position range with a move-to-nearest-valid-position action

#### Scenario: Lock cannot override a cycle

- **WHEN** a draft introduces a dependency requiring a locked topic to move or creating a cycle
- **THEN** the cycle is rejected or the draft diff shows the actual lock-position adjustment, and no silent publication occurs

### Requirement: Plan versions have explicit head transitions and conflict detection

Each plan SHALL have at most one durable working Draft and one current published head. AI/manual structural regeneration SHALL create a new version based on a published version without mutating that head. Save Draft and Publish SHALL use optimistic revisions; accepting a draft based on an obsolete head SHALL fail safely. Historical versions SHALL remain readable, and reverting SHALL copy a selected version into a new Draft rather than rewrite history.

#### Scenario: Publish appends history

- **WHEN** a user publishes a valid draft based on version 1
- **THEN** version 1 is superseded, version 2 becomes current in one transaction, and a reviewable add/remove/edit/reorder/edge diff is retained

#### Scenario: Stale acceptance does not clobber edits

- **WHEN** a generated draft based on version 1 is accepted after another version has become current
- **THEN** acceptance returns stale-revision with the actual head and no generated node replaces the newer plan

### Requirement: Study activity remains separate from understanding

The system SHALL expose node study activity independently of material coverage and assessment-derived evidence. Reading, extraction, card review or AI rationale SHALL NOT mark a topic completed or mastered. Plan-level completion MAY be explicitly declared by the user, but SHALL remain labelled as user-declared rather than demonstrated mastery.

#### Scenario: Reading does not complete a topic

- **WHEN** all cited material has been read but the user has not declared topic completion or supplied assessment evidence
- **THEN** the topic may show study/reading activity while demonstrated evidence remains insufficient and the activity is not converted to mastery

### Requirement: Study evidence references are validated and revision-aware

Each new study source reference SHALL resolve to a live document/extract, an exact verified excerpt and a locally computed revision/hash before it is accepted. Source handles and citations generated by a model SHALL NOT be trusted without this resolution. Navigation SHALL distinguish current, stale, missing, ambiguous and unsupported references and SHALL use the source type's supported reader jump; bare semantic chunk ids are not durable proof.

#### Scenario: Exact source opens

- **WHEN** a user opens a current PDF, EPUB, text, audio or YouTube reference
- **THEN** the existing reader opens with its validated page/CFI/quote/timestamp locator and the correct document

#### Scenario: Local video uses extract focus

- **WHEN** a source reference identifies a local video extract
- **THEN** navigation supplies that extract through the existing focused-video-extract viewer path and does not claim unsupported generic initial-jump behavior

#### Scenario: Source was deleted

- **WHEN** a cited source or extract has been deleted
- **THEN** the plan/history remains readable, its stored evidence excerpt is identified as missing-source history, navigation is unavailable, and future publication/generation cannot count it as current grounding

#### Scenario: Revision changed

- **WHEN** live source content no longer matches the reference revision/excerpt
- **THEN** the reference is labelled stale and no in-flight/new publication silently treats it as current evidence

### Requirement: Legacy path data migrates without duplication or silent loss

The system SHALL validate and idempotently import accepted legacy localStorage plans, repair only documented path-id rebinding/order normalization, retain unresolved issues for user correction, and preserve existing ids only as legacy lineage while assigning canonical native ids. It SHALL disable the old key as an active authority only after complete accepted import. Malformed payloads SHALL NOT be silently deleted or presented as current mastery evidence.

#### Scenario: Import retry is idempotent

- **WHEN** the same legacy payload import is interrupted and retried
- **THEN** the import hash/legacy key returns the same native plan and no duplicate goals, nodes or versions are created

#### Scenario: Legacy cycle needs correction

- **WHEN** an old payload contains a cycle or dangling prerequisite
- **THEN** the affected plan is not published as valid, the issue is shown in the import/editor flow, and the original payload remains recoverable until accepted persistence succeeds

## MODIFIED Requirements

### Requirement: Goals are first-class and scoped

A Study Plan SHALL directly own one durable natural-language learning goal, title, depth and a source scope selected through documents, extracts, collections or tags. Goal text SHALL use the existing session-goal normalization/refusal rules without sharing DAQE session state or reading-goal storage. Collection/tag scope SHALL freeze to concrete document/extract ids and revisions per plan version; paths SHALL have full version history. Archiving/deleting a plan SHALL archive/delete its plan-owned goal and versions but never underlying library data, assessment history, concepts or cards.

#### Scenario: Scoped generation

- **WHEN** a plan is scoped to a single collection
- **THEN** only the concrete documents/extracts frozen from that collection inform that plan version

#### Scenario: Collection membership changes later

- **WHEN** a document is added to the collection after a plan version is published
- **THEN** the existing plan's source scope does not change until a new draft explicitly refreshes the scope

#### Scenario: Plan deletion preserves learning artifacts

- **WHEN** a user permanently deletes a plan after taking its exam
- **THEN** the plan's goal/versions/nodes/activity are removed and assessments detach from the plan while their source-linked attempt history remains available
