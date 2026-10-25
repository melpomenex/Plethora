## Why

The desktop Assistant's AI provider picker now extends above the app window, hiding its title and initial provider choices. This regression makes the top-right provider control difficult to use and needs a focused positioning fix with browser coverage of the actual toolbar layout.

## What Changes

- Restore explicit anchoring of the desktop provider menu beneath its model control, independent of toolbar flex alignment and wrapping.
- Keep the menu surface inside the visible app area, with a bounded provider list that scrolls to every choice when space is limited.
- Ensure revealing the active provider scrolls only the provider list rather than shifting the Assistant or reader.
- Add browser regression coverage using the production desktop wrapper, including narrow panels, short windows, interface zoom, and both panel sides.
- Preserve the mobile in-sheet picker, provider selection, settings navigation, dismissal, and focus restoration.

## Capabilities

### New Capabilities

- `desktop-assistant-model-picker`: Explicit desktop menu anchoring, containment, independent scrolling, and context-preserving operation. Existing canonical specs cover mobile composer behavior but do not define desktop provider-menu geometry.

### Modified Capabilities

None.

## Impact

- Primary implementation: `src/components/assistant/AssistantPanel.tsx` desktop model-control wrapper and menu.
- Shared behavior to inspect: `src/components/assistant/AssistantModelPicker.tsx` active-row reveal and provider-list bounds.
- Regression coverage: `src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx`, `src/visual/assistant-model-picker.visual.spec.ts`, and `src/visual/assistantModelPickerHarness.tsx`.
- No provider configuration/schema changes or new dependencies are expected. Existing mobile picker requirements remain applicable.
