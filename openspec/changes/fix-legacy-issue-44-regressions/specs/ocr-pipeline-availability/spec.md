## ADDED Requirements

### Requirement: The OCR processor is initialized deterministically

The OCR processor SHALL be initialized at application startup from persisted OCR settings, and SHALL be reconfigured whenever the user saves OCR settings, so that no OCR entry point depends on a lazily-triggered initialization by an unrelated feature. Any OCR command invoked on a cold start SHALL not fail with an "OCR processor not initialized" error.

#### Scenario: Cold-start OCR command succeeds

- **WHEN** the application has just started and an OCR command is invoked (e.g. the occlusion AI assist or canonical PDF OCR)
- **THEN** the command executes against an initialized processor instead of failing with an initialization error

#### Scenario: Saving OCR settings reaches the backend

- **WHEN** the user changes and saves OCR settings (provider, language, paths, cloud credentials)
- **THEN** the backend processor is reconfigured with the new settings without requiring an app restart or another feature's action

### Requirement: OCR failures are actionable, never silent blanks

Every OCR entry point SHALL preflight the configured provider's availability and return a failed result with the provider's installation/configuration guidance when it is unavailable. PDF OCR SHALL report failure (with the first real error) when every page fails or the combined text is empty, instead of returning per-page blank pages under a success flag.

#### Scenario: Missing provider surfaces installation guidance

- **WHEN** OCR is requested with the default Tesseract provider and the binary is not installed
- **THEN** the response reports failure with actionable installation guidance
- **AND** the UI surfaces that message

#### Scenario: All-pages-failed is a failure

- **WHEN** a PDF OCR run completes with every page failing or yielding no text
- **THEN** the response reports failure with the first page error
- **AND** never reports success with empty combined text

### Requirement: PDF OCR works without embedded page images

For image-based providers, PDF OCR SHALL obtain page images by rendering (rasterizing) pages when the PDF lacks extractable embedded JPEG/JPX images, so that text-layer-free vector or non-JPEG scanned PDFs are OCR-able. Dead PDF processing stubs SHALL either be implemented by this path or removed.

#### Scenario: Vector PDF is OCR-able

- **WHEN** the user runs OCR on a PDF whose pages contain no embedded JPEG/JPX images
- **THEN** pages are rasterized and OCR runs over the rendered images

### Requirement: The OCR language setting is honored

The configured OCR language SHALL be passed through to the OCR engine for every provider that supports language selection. Tesseract SHALL receive the configured language instead of a hardcoded default.

#### Scenario: Non-English language reaches Tesseract

- **WHEN** the user configures a non-English OCR language and runs Tesseract OCR
- **THEN** the engine is invoked with that language
