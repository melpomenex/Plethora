## ADDED Requirements

### Requirement: User-selectable queue ordering mode

The application SHALL persist Adaptive as the default and expose Strict Manual in Review Settings. All learning queue and session producers SHALL apply the active mode to the eligible set.

#### Scenario: Restart in Strict Manual

- **GIVEN** priority-90 and priority-30 items eligible for the same collection and queue view, with the latter older overdue
- **WHEN** the user selects Strict Manual and restarts
- **THEN** the priority-90 item precedes the priority-30 item in Queue, Scroll, saved/custom and Optimal sessions wherever both are eligible
- **AND** the setting does not change item dates or recall state

### Requirement: Canonical manual priority and deterministic presentation

Strict Manual SHALL use effective manual priority 0–100, preserving explicitly assigned zero and ordering ties by due instant, type and ID. Adaptive score, randomization, relevance, interleaving, energy and friction SHALL NOT displace an eligible higher-priority item.

#### Scenario: Mixed session with exclusions

- **GIVEN** a filtered session with five eligible priority-100 documents, lower-priority cards, and one excluded priority-100 row
- **WHEN** the session is composed or recomposed in Strict Manual
- **THEN** within the configured candidate quotas, eligible priority-100 rows come first and the excluded row stays absent

#### Scenario: Failed priority write

- **WHEN** a keyboard or pointer priority edit fails
- **THEN** the last confirmed priority remains visible, the queue retains confirmed ordering, and retry is available

### Requirement: Strict automatic postponement

Automatic capacity recovery SHALL preserve higher-priority postponable items ahead of lower-priority postponable items in Strict Manual and preserve explicit protections.

#### Scenario: Capacity exceeded

- **GIVEN** one free slot, a more overdue low-priority item and a high-priority item
- **WHEN** a valid Strict Manual recovery plan is applied
- **THEN** the higher-priority item keeps its date and the lower-priority item is postponed
- **AND** the user can still postpone either eligible item explicitly

### Requirement: Settings search discoverability

Settings Search SHALL reveal the existing ordering control by the stable target `setting-queue-ordering-mode`.

#### Scenario: Search for manual priority

- **WHEN** the user searches Settings for manual priority
- **THEN** the result reveals and focuses the ordering control on Review Settings
