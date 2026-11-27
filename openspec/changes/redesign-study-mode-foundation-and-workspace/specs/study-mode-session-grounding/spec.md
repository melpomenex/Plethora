# Study Mode Session Grounding Specification

## ADDED Requirements

### Requirement: Precision Scope Keys Without Collisions
The system SHALL compute deterministic Study Mode scope keys incorporating scope kind, document/plan/topic/segment identifiers, passage/selection/media-timestamp anchor signatures, and `sourceRevision` so distinct passages, selections, media segments, and document revisions never collide.

#### Scenario: Distinct text selections in the same document produce distinct scope keys
- **GIVEN** a document `doc-1` at revision `rev-1`
- **WHEN** a learner studies selection A ("Mitochondria produce ATP") and later studies selection B ("Chloroplasts perform photosynthesis")
- **THEN** the two selections resolve to different deterministic scope keys
- **AND** artifacts generated for selection A do not overwrite or appear under selection B.

#### Scenario: Media timestamp segments and document revisions do not collide
- **GIVEN** an audio or video source `media-1`
- **WHEN** scope keys are computed for timestamp `00:45` (`segment-1`) vs. `03:10` (`segment-2`), or for `rev-1` vs. `rev-2`
- **THEN** each produces a unique scope key incorporating the segment/timestamp and revision.

### Requirement: Resumable Sessions and View Restoration
The system SHALL persist and restore Study Mode session state per scope—including active primary tab (`learn`, `practice`, `explore`, `progress`), current learning objective/step, active practice question state, session duration target (`5`, `15`, or `30` minutes), and exact `ExactSearchHitLocation` reading/media position—without resetting to `learn` on mount.

#### Scenario: Re-opening Study Mode restores prior tab, objective, and locator
- **GIVEN** a learner was studying `doc-1` on the `practice` tab with a 15-minute session target and locator `{ kind: "pdf", pageNumber: 12 }`
- **WHEN** the learner closes Study Mode and re-opens it on the same scope
- **THEN** Study Mode restores the `practice` tab, the 15-minute target, and the saved locator without resetting to `learn`.

#### Scenario: Legacy persisted view tabs migrate cleanly
- **GIVEN** a previously saved session has `activeView` set to `mind_map`, `audio`, `slides`, or `source`
- **WHEN** the session is restored
- **THEN** `mind_map`, `audio`, and `slides` map to the `explore` tab (selecting the matching sub-view) and `source` maps to `learn` without error.

### Requirement: Real Source Grounding via Reading Trails Anchor Model
Every generated Study Mode artifact SHALL persist non-empty, typed `StudySourceAnchor` records derived from Plethora's `ExactSearchHitLocation` model (`src/types/searchHit.ts`) whenever source citations or active passage locators exist, and SHALL allow one-click navigation to the exact supporting passage or media timestamp.

#### Scenario: Generated explanation persists exact source anchors
- **GIVEN** a learner generates an explanation grounded in a source passage containing `"Mitochondria produce ATP"`
- **WHEN** the artifact is verified and saved
- **THEN** `anchors` contains at least one structured anchor with `sourceId`, `quote`, character offsets, `sourceRevision`, and `ExactSearchHitLocation`
- **AND** clicking the citation badge highlights and scrolls to that quote in the Original Source pane.

#### Scenario: Unanchored citation fallback uses active scope locator
- **GIVEN** a source is a media transcript or non-text excerpt without an exact substring match
- **WHEN** an artifact is saved
- **THEN** the system attaches the active scope's `ExactSearchHitLocation` (e.g., timestamp or page locator) rather than saving an empty `anchors: []` array.

### Requirement: Independent, Cancellable Per-Task Execution
Study Mode SHALL track loading, streaming progress, and cancellation state independently per task using `AbortController` signals passed to `runTask`, so running one generation task never blocks other tools or tabs.

#### Scenario: Cancelling a running generation does not disturb other tools
- **GIVEN** a learner starts generating an Explanation and concurrently switches to Practice or starts generating a Mind Map
- **WHEN** the learner cancels the Explanation task
- **THEN** the Explanation task's `AbortController` is aborted and its state transitions to cancelled
- **AND** the concurrent task continues unaffected without displaying a global error.

### Requirement: Resilient Error Handling Separating Offline Mode and Persistence Failures
Study Mode SHALL NOT silently swallow initialization or persistence errors. It SHALL surface contextual per-panel errors with Retry and Inspect Source actions, and SHALL explicitly distinguish offline operation (read/cached access available) from local persistence failures.

#### Scenario: Offline state preserves access to original source and cached artifacts
- **GIVEN** the device is offline or no AI provider is reachable
- **WHEN** the learner opens Study Mode
- **THEN** an explicit offline/provider-unavailable status is shown without blocking access to the Original Source or cached artifacts
- **AND** attempting AI generation displays a contextual per-panel error with a Retry action.

#### Scenario: Persistence failure surfaces recoverable warning
- **GIVEN** SQLite or local session persistence throws an error during load or save
- **WHEN** Study Mode initializes or saves an artifact
- **THEN** a contextual persistence warning is displayed with a Retry Save/Reload action, distinct from offline mode.

### Requirement: Safe Artifact Management with Confirmation and Recovery
Study Mode SHALL protect learners from accidental data loss by requiring confirmation before clearing scope artifacts, supporting granular single-artifact deletion, and providing an Artifact History / Recovery list to restore dismissed or prior-revision artifacts.

#### Scenario: Dismissing and restoring an artifact
- **GIVEN** a learner has generated an explanation artifact
- **WHEN** the learner dismisses it and opens Artifact History
- **THEN** the dismissed artifact appears in Artifact History with a Restore action
- **AND** clicking Restore returns it to the active Learn panel.

#### Scenario: Clearing all scope artifacts requires explicit confirmation
- **GIVEN** a scope has one or more generated artifacts
- **WHEN** the learner clicks "Clear Scope"
- **THEN** no artifacts are deleted until the learner confirms the prompt; cancelling leaves all artifacts intact.
