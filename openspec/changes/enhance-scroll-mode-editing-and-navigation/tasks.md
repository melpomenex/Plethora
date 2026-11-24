## 1. Extract Image Insertion in Scroll Mode (FEAT-01)
- [ ] 1.1 Update `ExtractScrollItem.tsx` to render `extract.html_content` images, support file picker, paste, drag-and-drop image insertion via `image-registry.ts`, and image removal.
- [ ] 1.2 Update `ExtractScrollItem.tsx` auto-save and `QueueScrollPage.tsx::handleExtractUpdate` to persist and propagate `html_content`.

## 2. Configurable Mouse-Wheel Navigation (FEAT-02)
- [ ] 2.1 Add `wheelNavigationEnabled` (default `true`) to `ScrollQueueSettings` in `src/stores/settingsStore.ts`.
- [ ] 2.2 Respect `wheelNavigationEnabled` in `QueueScrollPage.tsx` and `RSSScrollMode.tsx` wheel handlers.
- [ ] 2.3 Add toggle UI to `ScrollQueueSettings.tsx` and `SmartQueuesSettings.tsx`, and register `smartQueue.wheelNavigation` in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`.

## 3. Regression Tests
- [ ] 3.1 Add Vitest tests for `ExtractScrollItem` image insertion, removal, and `html_content` persistence.
- [ ] 3.2 Add Vitest tests for `wheelNavigationEnabled` persistence, wheel navigation suppression when disabled, and Settings search coverage.
