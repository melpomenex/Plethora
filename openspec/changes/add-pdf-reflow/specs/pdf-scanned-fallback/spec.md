# Spec Delta: pdf-scanned-fallback (new)

## ADDED Requirements

### Requirement: Pages are classified native, scanned, or mixed
The system SHALL classify each page by comparing native text coverage against rendered ink coverage, distinguishing pages with usable native text, scanned pages without native text, and mixed pages containing both.

#### Scenario: Scanned page detected without OCR
- **GIVEN** a page that is a bitmap scan with no native text layer
- **WHEN** the page is analyzed
- **THEN** it is classified as scanned before any OCR engine is invoked

### Requirement: OCR is pluggable and only used when needed
The system SHALL expose a pluggable OCR interface (engine-agnostic) where every recognized word carries text, bounding box, and confidence, and SHALL invoke OCR only for pages or regions classified as scanned or mixed — never for born-digital text that native extraction handles.

#### Scenario: Born-digital document never runs OCR
- **GIVEN** a born-digital PDF analyzed end to end
- **WHEN** processing completes
- **THEN** no OCR engine was invoked

#### Scenario: Engine swap does not change the architecture
- **GIVEN** two different local OCR engines implementing the interface
- **WHEN** either recognizes the same scanned page
- **THEN** both produce canonical words with confidence and boxes through the same pipeline

### Requirement: OCR text becomes real reflowable text
OCR results SHALL enter the canonical model as words with source provenance and confidence and SHALL render as real selectable text in Reflow mode; words below a confidence threshold SHALL degrade to preserved source imagery with the OCR text retained as alternative text.

#### Scenario: Scanned page reads as text after OCR
- **GIVEN** a scanned page processed by an available OCR engine
- **WHEN** rendered in Reflow mode
- **THEN** the page's text renders as selectable reflowed text

#### Scenario: Low-confidence region falls back visually
- **GIVEN** an OCR region below the confidence threshold
- **WHEN** rendered in Reflow mode
- **THEN** the region renders as a source crop while its OCR text remains available to search and TTS

### Requirement: Graphical fallback reflow keeps unreadable pages readable
When neither native text nor OCR yields confident words for a page or region, the system SHALL apply bitmap graphical reflow: detecting visual text rows, splitting them into word/phrase regions, and packing the source crops to the destination width so line lengths fit the viewport.

#### Scenario: OCR declined, page still reflows
- **GIVEN** a scanned page with no OCR engine available or OCR declined by the user
- **WHEN** Reflow mode renders the page
- **THEN** the page displays as packed graphical word crops at the viewport width rather than as a fixed full-page image

### Requirement: Degradation ladder never produces an unusable page
The system SHALL degrade in order — native text blocks, native text with fallback visual blocks, OCR text with visual blocks, graphical bitmap reflow, original page — and SHALL at no point render a blank or error page for content the original PDF displays.

#### Scenario: Analysis failure shows the original page
- **GIVEN** a page whose analysis fails entirely
- **WHEN** the reader displays it
- **THEN** the original rendered page is shown rather than an error state

### Requirement: On-device Android OCR path where available
On Android devices reporting on-device OCR capability, the system SHALL be able to route scanned-page OCR to the on-device engine without cloud services, honoring the same pluggable interface and confidence contract.

#### Scenario: AICore-capable device OCRs locally
- **GIVEN** an Android device whose AI capabilities report OCR availability
- **WHEN** a scanned page requires OCR and the user has enabled on-device OCR
- **THEN** recognition runs on device and its words enter the canonical model

### Requirement: No heavyweight runtime required for the base path
The base reader experience SHALL NOT require Python, PyTorch, or large neural model downloads; heavyweight runtimes SHALL remain optional enhancements for OCR quality.

#### Scenario: Fresh install reads a born-digital PDF without runtimes
- **GIVEN** a fresh installation with no OCR runtimes downloaded
- **WHEN** the user reads and reflows a born-digital PDF
- **THEN** all functionality works with no model downloads
