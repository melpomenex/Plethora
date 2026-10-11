## Why

The current mobile pull-to-refresh indicator is a small spinner and text label, so it gives little visual response while the user pulls or waits. Queue and document content already share the same interaction component, making a consistent, more expressive refresh animation useful across both surfaces.

## What Changes

- Replace the basic pull indicator with one shared animation that reflects pull progress, threshold activation, refresh in progress, and the final outcome.
- Use the same visual treatment for the mobile Queue and mobile document views, wiring the shared interaction into the actual document-viewer surface.
- Keep refresh feedback localized near the top of the content and preserve the existing one-time threshold haptic.
- Localize the shared refresh labels and make transitions respect reduced-motion preferences.
- Ensure refresh failures reach the shared indicator so a failed operation is not presented as a successful update.

## Capabilities

### New Capabilities
- `mobile-pull-to-refresh`: Shared mobile pull-to-refresh interaction and visual feedback for Queue and document content.

### Modified Capabilities

## Impact

- `src/components/mobile/PullToRefresh.tsx` for shared gesture state and visual states.
- `src/components/mobile/MobileQueueView.tsx`, `src/components/mobile/MobileDocumentWrapper.tsx`, and `src/components/viewer/DocumentViewerWrapper.tsx` for mobile surface integration and refresh outcome handling. The mobile document helper currently has no repository call sites, so the change must connect the interaction to the live document-viewer surface.
- `src/styles/mobile.css` and localization resources for animation styling and labels.
- No new dependencies or backend APIs are expected.
