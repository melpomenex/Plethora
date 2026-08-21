## 1. Browser Extension Context Menu & Extraction

- [ ] 1.1 Add the `save-image-to-registry` context menu item for the `image` context in `browser_extension/background.js`.
- [ ] 1.2 Implement `extractImageAndProvenance` in `browser_extension/content.js` to extract image bytes/dataURL from `<img>`, `<picture>`, `srcset`, `<canvas>`, and CSS backgrounds along with alt text, captions, and page metadata.
- [ ] 1.3 Add cross-origin handling with in-page fetch and canvas fallback, reporting clear errors if image data cannot be accessed.
- [ ] 1.4 Implement client-side size checks against `TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES` (7 MB) in `browser_extension/shared.js`.

## 2. Ingestion Endpoint & Backend Validation

- [ ] 2.1 Add `POST /api/image-registry/ingest` route and request handler in `src-tauri/src/browser_sync_server.rs` accepting base64 image data and provenance metadata.
- [ ] 2.2 Implement SHA-256 deduplication in Rust to return the existing `ImageAssetDto` when identical content is ingested.
- [ ] 2.3 Add SVG sanitization to strip `<script>` tags, inline event handlers, and external entities before saving.
- [ ] 2.4 Enforce maximum decoded dimensions (16,384 x 16,384) and MIME validation on incoming images.
- [ ] 2.5 Emit `browser-sync://image-asset-saved` event to notify open desktop windows when an image is saved.

## 3. Smart Tagging & Offline Queue

- [ ] 3.1 Connect image ingestion to `queued_browser_organization` in `src-tauri/src/browser_sync_server.rs` to process page title, alt text, caption, and domain for automatic tag assignment.
- [ ] 3.2 Implement `pendingImageImports` queue in `chrome.storage.local` in `browser_extension/background.js` to store failed captures and replay them when connection is restored.
- [ ] 3.3 Add in-page feedback toast notification in `browser_extension/content.js` confirming image import with assigned tags and view action.

## 4. Verification & Testing

- [ ] 4.1 Add automated tests in `browser_extension/tests/` for context menu handling, payload creation, and size budgeting.
- [ ] 4.2 Add Rust backend tests in `src-tauri/src/browser_sync_server.rs` testing deduplication, SVG sanitization, and invalid payload rejection.
- [ ] 4.3 Test image capture across diverse web elements (`<img>`, `srcset`, `<canvas>`, blob URLs) and verify they appear in Plethora's Image Registry.
