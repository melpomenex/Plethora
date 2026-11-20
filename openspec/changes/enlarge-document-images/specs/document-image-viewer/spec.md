## Purpose

Lets readers inspect embedded document images at a useful size in a focused viewer while preserving their place and interaction state in the document.

## ADDED Requirements

### Requirement: Embedded document images open in an accessible viewer
The document reader SHALL let users open rendered inline images in Markdown, imported HTML/article documents, EPUBs, and PDF reflow content. Each image SHALL have a discoverable enlarge affordance, be keyboard reachable, and expose an accessible name derived from its alternative text or caption.

#### Scenario: Open an image with a pointer or touch
- **WHEN** a user clicks or taps an embedded image in a supported document reader
- **THEN** the image opens in an overlay viewer above the current document
- **AND** the overlay displays the image's alternative text or caption when available
- **AND** the reader remains at the same location behind the overlay

#### Scenario: Open an image with a keyboard
- **WHEN** a user focuses an embedded image and activates it with Enter or Space
- **THEN** the same overlay viewer opens and receives keyboard focus

#### Scenario: An embedded image has no descriptive text
- **WHEN** an image has neither alternative text nor a nearby caption
- **THEN** it remains operable and the viewer exposes a localized generic image-viewer name

### Requirement: The image viewer fits and enlarges images without cropping
The viewer SHALL initially scale the selected image to fit the usable viewport while preserving its aspect ratio. It SHALL provide controls to zoom in, zoom out, fit to viewport, and view at 100 percent. Users SHALL be able to pan an image when the current zoom extends beyond the viewport.

#### Scenario: Open an image larger than the viewport
- **WHEN** the image is larger than the available viewer area
- **THEN** the full image is visible initially without cropping or distortion
- **AND** the user can zoom in and pan to inspect details

#### Scenario: Use zoom controls
- **WHEN** the user selects zoom in, zoom out, fit, or 100 percent
- **THEN** the image scale updates without changing the image's aspect ratio
- **AND** fit restores the whole image within the available viewer area

#### Scenario: Zoom with desktop or touch gestures
- **WHEN** the user uses the mouse wheel or a touch pinch gesture over the image
- **THEN** the image zoom level changes
- **AND** dragging the zoomed image pans it without scrolling the document behind the overlay

### Requirement: Closing the viewer returns the reader to its prior state
The viewer SHALL provide a visible close control and support Escape and backdrop activation to dismiss. It SHALL keep focus within the modal while open and return focus to the activating image or its reader surface when closed. Closing SHALL preserve the document's scroll position, page or chapter, and existing text selection.

#### Scenario: Dismiss with the close control or Escape
- **WHEN** the user activates the close control or presses Escape
- **THEN** the viewer closes
- **AND** focus returns to the image that opened it, or to its owning reader surface if the image is no longer mounted
- **AND** the document remains at the same reading location and retains its prior text selection

#### Scenario: Dismiss by activating the backdrop
- **WHEN** the user activates the overlay backdrop outside the image and its controls
- **THEN** the viewer closes and returns to the prior reader state

#### Scenario: Interact within the viewer
- **WHEN** the user activates the image or a viewer control
- **THEN** the viewer remains open
- **AND** the document beneath it does not receive the interaction or scroll

### Requirement: Existing image and PDF reading surfaces remain compatible
The embedded-image viewer SHALL use the currently rendered image source, including the browser-selected source where responsive image sources are present. The whole-page PDF original view and image-only document viewer SHALL retain their existing zoom and pan interactions.

#### Scenario: View an image rendered from a document asset
- **WHEN** an embedded image uses a resolved local asset or responsive image source
- **THEN** the viewer displays that same resolved image without fetching a second copy from an unrelated source

#### Scenario: Use whole-page PDF or image-only document zoom
- **WHEN** the user zooms a PDF in Original view or opens an image-only document
- **THEN** the existing whole-page PDF or image-document zoom behavior remains available
