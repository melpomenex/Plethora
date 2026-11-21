## Purpose

Compose grounded PDF context per physical page. Connect canonical and OCR projections to search, TTS, extracts, cards, trails, plans and assessments.

## ADDED Requirements

### Requirement: Current-page Assistant grounding

The Assistant SHALL use current page evidence or anchored selection for reader-relative requests and SHALL report unavailable context if neither exists.

#### Scenario: Current-page Assistant grounding acceptance

- **WHEN** a reader changes pages while extraction is pending
- **THEN** evidence from the previous page is cleared and no reader-relative request uses the stale window

### Requirement: Searchable OCR and visual evidence

PDF consumers SHALL preserve OCR page and geometry and use original visual regions for uncertain figures, tables or equations.

#### Scenario: Searchable OCR and visual evidence acceptance

- **WHEN** a mixed scanned and native document is processed
- **THEN** recognized text is searchable on the correct page and uncertain OCR or inferred structure carries provenance

### Requirement: Source-linked study workflow

PDF-derived trails, lesson material, cloze cards and assessments SHALL use resolvable source evidence through existing learning systems.

#### Scenario: Source-linked study workflow acceptance

- **WHEN** a user opens a citation in assessment feedback
- **THEN** the reader opens the relevant physical page and highlights the matching source when geometry resolves

### Requirement: Progressive OCR and privacy

OCR SHALL target deficient pages or selected regions, respect configured provider routing and preserve completed work when an operation is interrupted.

#### Scenario: Progressive OCR and privacy acceptance

- **WHEN** a mixed PDF includes clean text pages and image-only pages and strict local mode is enabled
- **THEN** clean pages retain native text and the OCR path uses an authorized local provider or surfaces the routing failure

### Requirement: Grounded Assistant actions

PDF Assistant actions SHALL resolve selection, active page, explicit page range, chapter or comparison sources against a bounded evidence budget before sending.

#### Scenario: Grounded Assistant actions acceptance

- **WHEN** a user requests a comparison of passages in two PDFs and the second is inaccessible
- **THEN** the app identifies the unavailable source and avoids presenting the comparison as grounded in two sources

### Requirement: Validated citations and uncertainty

Assistant and assessments SHALL distinguish source claims from explanations and uncited external material. Verified citations SHALL be resolvable through stored source locations.

#### Scenario: Validated citations and uncertainty acceptance

- **WHEN** an answer includes a figure explanation based on uncertain OCR
- **THEN** the explanation identifies uncertainty and references the original source region when available

### Requirement: Visual source extraction

Figures, tables and equations SHALL retain their original rendered regions and any associated captions. Structured exports and conversions SHALL expose confidence.

#### Scenario: Visual source extraction acceptance

- **WHEN** a low-confidence table is selected for CSV export
- **THEN** the app provides its source preview and withholds a table of unverified cells

### Requirement: Study workflow continuity

Study Plans and Reading Trails SHALL favor instructional source passages and preserve source evidence through completion, practice and assessment.

#### Scenario: Study workflow continuity acceptance

- **WHEN** a chapter topic has a matching table-of-contents entry and a matching body explanation
- **THEN** recommended reading favors the explanation and assessment feedback opens the cited passage
