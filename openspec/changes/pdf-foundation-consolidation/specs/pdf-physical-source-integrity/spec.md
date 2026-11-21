## Purpose

Correct physical-page extraction and semantic location reconciliation. Establish the canonical reader projection and evidence requirements for rollout.

## ADDED Requirements

### Requirement: Physical page extraction

The processor SHALL return the requested physical page and preserve blank slots when producing a document page sequence.

#### Scenario: Physical page extraction acceptance

- **WHEN** a document has text on pages 1 and 3 with a blank page 2
- **THEN** page 2 is empty and page 3 text appears only in slot and locator 3

### Requirement: Derived source repair

The semantic index SHALL refresh stale page metadata while preserving user-authored references and shall leave unlocated content without an exact page claim.

#### Scenario: Derived source repair acceptance

- **WHEN** a chunk is rebuilt with equal text and ordinal but a corrected physical page
- **THEN** its current stored locator reflects the corrected page

### Requirement: Canonical page lifecycle

The reader SHALL render independently of canonical analysis and reuse versioned page analysis for the same source identity.

#### Scenario: Canonical page lifecycle acceptance

- **WHEN** a canonical page is not ready
- **THEN** original reading remains available and consumers can use native text for that page

### Requirement: Locator reliability across revisions

Source navigation SHALL validate the source revision and prefer exact geometry and quote matches before a page-only recovery. A recovery result SHALL expose its precision.

#### Scenario: Locator reliability across revisions acceptance

- **WHEN** a restored PDF annotation points to a changed fingerprint and the same text occurs on two nearby pages
- **THEN** the reader retains the original stored annotation and reports ambiguous evidence instead of relocating it silently

### Requirement: Compatibility of derived indexes

A PDF index upgrade SHALL invalidate only derived status and SHALL retain user-owned annotations, extracts, reading positions and study references. Refresh SHALL be recoverable after interruption.

#### Scenario: Compatibility of derived indexes acceptance

- **WHEN** a library contains legacy PDF chunks with collapsed page positions and the user reindexes
- **THEN** corrected chunks replace old derived evidence without rewriting authored records and saved quotes remain available for verification

### Requirement: Page processing budgets

The application SHALL bound active page rendering, page analysis and background work. Cache ownership SHALL be explicit and cache keys SHALL identify source revision and analysis version.

#### Scenario: Page processing budgets acceptance

- **WHEN** a reader scrolls a large PDF and rapidly switches documents or zoom levels
- **THEN** visible rendering continues while obsolete queued work is discarded and retained page assets stay within the measured budget

### Requirement: Low-confidence layout handling

Reflow SHALL retain source regions for uncertain columns, tables, figures, equations, code, footnotes and unrecognized visual content.

#### Scenario: Low-confidence layout handling acceptance

- **WHEN** a complex page contains an unrecognized diagram next to recognized text
- **THEN** the reader can inspect the original region and the reflow projection retains a visual fallback
