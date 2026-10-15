## ADDED Requirements

### Requirement: Scan produces a Plethora document and retained page images
Scanning SHALL use ML Kit Document Scanner when available, store page images in the existing image registry, and create a normal document. OCR failure SHALL NOT prevent saving images.

#### Scenario: Three textbook pages
- **WHEN** the user scans three pages
- **THEN** cropped page images are stored
- **AND** a Plethora document is created
- **AND** source images remain available for re-OCR and occlusion
- **AND** summary/flashcards do not run unless the user requests enrichment

#### Scenario: OCR is geometric not semantic
- **WHEN** OCR returns blocks/lines/elements
- **THEN** Plethora persists that text structure
- **AND** does not claim reconstructed chapters/tables unless a later dedicated reconstructor exists

#### Scenario: Scanner unavailable
- **WHEN** Play Services scanner cannot run
- **THEN** the user can still import images via existing pickers
