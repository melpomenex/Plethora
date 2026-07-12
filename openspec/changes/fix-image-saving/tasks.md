## 1. Implement Local Asset Fallback

- [x] 1.1 Add helper function `getFilePathFromUrl` to extract local file paths from `asset://`, `https://asset.localhost/`, `http://asset.localhost/`, `asset://`, and `file://` URLs.
- [x] 1.2 Update the `handleSave` function in `ImageSaveOverlay.tsx` to handle failures in `fetch()` by falling back to `@tauri-apps/plugin-fs` reading.
- [x] 1.3 Map the file extension to the corresponding MIME type when reading via the filesystem API.

## 2. Validation

- [x] 2.1 Verify that the TypeScript codebase builds and there are no type errors or lints.
- [x] 2.2 Verify that the test suite passes.
