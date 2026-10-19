## Why

In commit `e1076add`, an `<AssistantScopeSelector>` component was mistakenly inserted as a direct flex child of the root `.document-qa-workspace` container in `src/components/tabs/DocumentQATab.tsx`. Because the workspace container is a horizontal flex layout, this rendered as an isolated column on the middle-left of the screen directly adjacent to the application's icon toolbar. This creates an awkward visual bulge making the sidebar appear wider than it should, while erroneously separating scope selection from the composer and the existing source picker controls.

## What Changes

- Remove the misplaced `<AssistantScopeSelector>` and detached "Switch to Chat" button from the root of `DocumentQATab.tsx`.
- Eliminate the unwanted middle-left column so the Document Q&A workspace layout sits flush and clean against the navigation rail and history sidebar.
- Maintain proper scope synchronization via `DocumentQaSourcePicker` (setting scope to `"document"` when a specific document is chosen, and `"library"` when whole library is selected).
- Relocate or cleanly display the `suggestSwitchToChat` action adjacent to the composer if an evidence-gap suggestion occurs.
- Update `DocumentQATab.test.tsx` to align test assertions with the corrected layout.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `document-qa-workspace`: Clarify that the Document Q&A workspace does not display a standalone scope selector column in the rail/sidebar region, and that conversation scope is controlled through the composer-adjacent source picker.

## Impact

- `src/components/tabs/DocumentQATab.tsx`: Layout fix removing the misplaced element.
- `src/components/tabs/__tests__/DocumentQATab.test.tsx`: Test updates removing clicks on the misplaced scope picker.
- UI visual appearance: Removes the unwanted protrusion on the middle-left of the Document Q&A view.
