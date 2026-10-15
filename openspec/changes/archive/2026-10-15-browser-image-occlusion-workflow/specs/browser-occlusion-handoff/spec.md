## ADDED Requirements

### Requirement: Direct context menu action for occlusion creation
The browser extension SHALL provide a context menu action "Create Image Occlusion in Plethora" on images that captures the image into the Image Registry and opens the desktop Image Occlusion Composer in a single coordinated workflow.

#### Scenario: User initiates occlusion creation from browser
- **WHEN** the user right-clicks an image on a web page and selects "Create Image Occlusion in Plethora"
- **THEN** the extension SHALL capture the image bytes and provenance
- **AND** ingest the asset into the local Plethora Image Registry
- **AND** signal the desktop app to open the composer for that asset

### Requirement: Desktop app activation and composer preloading
The desktop application MUST bring its window into focus and open the `ImageOcclusionComposer` with the newly captured image asset loaded and ready for mask creation.

#### Scenario: Opening composer from browser trigger
- **WHEN** the desktop application receives the handoff signal with an `assetId`
- **THEN** the app window SHALL come to the foreground
- **AND** the global `OcclusionComposerHost` SHALL open `ImageOcclusionComposer` displaying the source image

#### Scenario: Desktop app offline error handling
- **WHEN** the user triggers occlusion creation while the Plethora desktop app is closed
- **THEN** the browser extension SHALL save the image in the local offline queue
- **AND** display a toast message indicating the card authoring session will open when Plethora is launched
