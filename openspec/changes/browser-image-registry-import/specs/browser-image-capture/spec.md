## ADDED Requirements

### Requirement: Context menu image capture
The browser extension SHALL register a context menu action "Save Image to Plethora" under the "image" context that allows users to save any clicked image directly to their Plethora Image Registry in a single action without mandatory dialogs.

#### Scenario: User saves image from right-click context menu
- **WHEN** the user right-clicks an image in the browser and selects "Save Image to Plethora"
- **THEN** the extension SHALL extract the image data and associated metadata from the page
- **AND** transmit the payload to the local Plethora desktop server

### Requirement: Extraction of diverse web image formats and sources
The extension MUST extract image content from standard `<img>` tags, `<picture>` elements, `srcset` attributes, CSS `background-image`, `<canvas>` elements, inline data URLs, blob URLs, and CORS-restricted or authenticated resources by executing extraction in the active page DOM context.

#### Scenario: Capturing responsive srcset or picture image
- **WHEN** the user triggers capture on an image within a `<picture>` element or with a `srcset` attribute
- **THEN** the content script SHALL select the highest resolution available source or the currently rendered bitmap data

#### Scenario: Capturing canvas or blob URL image
- **WHEN** the user triggers capture on a `<canvas>` element or an image with a `blob:` URL
- **THEN** the content script SHALL export the rendered pixel data via canvas `toBlob()` / `toDataURL()` or fetch the local blob within the page context

### Requirement: Provenance metadata extraction
The extension SHALL automatically collect contextual provenance metadata during image capture and include it with the ingestion payload.

#### Scenario: Contextual metadata collection
- **WHEN** an image is captured from a web page
- **THEN** the extension SHALL collect the page URL, page title, image `alt` text, nearest `<figcaption>` or surrounding paragraph text, author/domain, image dimensions, and capture timestamp
- **AND** attach these fields in the `captureContext` payload

### Requirement: Non-intrusive feedback toast and offline queue
The extension SHALL provide instant confirmation upon capture and queue items locally when the Plethora desktop app is unreachable.

#### Scenario: Successful image save feedback
- **WHEN** the image is successfully ingested into Plethora
- **THEN** the extension SHALL display an unobtrusive in-page toast stating "Saved to Image Registry" along with any auto-detected tags and a link to view the image

#### Scenario: Desktop app offline queueing
- **WHEN** the user saves an image while the Plethora desktop app is closed or unreachable
- **THEN** the extension SHALL store the image payload in `chrome.storage.local` queue
- **AND** automatically flush and ingest the queued items when connection to the desktop app is restored
