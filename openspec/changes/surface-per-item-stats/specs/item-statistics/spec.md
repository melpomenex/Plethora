## Purpose

Shows a user everything the application knows about a single learning item — time invested, review history, memory state, and content yield — through a fast at-a-glance summary and an on-demand deep view, so that recorded data is never invisible to the person who produced it.

## ADDED Requirements

### Requirement: Details popover shows an at-a-glance investment summary

The item Details popover SHALL present a compact statistics summary above the scheduling grid. The summary SHALL contain no more than six values, SHALL be visible without scrolling on both the desktop popover and the mobile bottom sheet, and SHALL include the item's total active time, its number of repetitions or sessions, and the average active time per repetition.

#### Scenario: Summary appears for a document

- **WHEN** a user opens the Details popover for a document with recorded time
- **THEN** the summary SHALL show the total active time, the number of reading repetitions, and the average time per repetition, each with a human-readable label

#### Scenario: Summary appears for a flashcard

- **WHEN** a user opens the Details popover for a flashcard that has been reviewed
- **THEN** the summary SHALL show the total active time across reviews, the review count, and the average time per review

#### Scenario: Summary does not delay the popover

- **WHEN** a user opens the Details popover
- **THEN** the popover SHALL render its existing content immediately and the statistics summary SHALL show a loading state until its data arrives, without blocking the rest of the popover

### Requirement: A full statistics view is reachable from the popover

The Details popover SHALL provide an explicit action that opens a full Item Statistics view. The full view SHALL be dismissible by the same means as other modal surfaces in the application, and SHALL return focus to the triggering control when dismissed.

#### Scenario: Opening the full view

- **WHEN** a user activates the full-statistics action in the Details popover
- **THEN** the full Item Statistics view SHALL open for that same item

#### Scenario: Dismissal restores focus

- **WHEN** a user dismisses the full Item Statistics view with the keyboard
- **THEN** focus SHALL return to the control that opened it

### Requirement: The full statistics view is organised into named sections

The full Item Statistics view SHALL group its content into distinct, labelled sections: **Time**, **Schedule**, **History**, and **Content**. Sections that have no data for the current item type SHALL be omitted entirely rather than rendered empty.

The sections SHALL cover at minimum:

- **Time** — total active time; time split by surface (queue vs. reader); number of sessions; longest single session; average and median session length; and, for documents, actual active time compared against the estimated reading time.
- **Schedule** — current memory state (stability, difficulty, retrievability where available); current and next interval; due date; interval modifier where applicable; the projected next intervals for each rating; and a retention estimate over time for this item.
- **History** — a chronological timeline of the item's recorded interactions showing date, active duration, rating where present, and resulting interval; the distribution of ratings given; lapses marked on the timeline; and a leech indicator when the item's lapse count crosses the configured threshold.
- **Content** — creation and first-seen dates; item age; word and character counts where applicable; reading progress for documents; the number of extracts and flashcards the item has yielded; priority values; category; and tags.

#### Scenario: Document shows all four sections

- **WHEN** a user opens the full statistics view for a document that has been read and rated
- **THEN** the Time, Schedule, History, and Content sections SHALL all be present

#### Scenario: Section without data is omitted

- **WHEN** a user opens the full statistics view for an RSS article, which has no scheduling state
- **THEN** the Schedule section SHALL be omitted rather than shown with empty values

#### Scenario: History timeline shows per-review detail

- **WHEN** a user opens the History section for a flashcard reviewed five times
- **THEN** five entries SHALL be listed, each showing its date, the active time spent, the rating given, and the interval that resulted

#### Scenario: Leech is flagged

- **WHEN** an item's lapse count is at or above the configured leech threshold
- **THEN** the History section SHALL display a leech indicator for that item

### Requirement: Statistics are available for every queue item type

The statistics surfaces SHALL support documents, extracts, flashcards, and RSS articles. Each item type SHALL display the metrics that exist for it; the presence of the surface SHALL NOT depend on the item type.

#### Scenario: Extract statistics

- **WHEN** a user opens statistics for an extract
- **THEN** the surface SHALL show its recorded time, review count, memory state, source document, character and word counts, and the flashcards generated from it

#### Scenario: RSS article statistics

- **WHEN** a user opens statistics for an RSS article
- **THEN** the surface SHALL show the metrics available for it and SHALL NOT present scheduling or memory-state metrics that RSS articles do not have

### Requirement: Unknown, absent, and untracked values are distinguished

A metric with no value SHALL be presented in a way that says why. The surface SHALL distinguish between a metric that does not apply to this item type, a metric whose value is genuinely zero, and a metric that has no value because it predates tracking. It SHALL NOT display a bare placeholder such as `--` for these cases, and SHALL NOT substitute zero for an unknown value.

#### Scenario: Metric predating tracking

- **WHEN** a user opens statistics for an item that was reviewed before per-item time was recorded
- **THEN** the time metrics SHALL indicate that no time was recorded for those earlier reviews, rather than showing `0`

#### Scenario: Genuine zero

- **WHEN** a user opens statistics for a document from which no extracts have been made
- **THEN** the extract count SHALL show `0`, presented as a real value

#### Scenario: Not applicable to the item type

- **WHEN** a metric does not apply to the current item type
- **THEN** it SHALL be omitted rather than shown as empty

### Requirement: Durations are always human-readable

Every duration displayed SHALL be formatted for human reading with explicit units, scaled to its magnitude. Raw second or millisecond counts SHALL NOT be shown.

#### Scenario: Long duration

- **WHEN** an item has 8040 seconds of accumulated active time
- **THEN** the surface SHALL display it as hours and minutes, such as `2h 14m`, and SHALL NOT display `8040`

#### Scenario: Short duration

- **WHEN** an item has 45 seconds of accumulated active time
- **THEN** the surface SHALL display it in seconds with an explicit unit, such as `45s`

### Requirement: Statistics are accessible without sight or a pointer

Every statistic SHALL be reachable by keyboard and conveyed to assistive technology. Each chart or graphical representation SHALL have an equivalent textual or tabular representation of the same data available to screen readers. Animated transitions SHALL be suppressed when the user has requested reduced motion.

#### Scenario: Keyboard traversal

- **WHEN** a user navigates the full statistics view using only the keyboard
- **THEN** every section and every interactive control SHALL be reachable and operable, and focus SHALL remain within the view until it is dismissed

#### Scenario: Chart has a text equivalent

- **WHEN** a screen reader encounters a chart in the statistics view
- **THEN** an equivalent description or data table conveying the same values SHALL be announced

#### Scenario: Reduced motion honoured

- **WHEN** the user's system requests reduced motion
- **THEN** the statistics view SHALL present its content without animated transitions

### Requirement: Statistics are reachable from every surface that shows the item

The statistics surfaces SHALL be openable from the Queue, the Documents library, the Reader, and Flashcard Studio. The presentation SHALL be the same in each, differing only in how it is triggered.

#### Scenario: Opening from the Documents library

- **WHEN** a user requests statistics for a document from the Documents library
- **THEN** the same Item Statistics view SHALL open, showing the same values it would show from the Queue

#### Scenario: Opening from the Reader

- **WHEN** a user requests statistics while reading a document
- **THEN** the Item Statistics view SHALL open for that document, including time accrued during the current reading session up to the last recorded engagement

### Requirement: Statistics reflect the current state of the item

The statistics surfaces SHALL read live persisted data each time they are opened. After a user rates or otherwise interacts with an item, reopening the statistics SHALL reflect that interaction.

#### Scenario: Rating updates the statistics

- **WHEN** a user rates an item, then opens its statistics
- **THEN** the review count, total time, and history timeline SHALL include the review just performed

#### Scenario: Reopening refetches

- **WHEN** a user opens statistics for an item, closes the view, interacts with the item, and opens the statistics again
- **THEN** the displayed values SHALL reflect the state after the interaction, not the previously displayed values
