## Why

When the rating orbs are docked at the bottom of the mobile reader, their fixed placement overlaps the Assistant bubble and crowds the bottom navigation. Their hard-coded rainbow colors and dark glass dock also clash with the user's chosen theme.

## What Changes

- Place the bottom rating dock above the visible Assistant bubble and navigation, with measured clearance and safe-area awareness.
- Adapt the dock to narrow screens without clipping rating actions or reducing touch targets; keep positioning utilities secondary to ratings.
- Make the rating orbs, dock, placement menu, tooltips, and interaction states adopt the active theme. Preserve recognizable icons, action order, accessible labels, and meaningful distinctions between grades.
- Apply the themed orb treatment consistently to Scroll Mode and the inline queue reader's rating orbs, including mark-as-read and dismiss variants.
- Preserve saved edge placement, drag-to-snap, shortcuts, rating behavior, queue-only visibility, and existing haptics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-rating`: Require collision-free bottom docking, responsive accessible rating controls, and theme-aware orb presentation across queue reading surfaces.

## Impact

- Rating dock layout and styling in `src/components/queue/ScrollOverlayControls.tsx`; inline rating rendering in `src/components/viewer/DocumentViewer.tsx` and its referenced controls.
- Mobile shell/Assistant geometry coordination through `src/components/mobile/MobileLayoutWrapper.tsx`, `src/components/assistant/mobile/MobileAssistantHost.tsx`, and existing viewport metrics.
- Shared rating styles and existing theme roles; only add derived rating color pairs if existing roles cannot provide readable semantic accents.
- Component, geometry, and visual regression coverage for mobile placement and representative themes. No backend, scheduler, settings migration, or new runtime dependency is required.
- Complements `theme-aware-mode-accent`, whose scope explicitly excludes Scroll Mode overlay chrome; avoids changing the in-progress mobile Assistant sheet/composer design.
