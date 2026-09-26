## Purpose

Ensures a hyperlink whose article capture fails is preserved in the library as a minimal readable source with recovery affordances, so a saved URL is never silently lost.

## ADDED Requirements

### Requirement: Failed capture preserves the URL as a source

When article extraction fails on an unattended import path (native share sheet, PWA share target), Plethora SHALL persist the URL as a minimal web source marked as capture-failed, so the link remains visible in the library instead of being discarded. The original URL SHALL always remain retrievable from the source record.

#### Scenario: Share-sheet failure keeps the link

- **WHEN** a URL shared from the Android share sheet fails article extraction
- **THEN** the library contains a source for that URL marked capture-failed
- **AND** the original URL is available for retry and external opening

#### Scenario: Attended failures keep current behavior

- **WHEN** the user imports a URL through the interactive import dialog and extraction fails
- **THEN** the existing typed-error and raw-fallback choices continue to apply

### Requirement: Capture-failed sources offer recovery in the reader

Opening a capture-failed source SHALL show a reading view with a capture-failure notice offering Retry and Open Original. Retry SHALL re-run the article pipeline and replace the source's content in place; Open Original SHALL open the URL externally.

#### Scenario: Retry upgrades the source in place

- **GIVEN** a capture-failed source in the reader
- **WHEN** the user activates Retry and the re-run succeeds
- **THEN** the same source record now contains the extracted article content
- **AND** no duplicate source is created

#### Scenario: Open Original escapes to the browser

- **WHEN** the user activates Open Original on a capture-failed source
- **THEN** the URL opens in the platform's external browser

### Requirement: Retry and re-import deduplicate against the existing source

A retry or later import of the same canonical URL SHALL reuse the existing capture-failed source record rather than creating a duplicate library entry.

#### Scenario: Saving the same URL again does not duplicate

- **GIVEN** a capture-failed source exists for a URL
- **WHEN** the user shares or imports that same URL again and capture succeeds
- **THEN** the existing source is updated with the captured article and no second source appears
