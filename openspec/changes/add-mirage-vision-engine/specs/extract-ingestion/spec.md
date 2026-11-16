## ADDED Requirements

### Requirement: Snap-to-Extract Reading-Order Ingestion
The system SHALL decode captured or imported photos of book pages, whiteboards, or lecture slides into RGB, run Mirage `text` detection, sort detected text blocks into top-to-bottom, left-to-right reading order using `0–1000` bounding boxes, and insert structured extracts into Plethora's incremental reading queue.

#### Scenario: Multi-line page photo sorted into reading order
- **WHEN** a user imports a page photo containing out-of-order text detections from Mirage
- **THEN** the ingestion pipeline sorts the text blocks into reading order and creates an `Extract` in the target document's queue

### Requirement: Screen-Capture & PDF Region Parsing
The desktop client SHALL support region-snip / screenshot capture that routes raw RGB pixels to Mirage to extract unselectable text and structured scene/diagram JSON for downstream flashcard/cloze generation.

#### Scenario: Region snip on scanned PDF or video frame
- **WHEN** the user captures a screen or PDF region
- **THEN** Mirage extracts text and structured scene/diagram JSON without invoking any cloud API

### Requirement: Spatial Text-Figure Pairing
During page or screenshot ingestion, the system SHALL use Mirage `relations` and `0–1000` bounding-box proximity to pair nearby diagrams or callout figures to adjacent text extracts as contextual attachments, and render those attachments during spaced repetition review.

#### Scenario: Diagram adjacent to text block is paired
- **WHEN** a page contains a text block near a detected diagram/figure or linked by a Mirage relation
- **THEN** the cropped figure asset is attached to the created extract's `selection_context` and displayed alongside the resulting card during review

### Requirement: Browser Extension Visual Clipper
The browser extension SHALL capture visible viewport screenshots on canvas-rendered or non-selectable readers and submit them to `POST /ai/mirage-clip` on the local Tauri server to produce structured extracts with preserved text and cropped figure assets.

#### Scenario: Visual clip on non-selectable reader
- **WHEN** the user triggers "Visual Clip (Mirage)" in the browser extension
- **THEN** the extension captures the visible tab and the local server creates a structured extract with OCR text and cropped figures
