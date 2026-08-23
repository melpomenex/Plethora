## ADDED Requirements

### Requirement: Apple Vision capability detection
The system SHALL report `RecognizeDocumentsRequest` availability without capturing images or performing recognition. Apple Intelligence SHALL NOT be required. Handwriting SHALL NOT be reported as available in this change.

#### Scenario: iOS 26 request supported
- **WHEN** the device is iOS or macOS 26+ and Vision document recognition is supported
- **THEN** `apple_vision_status` reports document scan as `available`
- **AND** `handwriting` is `unsupported` or omitted-as-unavailable
- **AND** no camera permission prompt occurs

#### Scenario: Unsupported platform
- **WHEN** the build is Android, web, or iOS below 26 (stub or `@available` false)
- **THEN** status is `unavailable` with `platform_unsupported` or `unsupported_os`
- **AND** desktop/Android import UI does not show scan/photo sources

#### Scenario: Aspirational handwriting
- **WHEN** any UI or status snapshot is shown
- **THEN** copy does not promise handwriting OCR
- **AND** printed/typed document structure is the advertised capability

### Requirement: Scan and photo import sources on EnhancedFilePicker
The system SHALL add `scan` and `photo` to `ImportSource` in `src/components/documents/EnhancedFilePicker.tsx` and SHALL gate them with platform capabilities. The system SHALL NOT introduce a separate made-up iOS-only import menu.

#### Scenario: Sources visible on capable iOS
- **WHEN** `import_document_scan` / `import_photo_library` are available
- **THEN** the picker sidebar lists Scan document and Photo beside existing sources (`local`, `folder`, `url`, `arxiv`, `screenshot`, `anki`, `json`)
- **AND** selecting them uses the same `handleSourceSelect` / `handleFileSelect` / `renderImportMethod` pattern

#### Scenario: Sources hidden elsewhere
- **WHEN** those capabilities are unavailable (Android, desktop, web, or iOS without Vision)
- **THEN** `availableImportOptions` omits `scan` and `photo`
- **AND** screenshot remains gated only by `import_screenshot`

#### Scenario: Command palette
- **WHEN** `import_document_scan` is available
- **THEN** a `scan-document` command with that `capabilityId` opens this picker flow
- **AND** when unavailable the command is filtered out like other capability-gated commands

#### Scenario: User cancels system scanner
- **WHEN** the user dismisses VisionKit document camera / picker without confirming
- **THEN** no library document is created
- **AND** the error category is `Cancelled` if surfaced
- **AND** the picker remains usable

### Requirement: Structured document preservation
The system SHALL map Vision structure into a generic `VisionBlock` DTO and then into `documents.content` as HTML or Markdown. Apple Vision types SHALL NOT be stored.

#### Scenario: Titles, paragraphs, lists, tables
- **WHEN** recognition of a fixture image yields title, paragraph, list, and table blocks
- **THEN** the saved document contains corresponding headings, paragraphs, lists, and a table
- **AND** table cell text from Vision is preserved in row/column order

#### Scenario: Unknown block
- **WHEN** Vision returns a block kind the mapper does not model
- **THEN** text is preserved as a paragraph or `unknown` block
- **AND** import still succeeds

#### Scenario: No text
- **WHEN** a fixture image yields `hasText: false`
- **THEN** an image document is still created
- **AND** the original image is in `image_assets`
- **AND** the user can edit the document body

#### Scenario: Bad image
- **WHEN** bytes cannot be decoded or the file is corrupt
- **THEN** recognition fails with `GenerationFailed` (native `ocr_failed`) or `InputTooLarge` as appropriate
- **AND** `EnhancedFilePicker` shows its existing error banner
- **AND** no half-written document is left as completed

### Requirement: Original image retained for occlusion
The system SHALL ingest the captured or picked image through `src/api/image-registry.ts` (`ingest_image_asset` / `image_assets`) and SHALL record the asset id so image occlusion can open the source image.

#### Scenario: Scan stored in registry
- **WHEN** a scan or photo import succeeds
- **THEN** `image_assets` contains the original (bounded) image
- **AND** document metadata or `image_asset_ids` references that id
- **AND** occlusion composer can resolve the asset without new geometry math

#### Scenario: Dedup
- **WHEN** the same image bytes are ingested twice
- **THEN** sha256 uniqueness on `image_assets` still applies as in `repository.rs` tests

### Requirement: Camera purpose string matches real use
The system SHALL update `NSCameraUsageDescription` in `scripts/ios-overrides/privacy-manifest.json` so it is no longer QR-only and no longer claims that no photos are recorded.

#### Scenario: Purpose string
- **WHEN** the iOS target is built with `scripts/apply-ios-project-overrides.js`
- **THEN** the camera string mentions document scanning and QR sync
- **AND** it describes on-device library storage rather than the old "no photos or video are recorded" wording
- **AND** `src-tauri/gen/apple/plethora-tauri_iOS/Info.plist` is treated as generated output

#### Scenario: Contextual camera permission
- **WHEN** the user has never scanned
- **THEN** launching the app does not request camera
- **AND** tapping Scan does request it if needed

#### Scenario: Photo picker
- **WHEN** the `photo` source uses `PHPickerViewController`
- **THEN** full Photo Library permission is not required
- **AND** if a library purpose string is added later, it is also sourced from `privacy-manifest.json`

### Requirement: Optional AI enrichment after import
The system SHALL NOT automatically run expensive summary/tag/card generation on every scan. Optional actions SHALL use existing tasks with untrusted containment.

#### Scenario: User requests tags
- **WHEN** a scanned document exists and the user runs Smart Tagging
- **THEN** `smart-tagging` runs via `runTask` on untrusted document text
- **AND** no Vision-specific tagging API is added

#### Scenario: Default import
- **WHEN** scan/photo import completes
- **THEN** cards are not created unless the user invokes Learn this / Studio or an existing global auto-tag setting that already applies to other imports

### Requirement: Existing import paths remain
Share sheet, PDF, local files, and existing OCR SHALL keep working.

#### Scenario: Share extension
- **WHEN** a file arrives via `src/lib/shareTarget.ts`
- **THEN** existing pending-share drain still imports
- **AND** failure of Vision recognition cannot delete the staged share

#### Scenario: PDF and Tesseract
- **WHEN** the user imports a PDF or uses `OCRSettings` Tesseract/cloud OCR
- **THEN** those pipelines are unchanged by this capability
- **AND** Android ML Kit OCR labels remain Android-only

### Requirement: Concurrency, size limits, and core app safety
Vision work SHALL honor the single heavy native job rule and SHALL not crash the app on failure.

#### Scenario: Busy
- **WHEN** SpeechAnalyzer or Foundation Models or a Vision batch is already in flight (D-Apple-14)
- **THEN** a second Vision start fails busy or queues with cancel support
- **AND** the picker remains responsive

#### Scenario: Oversized image
- **WHEN** decoded bytes or dimensions exceed the plugin cap
- **THEN** the command fails with `InputTooLarge`
- **AND** no unbounded blob is inserted into `image_assets`

#### Scenario: Permission denied
- **WHEN** the user denies camera for Scan
- **THEN** the result is `PermissionDenied`
- **AND** Photo picker (if it does not need camera) still works
- **AND** other import sources still work
