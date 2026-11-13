## Why

On a phone, the Study Plan creation form extends beyond its visible area but has no scroll container in the tab view, so users cannot reach the remaining options and submit action. Other Study Plans views share the mobile shell but have uneven scrolling and dense controls; a complete mobile pass is needed to make every core plan workflow usable in the available viewport.

## What Changes

- Make the create form and its generation flow fully reachable on mobile, including the final actions while the software keyboard, bottom navigation, assistant, or audio controls are present.
- Audit and adapt the Study Plans list, plan home, curriculum editor, sources and research, evidence and gaps, lessons and tutoring, assessment builder, question editing, attempt runner, results, history, grading, and remediation surfaces.
- Keep content readable and actions reachable at phone widths, with layouts that stack or disclose secondary detail as needed and avoid clipped content and unintended horizontal scrolling.
- Add responsive regression coverage for representative Study Plans flows, overlays, and viewport changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `responsive-app-shell`: Include the full Study Plans experience in mobile content-loss, scrolling, overlay, keyboard, and responsive validation requirements.

## Impact

- Affected UI: `src/components/study-plans/**`, `src/routes/study-plans.tsx`, and the mobile shell only where its viewport, navigation, or overlay geometry affects Study Plans content.
- Affected tests: Study Plans component and responsive layout coverage.
- No data model, native command, API, or dependency changes are expected.
