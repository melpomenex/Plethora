## ADDED Requirements

### Requirement: Workload forecasts cover the same items as Due All

The due-workload forecast that powers the Schedule and Analytics graphs SHALL count the same item types the Due All queue serves — learning items (flashcards), text extracts, video extracts, and documents — and SHALL represent items already overdue (a leading overdue/backlog bucket or today's bucket) instead of excluding them, so a library whose workload is overdue-heavy or extract-heavy never renders as zero.

#### Scenario: Extracts appear in the forecast

- **WHEN** the library contains extracts with due review dates and the forecast is requested
- **THEN** those extracts are counted in the corresponding buckets alongside cards and documents

#### Scenario: Overdue backlog is visible

- **WHEN** items are overdue relative to the forecast window's start
- **THEN** the forecast represents them in an overdue bucket rather than omitting them
- **AND** a fully-overdue library renders a non-zero forecast

### Requirement: Due queries scope all item types identically under the default collection

Due-item queries for learning items, documents, text extracts, and video extracts SHALL resolve "the default collection" against the application's default-collection sentinel (plus legacy NULL/empty values) uniformly, so items in the default collection are visible regardless of which of the four item-type queries runs, and cross-collection scoping excludes exactly the other collections.

#### Scenario: Legacy null-collection items are included in the default scope

- **WHEN** a learning item or document row has a NULL or empty collection id and the active collection is the default collection
- **THEN** due queries include that item

#### Scenario: Documents and extracts scope like cards

- **WHEN** the active collection is not the default collection
- **THEN** due documents, extracts, and video extracts from other collections are excluded exactly as learning items are

### Requirement: Imports place cards in the chosen collection

When an import targets a chosen collection, every item it creates — documents and their cards — SHALL be assigned to that collection, so imported cards are visible in the target collection's Due All alongside their document.

#### Scenario: Imported cards follow the chosen collection

- **WHEN** the user imports a study archive into a non-default collection
- **THEN** the created cards carry that collection id
- **AND** those cards appear in that collection's Due All queue
