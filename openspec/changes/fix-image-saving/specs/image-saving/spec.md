## ADDED Requirements

### Requirement: Local asset saving support
The system SHALL support saving images to the image registry from any hovered image with local asset or filesystem protocols (such as `asset://`, `https://asset.localhost/`, and `file://`).

#### Scenario: User clicks save on image with local asset protocol
- **WHEN** the user clicks the "Save to Image Registry" button on an image with a local asset URL
- **THEN** the system parses the local filesystem path from the URL, reads the image file using `@tauri-apps/plugin-fs`, and ingests the image blob into the image registry.
