# dashboard-capture-activity Delta

## Purpose

Makes the capture half of the pipeline visible on the Dashboard: a per-day
capture sparkline, a per-source breakdown (browser extension, share target,
RSS, manual), and a count of captures needing attention, backed by a
dedicated aggregation query.

## ADDED Requirements

### Requirement: Capture activity section on the Dashboard

The Dashboard tab SHALL display a Capture Activity section containing a
captures-per-day sparkline over a rolling lookback window (default 30 days),
a per-source capture count breakdown, and a needs-attention count. The
section SHALL appear between the existing Continue Reading section and the
Progress section.

#### Scenario: Section renders with data

- **WHEN** the Dashboard tab is opened and at least one document exists within
  the lookback window
- **THEN** the Capture Activity section renders with a sparkline of per-day
  capture counts, per-source counts, and a needs-attention count

#### Scenario: Section placement is stable

- **WHEN** the Capture Activity section renders
- **THEN** it appears after the Continue Reading section and before the
  Progress ("Your Progress") section, without altering any existing section's
  content or ordering

### Requirement: Per-source capture classification

The system SHALL classify captured documents into the sources
`browser-extension`, `share-target`, `rss`, and `manual`, deriving the
classification from each document's stored provenance (browser capture
provenance, share capture provenance, RSS-derived markers) and assigning
documents with no recognizable provenance — including all documents that
predate provenance tracking — to `manual`.

#### Scenario: Browser extension save is counted as extension capture

- **WHEN** a document exists whose browser capture provenance source is
  `browser_extension`
- **THEN** that document is counted under the `browser-extension` source

#### Scenario: Share-target capture is counted as share capture

- **WHEN** a document exists that carries share-target capture provenance
- **THEN** that document is counted under the `share-target` source

#### Scenario: Legacy documents count as manual

- **WHEN** a document predates provenance tracking and carries no recognizable
  provenance
- **THEN** that document is counted under the `manual` source and is not
  dropped from the totals

### Requirement: Capture activity data contract

The system SHALL expose a capture-activity query that, given a lookback
window in days, returns per-day capture counts within the window, total
counts per source within the window, and the count of captures whose
organization status is `needs-review` or `failed`. The query SHALL NOT
require loading document content into memory on the client.

#### Scenario: Query returns aggregated shape

- **WHEN** the capture-activity query runs with a 30-day window
- **THEN** it returns one count per day in the window (zero where no captures
  occurred), per-source totals for the window, and the needs-attention count

#### Scenario: Window bounds the aggregation

- **WHEN** the capture-activity query runs with an N-day window
- **THEN** only documents whose add date falls within the last N days are
  included in the per-day series and per-source totals

### Requirement: Capture activity refresh timing

The Dashboard SHALL refresh the capture-activity data when the tab becomes
active, alongside existing dashboard stats, so a capture saved through the
browser extension since the last visit is reflected without an app restart.

#### Scenario: New capture appears on next dashboard visit

- **WHEN** the user saves a link with the browser extension while the
  Dashboard tab is not active, then activates the Dashboard tab
- **THEN** the Capture Activity section reflects the new capture

### Requirement: Capture activity empty, loading, and error states

The Capture Activity section SHALL render a friendly empty state when no
captures exist in the window, SHALL NOT block the rest of the Dashboard from
rendering while its data loads, and SHALL render a non-fatal error message in
place of the section content if the capture-activity query fails.

#### Scenario: Fresh install shows empty state

- **WHEN** no documents exist in the library
- **THEN** the Capture Activity section renders an empty-state message instead
  of a blank or broken chart

#### Scenario: Query failure does not break the Dashboard

- **WHEN** the capture-activity query fails
- **THEN** the rest of the Dashboard renders normally and the Capture Activity
  section shows a non-fatal error message with a retry affordance

### Requirement: Localized capture activity labels

All user-visible Capture Activity text (section title, source labels,
needs-attention label, empty and error states) SHALL be presented through the
app's i18n system rather than hardcoded strings.

#### Scenario: Labels use translation keys

- **WHEN** the Capture Activity section renders in any supported locale
- **THEN** all section text is served from translation keys so a locale
  provides its own wording
