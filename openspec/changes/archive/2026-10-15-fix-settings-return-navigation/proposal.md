## Why

Opening Settings replaces the user's active workspace context, but Settings offers no clear, consistent way to return to that context. The existing mobile section arrow only returns to the Settings menu, while the app's tab-history and edge-swipe navigation are not surfaced as part of the Settings experience.

## What Changes

- Add a persistent, accessible return control to every Settings section that takes the user back to the app location from which Settings was opened.
- Give the return control a meaningful label that identifies the destination when it is known and a safe fallback when no prior location is available.
- Define a layered mobile back hierarchy that distinguishes returning from a Settings section to the Settings menu from leaving Settings for the prior app location.
- Make edge-swipe-back and native/system back follow the same Settings hierarchy, while preserving vertical scrolling and controls that own horizontal gestures.
- Preserve unsaved-change protection across button, gesture, and system-back exits.
- Add focused tests for entry-context capture, fallback behavior, mobile hierarchy, gestures, and unsaved changes.

## Capabilities

### New Capabilities

- `settings-return-navigation`: Defines visible and gestural navigation from any Settings view back through the Settings hierarchy and to the user's prior app location.

### Modified Capabilities

None.

## Impact

- Settings shell and section header behavior in `src/components/settings/SettingsPage.tsx`.
- Workspace tab-history integration in `src/stores/tabsStore.ts` and Settings entry points that activate the Settings tab.
- Mobile edge-swipe and native/system-back coordination in the mobile layout and gesture hooks.
- Settings navigation translations, accessibility labels, and component/store tests.
- No backend API, persistence schema, or third-party dependency changes are expected.
