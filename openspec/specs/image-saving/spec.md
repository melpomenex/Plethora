# image-saving Specification

## Purpose
In the desktop app (macOS/WebKit), clicking the "Save to Image Registry" button on an image hover does nothing. WebKit blocks the frontend fetch() API from fetching custom/cross-origin protocols (such as asset:// or https://asset.localhost/ or file://). Since the app uses these protocols to display local document and ebook images, the fetch fails, preventing the image from being saved to the registry.

## Requirements

### Requirement: Local asset saving support
The system SHALL support saving images to the image registry from any hovered image with local asset or filesystem protocols (such as `asset://`, `https://asset.localhost/`, and `file://`).

#### Scenario: User clicks save on image with local asset protocol
- **WHEN** the user clicks the "Save to Image Registry" button on an image with a local asset URL
- **THEN** the system parses the local filesystem path from the URL, reads the image file using `@tauri-apps/plugin-fs`, and ingests the image blob into the image registry.
