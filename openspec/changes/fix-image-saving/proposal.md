## Why

In the desktop app (macOS/WebKit), clicking the "Save to Image Registry" button on an image hover does nothing. WebKit blocks the frontend `fetch()` API from fetching custom/cross-origin protocols (such as `asset://` or `https://asset.localhost/` or `file://`). Since the app uses these protocols to display local document and ebook images, the fetch fails, preventing the image from being saved to the registry.

## What Changes

- Update `ImageSaveOverlay` to handle local `asset://`, `file://`, and `https://asset.localhost` URLs by parsing the filesystem path from the URL.
- Fall back to reading the file using Tauri's `@tauri-apps/plugin-fs` if a direct HTTP/HTTPS `fetch` fails or is not applicable.
- Ensure the MIME type is correctly inferred from the file extension when reading via Tauri FS.
- Gracefully handle errors and notify users of success or failure.

## Capabilities

### New Capabilities
- `image-saving`: The system SHALL support saving images to the image registry from any hovered image.

### Modified Capabilities
<!-- None -->

## Impact

- `src/components/viewer/ImageSaveOverlay.tsx`: Modified to handle local file protocols via `@tauri-apps/plugin-fs` fallback.
- No impact on existing APIs, schemas, or database tables.
