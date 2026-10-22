## Why

In mobile Queue Scroll Mode, the floating document/extract/card toolbar can cover the Reading Priority trigger because the two bars are positioned independently. Readers need a discoverable, reliable way to change priority without fighting overlapping controls or a small desktop-style dropdown.

## What Changes

- Arrange mobile queue header actions and the reader mode toolbar in one safe-area-aware layout with distinct, non-overlapping rows.
- Keep Reading Priority directly available whenever the queue overlay is visible and the current item supports priority. Show the current named level alongside its flag; use a full touch target and an accessible name that identifies Reading Priority.
- Open a themed mobile bottom sheet containing the existing five priority presets and fine-tune slider. Keep desktop editing anchored to its trigger.
- Preserve immediate persistence, successful preset selection closing the editor, slider fine-tuning, save failure feedback, and existing queue-overlay activation gestures.
- Add rendered mobile coverage that checks actual hit targets, safe areas, narrow/short layouts, and sheet dismissal alongside existing rating and Assistant controls.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-reading-experience`: Require unobscured mobile queue controls and a touch-friendly, accessible Reading Priority editing flow.

## Impact

- Primary implementation: `src/components/queue/ScrollOverlayControls.tsx`, including its local `ScrollPriorityControl`.
- Integration: `src/pages/QueueScrollPage.tsx` for the Details trigger, localized labels, and current-item identity/lifecycle; `src/components/queue/useRatingDockBounds.ts` must measure the complete upper control region.
- Reuse the existing `ResponsiveDialogSheet`, presentation context, dialog tokens, and dismissal/focus infrastructure. Shared primitive changes are only needed if a verified gap prevents this flow.
- Tests: queue overlay component/integration tests and a visual harness exercising priority, Details, mode switching, rating docks, and mobile shell controls together.
- Frontend-only; no database, scheduling, API contract, new dependency, or user preference changes. No new Settings search targets are introduced.
