## Why

Users frequently encounter high-value visual learning materials on the web—such as anatomy diagrams, architecture charts, maps, and technical illustrations—that they want to keep in Plethora's Image Registry for flashcards and notes. Currently, the browser extension only captures web pages, links, and text extracts. Saving an image requires manual download to disk, switching to the desktop app, navigating to the Image Registry, and uploading through the file picker. This high-friction flow causes users to lose valuable visuals while reading.

## What Changes

- **Browser Context-Menu Action**: Add a dedicated "Save Image to Plethora" context menu entry when right-clicking images, canvas elements, and background images in the browser.
- **Robust In-Browser Extraction**: Capture images directly within the page context to handle complex scenarios: `srcset` resolution, lazy-loaded images, canvas renders, CSS background images, blob/data URLs, and authenticated/CORS-restricted resources.
- **Rich Provenance Metadata**: Automatically extract and store source page URL, page title, alt text, nearby caption, author/domain, original filename, MIME type, dimensions, and capture timestamp alongside the image asset.
- **Backend Ingestion API**: Add an ingestion endpoint on the local Browser Sync Server (`POST /api/image-registry/ingest` and `/` payload variant) that receives binary/base64 image data, performs SHA-256 deduplication, and stores canonical `image_assets`.
- **Security & Safety Guardrails**: Enforce MIME validation, decode dimension limits (preventing decompression bombs), and SVG script sanitization before storage.
- **Smart Tagging Integration**: Automatically queue imported images for smart tagging, matching existing user tags and applying deterministic domain signatures without requiring paid AI inference.
- **Non-Intrusive Feedback & Offline Queue**: Display a lightweight confirmation toast in the browser upon save with applied tags, and queue captures locally in `chrome.storage.local` if the desktop app is offline.

## Capabilities

### New Capabilities
- `browser-image-capture`: Browser extension context-menu capture, in-page DOM/canvas extraction, provenance metadata gathering, offline queueing, and toast feedback.
- `image-registry-ingest-api`: HTTP/IPC ingestion endpoint on browser sync server with deduplication, security validation, and smart tagging integration.

### Modified Capabilities

## Impact

- **Browser Extension**: `browser_extension/manifest.json`, `browser_extension/background.js`, `browser_extension/content.js`, `browser_extension/shared.js` updated with context menu, canvas/blob extraction, and toast UI.
- **Backend Sync Server**: `src-tauri/src/browser_sync_server.rs` updated with image ingestion route and security validation.
- **Database & Image Registry**: `src-tauri/src/commands/image_registry.rs`, `src/api/image-registry.ts` integrated with provenance fields.
- **Smart Tagging**: `src/lib/smartTagging/browserImportOrganization.ts` extended to handle image registry capture context.
