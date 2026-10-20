## MODIFIED Requirements

### Requirement: Passage extract-worthiness

The system SHALL optionally classify encountered readable passages as fundamental claim, definition, important example, key argument, formula, process, comparison, supporting detail, transition, bibliography or low value, with extract-worthiness score, reason and suggested action. Classification SHALL run only for recently encountered viewport content after reading interaction is idle, with bounded queue, concurrency, inference and cache budgets. It SHALL NOT scan entire documents or libraries automatically or initiate requests on every scroll event.

Scores SHALL be cached by stable content and classifier/model revision. Indicators SHALL appear only for meaningful passages scoring strictly above 0.75, without document layout shifts or flicker. Source-specific stable anchors SHALL support accessible keyboard/touch actions and retain provenance. Disabled, navigated-away or suspended readers SHALL stop new work and suppress stale results. Private or billable background processing SHALL require explicit scoped authorization independent of the feature flag.

#### Scenario: High-worth passage indicator
- **WHEN** an eligible encountered passage scores above 0.75 during idle reading
- **THEN** a subtle correctly anchored indicator opens working extract, flashcard, cloze, highlight and dismissal actions using the existing approval workflows

#### Scenario: Bibliography stays quiet
- **WHEN** a bibliography, transition, low-value passage or no-action result is encountered
- **THEN** no worthiness indicator appears even if the model assigns an inconsistent high score

#### Scenario: Feature disabled
- **WHEN** the user disables extract suggestions before or during scoring
- **THEN** no new scoring runs, pending work is cancelled or ignored, and all indicators disappear

#### Scenario: Exact threshold boundary
- **WHEN** the returned score equals 0.75
- **THEN** no indicator appears

#### Scenario: Unchanged passage reused
- **WHEN** an unchanged passage is reopened under the same classifier/model policy
- **THEN** the cached classification is reused without another inference request

#### Scenario: Document or classifier changes
- **WHEN** passage text or classifier/model revision changes
- **THEN** stale cache/indicator state cannot be reused for the changed passage and new work remains bounded by current authorization

#### Scenario: Scroll burst and budget exhaustion
- **WHEN** the reader rapidly scrolls through many passages or consumes its inference quota
- **THEN** no scroll event starts inference directly, pending work stays bounded, and excess work waits or is skipped without blocking interaction

#### Scenario: Reader geometry changes
- **WHEN** a PDF page virtualizes, an EPUB iframe changes, or text reflows
- **THEN** the indicator is reprojected from its stable source anchor or hidden until valid, without modifying document layout

#### Scenario: Unsupported text or inaccessible surface
- **WHEN** the reader has no reliable text/anchor adapter, including an unprocessed scanned page or inaccessible frame
- **THEN** automatic scoring remains unavailable, manual actions remain usable and no OCR or import starts automatically

#### Scenario: Unsaved RSS source
- **WHEN** an indicator action on unsaved RSS content requires a durable source association
- **THEN** the user is offered the existing explicit import/creation flow and no library ID is invented

#### Scenario: Unexpected cloud destination
- **WHEN** local inference is unavailable or routing changes to an unauthorized remote destination
- **THEN** automatic scoring does not send the passage and explains the setup/authorization limitation

#### Scenario: Accessible dismissal persists
- **WHEN** a keyboard or touch user dismisses a suggestion and reopens the same saved passage revision
- **THEN** that suggestion stays dismissed and focus returns predictably to the reader

#### Scenario: Failed classification or learning save
- **WHEN** the provider returns malformed output or an explicit learning action fails to persist
- **THEN** reading remains responsive, no invalid candidate is saved, and the user receives a bounded recovery path without duplicated objects
