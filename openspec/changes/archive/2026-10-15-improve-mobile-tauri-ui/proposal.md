## Why

Incrementum already contains a mobile shell and a capable desktop interface, but responsive behavior is uneven across feature pages and the Tauri window still feels like a web layout inside a native container. A focused platform-adaptive UI pass is needed now so phone, tablet, and desktop users can reach core reading, queue, review, import, and settings workflows without clipped content, undersized controls, competing navigation patterns, or wasted window space.

## What Changes

- Establish a single responsive app-shell contract for phone, tablet, compact desktop, and full desktop layouts, including safe-area handling and dynamic viewport sizing.
- Refine mobile navigation around a small set of primary destinations, a discoverable overflow surface, persistent context, and predictable system/back gestures.
- Standardize touch ergonomics across high-use workflows with reachable primary actions, minimum target sizes, bottom-sheet dialogs, responsive lists/grids, and keyboard-aware forms.
- Improve reading, queue, review, document, analytics, and settings screens so their hierarchy and controls adapt intentionally instead of merely shrinking.
- Add native Tauri desktop polish: compact-window behavior, platform-aware title/drag regions, denser desktop controls, consistent window chrome, and graceful resizing down to a useful minimum width.
- Define accessibility, visual-regression, and device-matrix acceptance checks for responsive and native-window behavior.
- Preserve existing data models and feature behavior; this change introduces no breaking API or storage changes.

## Capabilities

### New Capabilities

- `responsive-app-shell`: Defines adaptive layout, navigation, safe-area, viewport, overlay, and touch-interaction behavior across phone and tablet form factors.
- `tauri-desktop-interface`: Defines native desktop window integration, compact-window responsiveness, desktop information density, and platform-consistent interaction behavior for the Tauri app.

### Modified Capabilities

None.

## Impact

- Frontend shell and navigation: `src/components/layout/MainLayout.tsx`, `src/components/mobile/`, `src/components/Toolbar.tsx`, tab rendering, and shared overlays/dialogs.
- Responsive styling and device detection: `src/styles/mobile.css`, `src/index.css`, `src/hooks/useMobileShell.ts`, `src/hooks/useFormFactor.ts`, and `src/lib/tauri.ts`.
- High-use product surfaces: dashboard, queue, review, documents, readers/viewers, analytics, search/import, and settings components.
- Native configuration and window integration: `src-tauri/tauri.conf.json` and platform-specific Tauri window handling where required.
- Tests: component and hook tests plus responsive visual/E2E coverage for representative phone, tablet, compact desktop, and standard desktop viewports.
- No database migration, backend API change, or new runtime dependency is expected.
