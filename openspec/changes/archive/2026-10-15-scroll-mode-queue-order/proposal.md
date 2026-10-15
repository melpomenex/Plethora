## Why

Currently, clicking the "Scroll Mode" button in the Queue header triggers the exact same behavior as "Start Optimal Session" (launching Scroll Mode with FSRS/variety-mixed session items). This duplicate behavior causes confusion and deprives users of a quick, full-screen vertical scrolling experience that follows the exact filtered and sorted order of the Reading Queue list.

## What Changes

- Update the "Scroll Mode" action in the Queue view (`ReviewQueueView` and `MobileQueueView`) to launch Scroll Mode populated with the current Queue List's visible items in exact sequence.
- Enhance the UI styling, button text, and tooltext/subtext for "Scroll Mode" to clearly communicate in a high-quality UX way that it scrolls through the active Queue List order (e.g., subtext "Queue List Order" / "Sequential Flow").
- Pass the Queue List items and ordering context to `QueueScrollPage` when launched from the "Scroll Mode" button.
- Ensure `QueueScrollPage` respects the explicit Queue List order when launched in this mode while maintaining existing Optimal Session behavior for "Start Optimal Session".

## Capabilities

### New Capabilities
- `scroll-mode-queue-order`: Launches Scroll Mode maintaining the exact visible sequence and filtered items of the Reading Queue list.

### Modified Capabilities

## Impact

- `src/components/review/ReviewQueueView.tsx`: Button UI, subtext/tooltip, and click handler for Scroll Mode.
- `src/components/mobile/MobileQueueView.tsx`: Mobile action bar & Scroll Mode trigger updating to pass queue list order.
- `src/components/tabs/QueueTab.tsx` & `src/pages/QueuePage.tsx`: Passing ordered queue items or queue-order parameter when building the tab state for `queue-scroll`.
- `src/pages/QueueScrollPage.tsx`: Handling queue-order mode to display items sequentially based on the passed list without applying variety mixing reordering.
- `src/lib/i18n/locales/*.ts`: New i18n keys for Scroll Mode tooltip, subtext, and label.
