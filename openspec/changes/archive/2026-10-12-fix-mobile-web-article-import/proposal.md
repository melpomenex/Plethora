## Why

On mobile devices, opening the Web Article Import dialog (`WebArticleImportDialog`) produces severe visual corruption and usability defects:
1. The dialog surface uses `bg-background` which resolves to `transparent !important` under scenic and jellyfish themes, causing underlying library contents (document lists, filters, headers) to bleed directly through the dialog text.
2. The modal is not portalled to `document.body`, causing it to render inside the mobile content wrapper and clash with the mobile bottom navigation bar.
3. The layout relies on a desktop-centric horizontal two-column split (`flex w-96` options panel + `flex-1` preview pane) that severely overflows narrow mobile screens, pushing the preview panel completely offscreen and trapping or cutting off primary actions like "Import to Library".

## What Changes

- **Portal rendering & opaque surface**: Portal `WebArticleImportDialog` to `document.body` via `createPortal`, and enforce an opaque modal surface (`bg-card` / `modal-content` / surface container high) with a backdrop scrim that prevents background library items from bleeding through regardless of the active theme.
- **Mobile shell adaptation**: Detect mobile presentation via `useMobileShell()`, expanding the dialog to a mobile-optimized full-screen modal with safe-area padding (`env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`), mobile navigation hierarchy (top back button + close), and a properly docked sticky action bar.
- **Responsive preview & flow**: Replace the rigid horizontal two-column layout on mobile with an adaptive view: on mobile viewports, stack sections or provide a mobile segment switcher between input/options and article preview once fetched, ensuring users can inspect article titles, reading stats, and content preview before confirming import.
- **Touch-friendly controls**: Optimize URL input, quick tags, custom tag chips, and format toggles (PDF vs HTML) for narrow mobile viewports and touch targets.

## Capabilities

### New Capabilities
- `mobile-web-article-import`: Defines requirements for the responsive, mobile-optimized Web Article Import dialog including opaque surface rendering, mobile screen adaptation, safe-area compliance, and accessible preview inspection on mobile viewports.

### Modified Capabilities
<!-- None: toolbar-url-import-modal triggers and store contracts remain unchanged -->

## Impact

- **UI Components**: `src/components/import/WebArticleImportDialog.tsx` updated with `createPortal`, `useMobileShell()`, responsive layout refactoring, and surface styling.
- **Theme/Styling**: Ensures modal surface classes prevent background bleed across all dark/light/jellyfish/scenic theme configurations.
- **Tests**: Add unit and regression tests for `WebArticleImportDialog` testing mobile vs desktop rendering, portal presence, and preview accessibility.
