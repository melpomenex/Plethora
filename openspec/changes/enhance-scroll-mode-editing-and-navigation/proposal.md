# Change: Enable Extract Image Insertion and Configurable Wheel Navigation in Scroll Mode

Covers **FEAT-01** (insert images into extracts during Scroll Mode) and **FEAT-02** (configurable preference to disable mouse-wheel-driven Scroll Mode navigation).

## Why

1. **FEAT-01 (Image insertion in Scroll Mode extracts):** `ExtractScrollItem.tsx` renders only a plain `<textarea>`, ignores `extract.html_content`, and lacks image paste, drag-and-drop, and Image Registry picker support.
2. **FEAT-02 (Disable mouse-wheel Scroll Mode navigation):** `QueueScrollPage.tsx` and `RSSScrollMode.tsx` attach wheel listeners that advance to the next/previous item at scroll boundaries without a user preference to disable wheel-driven item navigation.

## What Changes

- **Scroll Mode extract image insertion (`FEAT-01`):** Add image insertion (file picker, clipboard paste, drag-and-drop, and Image Registry reuse via `src/api/image-registry.ts`) to `ExtractScrollItem.tsx`, render and persist `html_content` alongside `content`/`notes` in `QueueScrollPage.tsx::handleExtractUpdate` and `updateExtract`, and allow removing inserted images without losing reading position.
- **Configurable mouse-wheel navigation (`FEAT-02`):** Add `wheelNavigationEnabled: boolean` (default `true` to preserve existing behavior, configurable to `false`) to `ScrollQueueSettings` in `src/stores/settingsStore.ts`, wire it into `QueueScrollPage.tsx` and `RSSScrollMode.tsx`, expose it in `ScrollQueueSettings.tsx` AND the main Settings UI (`SmartQueuesSettings.tsx`) with required `settingsSearchCatalog.ts` / `settingsSearchCoverage.ts` entries.
