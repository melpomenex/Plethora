## 1. Browser Extension Handoff

- [x] 1.1 Add `create-image-occlusion` context menu item in `browser_extension/background.js` under the `image` context.
- [x] 1.2 Implement the capture-and-handoff flow: ingest the image to `POST /api/image-registry/ingest` and send the launch signal with `assetId`.
- [x] 1.3 Add toast notification in the browser confirming handoff and indicating the desktop composer is opening.

## 2. Desktop Window Activation & Composer Preloading

- [x] 2.1 Update `src-tauri/src/browser_sync_server.rs` to handle occlusion creation requests by focusing the main app window (`set_focus()`) and emitting `plethora:create-image-occlusion` event with `assetId`.
- [x] 2.2 Verify `OcclusionComposerHost.tsx` mounts and initializes `ImageOcclusionComposer` with the received `assetId`.
- [x] 2.3 Add deep-link URI handler for `plethora://occlusion/create?assetId=<id>`.

## 3. Automatic Label Detection & Assistive Authoring

- [x] 3.1 Add "Auto-detect labels" action button in `ImageOcclusionComposer.tsx` toolbar.
- [x] 3.2 Wire "Auto-detect labels" to call `ocrImageLabelsForOcclusion` (`src/api/ocrCommands.ts`), filtering raw OCR words into candidate bounding boxes and landing them in `session.suggestions`.
- [x] 3.3 Ensure candidate masks render with dashed suggestion styling on `OcclusionCanvas.tsx` with "Accept", "Edit", and "Dismiss" controls.
- [x] 3.4 Ensure saving generated cards outputs items with shared `occlusionSetId` and default "Hide All, Guess One" review configuration.

## 4. Verification & Testing

- [x] 4.1 Test browser context menu triggering end-to-end handoff to desktop composer.
- [x] 4.2 Test local OCR label detection on sample diagram images without internet access.
- [x] 4.3 Test candidate mask review, editing, and card generation into the review queue.
- [x] 4.4 Verify review behavior of generated cards conforms to Change 1 specifications.
