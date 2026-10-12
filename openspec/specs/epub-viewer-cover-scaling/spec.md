# epub-viewer-cover-scaling Specification

## Purpose
Defines viewport fitting, aspect ratio preservation, and cover page layout rules for EPUB book covers and standalone images inside the reader.

## Requirements

### Requirement: EPUB cover images scale to fit the reader viewport

The system SHALL constrain EPUB cover images and standalone illustrations within the reader viewport height and width, preserving the aspect ratio so that the complete cover image is visible without being cropped or requiring vertical scrolling.

#### Scenario: Portrait cover image opened on desktop or widescreen
- **WHEN** a user opens an EPUB document whose cover section contains a portrait cover image
- **THEN** the cover image SHALL NOT exceed the visible height of the reader viewport
- **AND** the complete cover image SHALL be visible in the viewport without vertical cutoff

#### Scenario: Aspect ratio is preserved
- **WHEN** an EPUB cover image is scaled to fit within the reader viewport
- **THEN** the image aspect ratio SHALL be preserved without stretching or distortion
- **AND** the image SHALL use contain-style scaling centered within the available area

### Requirement: SVG cover wrappers scale and adapt to viewport bounds

The system SHALL normalize and constrain SVG-wrapped covers (including Calibre cover pages) so that `<svg>` elements respect the reader viewport height and width, maintaining aspect ratio through valid `viewBox` and `preserveAspectRatio` attributes.

#### Scenario: Calibre SVG cover page
- **WHEN** an EPUB document contains a cover wrapped in an `<svg>` element with an embedded `<image>`
- **THEN** the `<svg>` element SHALL scale within the reader viewport dimensions
- **AND** the cover image inside the SVG SHALL not overflow the reader window

#### Scenario: SVG missing viewBox or with fixed dimensions
- **WHEN** an EPUB cover contains an `<svg>` with fixed pixel dimensions or missing `viewBox`
- **THEN** the reader SHALL normalize the SVG attributes to include a valid `viewBox` and aspect ratio constraint
- **AND** the SVG SHALL scale responsively to fit the reader area

### Requirement: Cover pages eliminate obstructive body padding and center content

The reader SHALL detect EPUB cover sections and remove excessive body padding (such as default bottom reading padding) and center the cover image vertically and horizontally in the reader window.

#### Scenario: Cover section opened
- **WHEN** an EPUB cover section is rendered in the reader
- **THEN** the cover section container SHALL center the cover image
- **AND** the reader SHALL eliminate intrusive bottom reading padding so the cover fits cleanly within the screen

### Requirement: In-reader images respect viewport boundaries on container resize

The reader SHALL propagate reader container dimensions to the EPUB iframe documents and update viewport constraints whenever the reader window or container is resized.

#### Scenario: Window resize adjusts cover size
- **WHEN** the reader window is resized while an EPUB cover is displayed
- **THEN** the reader viewport dimension CSS variables SHALL update to match the new container height and width
- **AND** the displayed cover SHALL adapt smoothly to the new dimensions without overflowing
