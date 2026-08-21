## ADDED Requirements

### Requirement: Image registry ingestion endpoint on Browser Sync Server
The local Browser Sync Server SHALL expose an endpoint accepting image payloads from the browser extension and persisting them into the canonical `image_assets` table.

#### Scenario: Ingesting valid image payload
- **WHEN** the browser extension POSTs a base64/binary image payload with metadata to `/api/image-registry/ingest`
- **THEN** the server SHALL validate, decode, and store the image in `image_assets`
- **AND** return a JSON response containing the created or matched `asset_id` and metadata

### Requirement: SHA-256 content deduplication
The system MUST compute the SHA-256 hash of every ingested image and avoid creating duplicate asset records if the exact image content already exists.

#### Scenario: Duplicate image payload received
- **WHEN** an ingested image has the same SHA-256 hash as an existing registry asset
- **THEN** the server SHALL reuse the existing record without duplicating storage
- **AND** return the existing asset ID with `is_duplicate: true`

### Requirement: Ingestion safety and sanitization
The system MUST enforce strict safety guardrails on all ingested image data, including MIME verification, dimension limits, and SVG sanitization.

#### Scenario: Ingesting SVG with script content
- **WHEN** an SVG image containing `<script>`, inline event handlers (`onload`), or external entity declarations is submitted
- **THEN** the system SHALL strip all active script content and external entities prior to storage or rasterize the vector safely to PNG

#### Scenario: Ingesting oversized or decompression bomb image
- **WHEN** an image payload exceeds the 10 MB payload limit or decodes to pixel dimensions exceeding 16,384 x 16,384
- **THEN** the system SHALL reject the ingestion with an informative HTTP 400/413 error status

### Requirement: Smart tagging integration for imported images
The system SHALL route newly imported images through Plethora's smart tagging system, applying user vocabulary and domain signatures from the capture context.

#### Scenario: Deterministic smart tagging without cloud AI
- **WHEN** an image is imported with page title, alt text, and URL domain while no external LLM is configured
- **THEN** the smart tagging system SHALL apply matching user tags and domain keywords deterministically without making external network calls

#### Scenario: LLM-assisted refinement when configured
- **WHEN** the user has a local or cloud LLM provider configured and enabled
- **THEN** the image organization task SHALL refine and assign high-confidence semantic tags in the background
