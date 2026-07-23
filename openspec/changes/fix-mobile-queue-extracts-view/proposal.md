## Why

When a user is reading an EPUB in Queue/Scroll Mode and taps the overlay's Extracts view, the extracts surface is rendered inside a pane with `overflow-hidden` but no replacement scroll container. On mobile this clips the list so users cannot reach extracts below the fold, while the page heading is rendered flush against the pane edge and can appear to bleed into the screen edge on narrow devices such as the Boox Palma 2.

## What Changes

- Make the Queue/Scroll Mode Extracts view a bounded, touch-friendly vertical scroll surface that can display the complete extracts list on mobile and desktop.
- Add responsive horizontal and bottom insets around the Extracts view so the `Extracts` heading, cards, controls, and final content remain inside the viewport and clear device safe areas.
- Keep the existing extract loading, selection, editing, deletion, card-generation, and navigation behavior unchanged.
- Preserve the overlay view-mode controls while ensuring switching into Extracts does not leave the view clipped by its parent layout.
- Add regression coverage for the scroll container and narrow/mobile layout contract where the project’s existing test strategy supports it.

## Capabilities

### New Capabilities

- `mobile-queue-extracts-view`: Defines the responsive layout, viewport containment, and vertical scrolling behavior for the document Extracts view opened from Queue/Scroll Mode.

### Modified Capabilities

<!-- No existing repository capability has requirements for this specific Queue/Scroll Mode surface. -->

## Impact

- **Code**: `src/pages/QueueScrollPage.tsx` will own the bounded scroll region around the alternate document view; `src/components/extracts/ExtractsList.tsx` and/or shared responsive styles will provide the required content insets.
- **Tests**: Queue/Extracts component or layout tests may be added to verify that the list is scrollable and the heading is inset at narrow widths.
- **Behavior**: No API, persistence, extract-data, or scheduling changes. The change is limited to presentation and scrolling for the existing Queue/Scroll Mode Extracts view.
- **Risk**: Low to moderate. The primary risk is changing overflow ownership in a full-screen reader layout, so the implementation must preserve the EPUB viewer’s existing scrolling and overlay controls when the user switches back to Document view.
