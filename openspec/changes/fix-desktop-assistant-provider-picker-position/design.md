## Context

See `proposal.md` for the reported regression and scope.

Verified source evidence:

- `src/components/assistant/AssistantPanel.tsx:3624` places the model control and mode buttons in a `relative flex ... items-center` wrapper. Commit `152c791a` changed this desktop wrapper from a non-flex block to the current flex row.
- `AssistantPanel.tsx:3743` mounts the absolute menu in that row with a horizontal inset and margin, but no vertical inset. Its static vertical position therefore depends on flex alignment. The panel at line 3575 has `overflow-hidden`, which clips any upward overflow.
- An isolated Chromium probe using the same flex/absolute relationship placed a 400px menu at y=-111 with its anchor spanning y=65..105. Setting `top: 100%` moved the menu to y=113..513. This confirms the CSS failure mechanism; reproducing it in the full production panel remains the first implementation check.
- `AssistantModelPicker.tsx:97` reveals the active row with `scrollIntoView`, which can scroll ancestors beyond the provider list. Treat that as a separate containment risk, not a confirmed cause of this report.
- `src/visual/assistantModelPickerHarness.tsx:146` uses an explicit `top-9` desktop wrapper rather than the production flex wrapper. Its containment test cannot catch this regression. The desktop unit test verifies variant and class names without browser layout.
- The completed but unarchived `fix-mobile-assistant-model-menu` change explicitly preserves an anchored desktop menu. Canonical `mobile-assistant-composer` requirements cover mobile behavior; this change adds the missing desktop geometry contract.

## Goals / Non-Goals

**Goals:** Make desktop placement explicit, bound menu geometry to visible space, and exercise the real positioning boundary in a browser. Keep the existing provider rows and mobile sheet behavior reusable.

**Non-Goals:** Redesigning the toolbar, adding a new menu library, changing provider readiness/routing, changing Settings controls, or rewriting overlay infrastructure.

## Decisions

### 1. Give the desktop model trigger its own explicit anchor

Separate the model trigger and its menu from the neighboring Chat/Agent controls with a dedicated positioned wrapper. Place the menu below that wrapper using an explicit vertical inset (`top: 100%` plus the existing gap). Preserve the panel-side horizontal alignment. The mode controls can wrap without becoming the menu's anchor.

This directly removes the verified static-position dependency. Changing animation, z-index, or applying a negative margin would leave the geometry dependent on content height. A portal is unnecessary for the primary fix and would introduce coordinate and dismissal complexity.

### 2. Size the menu against the visible panel area

Keep the existing in-panel menu and backdrop. Cap its width to the panel's visible width with an edge gutter. Bound the entire surface to the space below its trigger within the intersection of the panel and app viewport, accounting for menu padding and its fixed heading. Give only the provider list the remaining scrollable height.

Use a small measurement local to the desktop wrapper while open: measure the anchor and panel bounds, derive available space, and refresh on panel/toolbar resize and viewport resize. If the toolbar's size changes through wrapping, recompute the available height. Account for any CSS scale when converting measured bounds to local sizing units; do not mix physical screenshot pixels with layout coordinates. Reuse existing sizing utilities if an appropriate one exists before adding a helper. Dispose observers/listeners on close.

This handles short windows and wrapped toolbars, where a viewport-only `55vh` cap does not describe the available panel space. Keep the menu's heading and management action outside the scrolling provider list. Do not expand the panel or replace its conversation body.

### 3. Reveal the selected provider within the list

Adjust the provider list's own scroll offset to reveal the active row when needed, instead of relying on unrestricted ancestor-scrolling `scrollIntoView`. Leave the row in place when fully visible. Retain shared behavior for both variants and return focus with scroll prevention on dismissal if browser tests show focus restoration moves ancestors.

Provider selection callbacks, settings navigation, Escape/backdrop dismissal, and mobile Back priority keep their existing semantics.

### 4. Test the positioning boundary used by production

Extend the existing browser harness to mount the real desktop panel with deterministic stores and mocked external boundaries, or extract the small production anchor wrapper and share it with the harness. Do not maintain an independent approximation with hardcoded coordinates. Prefer mounting the real panel; only extract a wrapper if needed to make production geometry directly testable.

Assert menu bounds relative to both panel and viewport, heading and management-action visibility, placement below the trigger, and actual scroll reachability of first/last/active providers. Check that panel, reader, and document scroll offsets remain unchanged on opening, list scrolling, and dismissal. A visible DOM node alone does not establish that it is unclipped.

Cover both panel sides, narrow and ordinary panel widths, short and tall windows, wrapped toolbar controls, selected providers near the beginning and end, and supported desktop interface zoom settings. Rerun the existing mobile containment cases because the row-reveal behavior is shared.

## Risks / Trade-offs

- [Full application evidence is still needed] → The isolated probe proves the CSS mechanism, but a production-wrapper browser test must fail before changing code and pass afterward.
- [Explicit anchoring exposes lower-edge clipping in short panels] → Size the whole menu against actual remaining panel space, and assert first/last provider reachability.
- [Harness drifts from production] → Mount production geometry rather than duplicating its class names and coordinates.
- [Shared reveal/focus changes affect mobile] → Keep the mobile presentation in-flow and rerun mobile selection, containment, dismissal, and focus tests.
- [Measurement listeners add lifecycle work] → Install them only while the desktop picker is open and verify cleanup; no polling loop or global observer is needed.

## Migration Plan

No data migration or configuration changes are required. Ship as a frontend bug fix after focused unit/browser checks, TypeScript checking, and the repository performance/bundle gate. Rollback consists of reverting the implementation and its tests; saved providers and conversations are unaffected.
