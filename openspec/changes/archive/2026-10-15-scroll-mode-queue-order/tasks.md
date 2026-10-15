## 1. i18n & Queue UI Enhancements

- [x] 1.1 Add localized strings for Scroll Mode subtext ("Queue List Order"), updated tooltips, and labels across locales.
- [x] 1.2 Update "Scroll Mode" button in `ReviewQueueView` to render clear UX subtext/tooltip and pass `visibleItems` to `onOpenScrollMode`.
- [x] 1.3 Update `MobileQueueView` to pass ordered items when triggering Scroll Mode.

## 2. Tab Payload & Router Wiring

- [x] 2.1 Update `handleOpenScrollMode` in `QueueTab.tsx` and `QueuePage.tsx` to accept optional `customQueueItems` and `queueScrollMode` parameters.
- [x] 2.2 Store `customQueueItems` and `queueScrollMode: "queue-list"` in the created `queue-scroll` tab data.

## 3. QueueScrollPage Sequential Mode

- [x] 3.1 Inspect tab data in `QueueScrollPage.tsx` for `queueScrollMode` and `customQueueItems`.
- [x] 3.2 Implement sequential `ScrollItem` mapping for `queue-list` mode preserving exact queue sequence and disabling variety mixing reordering.

## 4. Verification

- [x] 4.1 Verify UI button styling, subtext, and tooltips in desktop and mobile views.
- [x] 4.2 Run existing tests and add unit tests verifying `onOpenScrollMode` receives queue items and opens tab correctly.
