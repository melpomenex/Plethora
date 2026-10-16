## Why

On phones, the New Queue flow is unusable at its bottom edge: the Customize Session dialog (`SessionCustomizeModal`) renders at `fixed inset-0 z-50` while the mobile bottom navigation is `position: fixed; z-index: 1000`, so the navigation paints over both the scrim and the dialog's sticky footer. The last tag rows and the Reset / Save as New Queue / Update Queue / Cancel / Apply Customization actions are covered, the covered parts cannot be tapped, and the navigation keeps accepting taps while the dialog is open. Device screenshots from physical-phone testing show the dialog footer half-swallowed by the nav.

## What Changes

- Render the Customize Session / New Queue dialog through the app's shared adaptive dialog layer: portaled to `document.body`, scrim and panel above the mobile bottom navigation, consuming the documented overlay/z-index tokens instead of the ad-hoc `z-50`.
- On compact presentations (phone, portrait tablet) present it as a bottom sheet bounded by the dynamic viewport height (`--app-viewport-height`) with safe-area padding; on desktop keep a centered dialog with the same control set and order.
- Make the action area touch-reachable: a full-width primary Apply Customization action, secondary actions (Reset to Defaults, Save as New Queue, Update Queue, Cancel) reachable above it, minimum touch-target height, nothing under the navigation bar or home indicator, and wrapping instead of a single clipped row.
- Keep "Save as New Queue" name entry inside the reachable sheet area so the input, Save, and Cancel stay visible above the safe area while the soft keyboard is open.
- While open, the scrim SHALL block the bottom navigation (no tab switching by tapping through the overlay); focus trapping, Escape dismissal, and focus restoration are preserved.
- Apply the same presentation to the Manage Queues dialog reached from the same New Queue dropdown, so the whole journey has one layering contract.
- Add a regression guard: a source-level contract plus a phone-viewport geometry/hit test (390×844 with a bottom-toolbar fixture) that fails if the dialog or its actions land beneath the toolbar again.

## Capabilities

### New Capabilities

None. This modifies existing queue and shell contracts rather than introducing a new capability.

### Modified Capabilities

- `saved-queues`: The New Queue / Customize Session and Manage Queues dialogs SHALL cover the mobile bottom navigation, block its input while open, and keep their configuration controls and actions reachable on compact screens.
- `material-adaptive-shell`: Modal overlays SHALL layer above the mobile bottom navigation and use the shared dialog layer; compact presentations SHALL use the sheet form of the shared dialog primitives.

## Impact

- Frontend: `src/components/review/SessionCustomizeModal.tsx` (dialog layer, compact sheet presentation, footer/action layout), `src/components/queue/ManageSavedQueuesModal.tsx` (same journey), `src/components/mobile/MobileQueueView.tsx` (entry wiring/labels only if needed), `src/components/adaptive/ResponsiveDialogSheet.tsx` (only if the shared sheet needs a slot for a sticky secondary row), `src/styles/mobile.css` or `src/index.css` only if a missing sheet token/layer rule must be added.
- Tests: `src/components/review/__tests__/SessionCustomizeModal.test.tsx`, `src/components/review/__tests__/ReviewQueueView.test.tsx` (its `.closest(".fixed")` helper no longer matches once the dialog is portaled to the shared layer), a new contract test, and a new Playwright visual/hit-test under `src/visual/` using the existing harness pattern.
- No backend, API, schema, i18n-key, or dependency changes; no new runtime dependency and no expected change to benchmark or bundle baselines.
- Verification: focused unit tests, phone + desktop Playwright checks (dialog covers toolbar, actions clickable at their own center points, Escape restores focus), `npm run build`, and the local benchmark gate if any shared component's render path changes.
