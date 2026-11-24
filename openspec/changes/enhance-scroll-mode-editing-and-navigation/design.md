# Technical Design: Scroll Mode Editing and Navigation Enhancements

## 1. Extract Image Insertion in Scroll Mode (`FEAT-01`)
- `src/components/review/ExtractScrollItem.tsx`:
  - Reuse `ingestImageFile` / `ingestImageBlob` / `getImageAssetById` from `src/api/image-registry.ts` (same storage & deduplication pipeline as `CreateExtractDialog`).
  - Add an `Insert Image` toolbar button (file picker), `onPaste` image handler, and `onDrop` image handler on the extract editor.
  - Render existing/newly inserted images from `extract.html_content` (and `attachedImages`) cleanly within the extract card (`max-w-full h-auto rounded`) with remove buttons, without resetting scroll position.
  - Persist `html_content` (sanitized via `DOMPurify` with `<figure><img .../></figure>`) via `updateExtract({ id, content, html_content, note })` and propagate `html_content` in `onUpdate` -> `QueueScrollPage.tsx::handleExtractUpdate`.

## 2. Configurable Mouse-Wheel Navigation (`FEAT-02`)
- `src/stores/settingsStore.ts`:
  - Add `wheelNavigationEnabled: boolean` to `ScrollQueueSettings` (default `true` to preserve existing behavior, persisted in `settingsStore`).
- `src/pages/QueueScrollPage.tsx` & `src/components/media/RSSScrollMode.tsx`:
  - Read `settings.scrollQueue.wheelNavigationEnabled`. When `false`, the wheel listener returns immediately without calling `goToNext()` / `goToPrevious()`, while normal content scrolling and explicit Next/Previous buttons and keyboard shortcuts remain fully functional.
- `src/components/queue/ScrollQueueSettings.tsx` & `src/components/settings/SmartQueuesSettings.tsx`:
  - Expose the "Mouse-wheel item navigation" toggle with clear description.
  - Wrap the Settings control in `<SettingsSearchTarget id="smartQueue.wheelNavigation" ...>` and register it in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts` per `AGENTS.md`.
