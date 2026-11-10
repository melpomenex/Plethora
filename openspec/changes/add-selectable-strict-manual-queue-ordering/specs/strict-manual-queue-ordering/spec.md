## Purpose

Provide a user-controlled strict manual queue ordering mode where user-assigned priority strictly governs presentation order, while preserving adaptive DAQE and classic SRS options without data mutations.

## ADDED Requirements

### Requirement: User-selectable queue ordering mode
The system SHALL support three distinct queue ordering modes: `adaptive`, `strict-manual`, and `srs-priority`. The active mode SHALL be configurable in Settings and persist across application restarts.

#### Scenario: Switching to strict manual mode
- **GIVEN** a queue containing item A (Priority 90%, due in 5 days) and item B (Priority 30%, due today)
- **WHEN** the user selects `strict-manual` ordering mode
- **THEN** item A SHALL precede item B in the ranked queue and in Scroll Mode sessions
- **AND** no due dates, memory states, or review intervals SHALL be altered

#### Scenario: Preserving DAQE adaptive behavior by default
- **GIVEN** default settings where `queueOrderingMode` is `adaptive`
- **WHEN** the queue is ranked
- **THEN** DAQE composite scoring combining temporal urgency, goal alignment, energy, friction, and diversity SHALL be applied

### Requirement: Strict manual ordering bypasses synthetic interleaving
When `strict-manual` ordering mode is active, the system SHALL NOT apply the Scroll Mode variety guard cap (`MAX_SAME_TYPE_CONSECUTIVE`) or algorithmic energy/friction penalties to displace high-priority items.

#### Scenario: Consecutive same-type items in strict manual mode
- **GIVEN** a set of 5 consecutive document items all assigned 100% priority, followed by flashcard items assigned 50% priority
- **WHEN** the queue is ordered in `strict-manual` mode
- **THEN** all 5 documents SHALL be presented first in their priority order without any item being deferred behind lower-priority flashcards

### Requirement: Settings search discoverability
The Queue Ordering Mode setting SHALL have a stable DOM identifier `setting-queue-ordering-mode` and SHALL be indexed in `settingsSearchCatalog.ts` with relevant search terms.

#### Scenario: Searching for queue ordering in settings
- **GIVEN** the user opens Settings Search
- **WHEN** the user queries "manual priority" or "queue order"
- **THEN** the search results SHALL surface `setting-queue-ordering-mode` linking directly to the Review settings tab
