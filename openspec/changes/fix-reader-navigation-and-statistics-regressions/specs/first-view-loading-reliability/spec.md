## ADDED Requirements

### Requirement: First-navigation view loading is deterministic and recoverable

Every major application view SHALL reach a terminal or active loading state (content ready, genuine empty state, explicit loading indicator, or recoverable error state) on its first activation without requiring the user to navigate away and return.

#### Scenario: Failed lazy chunk import recovers in place on retry

- **WHEN** a tab's lazy module import fails on first navigation and the user activates Retry
- **THEN** the loader issues a fresh import attempt rather than re-throwing a cached rejection
- **AND** the view renders its content once the retry succeeds without navigating away

#### Scenario: Collection switch during in-flight document load does not clobber loading state

- **WHEN** `documentStore.loadDocuments` is in flight for collection A and the user switches to collection B
- **THEN** the stale response for collection A does not clear `isLoading` or overwrite collection B's documents

### Requirement: Item Statistics modal does not crash active PDF or EPUB readers

Opening, interacting with, resizing, and closing the Item Statistics modal from a PDF or EPUB reader SHALL NOT trigger React maximum-update-depth errors (`#185`) or unmount the underlying reader tab.

#### Scenario: Statistics opens and renders charts inside PDF and EPUB readers

- **WHEN** the user clicks Statistics while viewing a PDF or EPUB document with schedule curves
- **THEN** the Statistics modal opens and renders `IntervalGrowthChart` and `RetentionCurveChart` without console errors or React update loops
- **AND** closing the modal preserves the reader's scroll position and zoom

#### Scenario: Statistics error is contained within the modal

- **WHEN** an unexpected rendering error occurs inside `ItemStatsModal`
- **THEN** a modal-scoped error boundary displays a recoverable error UI with Close/Retry
- **AND** the underlying PDF or EPUB reader remains mounted and usable
