## Why

The Knowledge Universe (3D WebGL galaxy view) is currently a desktop-only feature. It is missing from the mobile navigation interface, and the WebGL container lacks viewport scaling, proper touch gestures (pinch-to-zoom and panning), and layout centering for mobile or tablet screens. This proposal adds the Knowledge Universe to the mobile app layout with appropriate gestures and resolves layout/centering issues on tablets.

## What Changes

- Add the "Knowledge Universe" tab to the mobile navigation menu (inside the "More" navigation sheet).
- Implement responsive viewport offsets for the WebGL camera to prevent the universe center from being hidden/off-centered when detail panels or sidebars are open.
- Add full multi-touch gesture support: pinch-to-zoom (adjusting camera distance) and two-finger panning (translating the camera target).
- Add single-pointer panning support via right-click or Shift/Ctrl+drag.
- Add `touch-action: none` to the WebGL canvas to prevent default browser gestures (like scrolling/pull-to-refresh) from interfering with 3D navigation.
- Update global CSS to correctly apply safe area paddings to the application root on native mobile builds in both mobile and desktop presentation modes, preventing drawing under system bars.

## Capabilities

### New Capabilities
- `knowledge-universe-mobile`: Adds the 3D Knowledge Universe to mobile views with touch zoom/pan gestures, screen-space centering offsets, and mobile navigation integration.

### Modified Capabilities
<!-- No requirement changes to existing specs. -->

## Impact

- `src/components/mobile/MobileNavigation.tsx`: Add Knowledge Universe to mobile navigation list.
- `src/components/graph/universe/engine.ts`: Implement multi-touch pinch-to-zoom, right-click/multi-touch panning, and screen-space viewport centering offsets.
- `src/components/graph/KnowledgeUniverse.tsx`: Add touch-action styles, propagate selected node changes to the engine offset, and align selection synchronization.
- `src/index.css`: Apply safe area paddings to the application root on native mobile platforms for all presentation modes (including desktop mode on landscape tablets).
