# pdf-cover-rendering Specification

## Purpose

Extract a PDF cover image by **rendering** the first page of the PDF to a bitmap when no embedded raster cover image is present, producing a data URL consumable by the document cover pipeline so PDFs display a real cover in the Grid View instead of an icon placeholder.

## Requirements

### Requirement: PDF cover shows first page when no embedded cover exists

For a PDF document that has no extractable embedded cover image, the system SHALL produce a cover image by rendering the first page of the PDF to a bitmap, and SHALL display that bitmap as the document's cover in the Grid View instead of the icon placeholder.

#### Scenario: Text PDF with no embedded cover image
- **WHEN** a PDF document has no embedded raster cover image on its first page (e.g. a typical academic paper or text/vector document)
- **AND** the document has no resolved `coverImageUrl`
- **THEN** the system SHALL render the first page of the PDF to a bitmap
- **AND** the rendered bitmap SHALL be displayed as the cover in the Grid View card

#### Scenario: PDF with an embedded cover image keeps existing behavior
- **WHEN** a PDF document's first page contains an embedded raster cover image (JPEG/JPEG2000)
- **THEN** the system SHALL use the embedded image as the cover (existing behavior)
- **AND** the system SHALL NOT additionally render the first page

#### Scenario: Encrypted or malformed PDF cannot be rendered
- **WHEN** the PDF cannot be opened or rendered (e.g. encrypted, corrupted)
- **THEN** the system SHALL leave the document without a rendered cover
- **AND** the Grid View SHALL display the existing icon placeholder for that document
- **AND** the failure SHALL NOT prevent other documents in the grid from rendering their covers

### Requirement: Rendered PDF covers persist through the cover pipeline

A rendered PDF cover SHALL be persisted as a data URL in the document's `cover_image_url` field with `cover_image_source = "rendered"`, so it is cached and not re-rendered on every Grid View load.

#### Scenario: First successful render is cached
- **WHEN** the first page of a PDF is successfully rendered to a cover image
- **THEN** the system SHALL store the rendered image as a data URL in `cover_image_url`
- **AND** the system SHALL set `cover_image_source` to `"rendered"`
- **AND** subsequent Grid View loads SHALL display the stored cover without re-rendering

#### Scenario: Rendered cover displayed by existing components
- **WHEN** a PDF document has a non-null `coverImageUrl`
- **THEN** the Grid View cover components (`LibraryCard` and `CompactDocumentTile`) SHALL display the cover image
- **AND** the system SHALL NOT show the icon placeholder for that document

### Requirement: Previously fallback PDFs are re-resolved

A PDF document that was previously resolved to `cover_image_source = "fallback"` (no cover found) SHALL be re-evaluated by the new render path so that existing libraries gain rendered covers without requiring user action.

#### Scenario: Existing library with fallback PDFs gains covers
- **WHEN** the Grid View loads a PDF document whose `coverImageSource` is `"fallback"`
- **AND** the document has no `coverImageUrl`
- **THEN** the system SHALL re-resolve the document's cover using the render path
- **AND** the system SHALL persist the rendered cover so the re-resolution happens only once per document

### Requirement: Render quality targets the cover tile

Rendered PDF covers SHALL be produced at a scale appropriate for the cover tile (targeting approximately twice the tile dimensions for retina sharpness) and encoded as JPEG to keep the stored data URL small.

#### Scenario: Render dimensions bounded for performance
- **WHEN** the system renders a PDF first page to a cover
- **THEN** the rendered bitmap width SHALL be bounded to approximately 400px (or the page's native width if smaller)
- **AND** the bitmap SHALL be encoded as JPEG at a moderate quality level
- **AND** the system SHALL NOT render at a scale significantly larger than needed for the cover tile

#### Scenario: Slow or runaway render is bounded
- **WHEN** rendering a PDF first page exceeds a reasonable time budget
- **THEN** the system SHALL abort the render
- **AND** the Grid View SHALL display the icon placeholder for that document
