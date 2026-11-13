## Context

The mobile app constrains its main content to the height above the bottom navigation and audio dock, then clips overflow at the main content and tab-content boundaries. The main Study Plans tab renders `StudyPlansTab` directly in that clipped area. Its create branch returns `StudyPlanCreateForm`, whose root is a form without its own scroll behavior; the route wrapper in `src/routes/study-plans.tsx` does not wrap this in-app tab path. Other views use a mix of explicit internal scrollers and unbounded content. See `proposal.md` for the user problem and `specs/responsive-app-shell/spec.md` for the behavior contract.

Study Plans spans a list/home, create and generation flow, curriculum editing and preview, source and research panels, evidence and remediation, lessons and tutoring, assessment authoring and execution, results/history, and grading overlays. These are hosted inside one tab destination, so scroll behavior must be reviewed per view transition, not only on the route entry point.

## Current Surface Inventory

The mobile tab registry mounts `StudyPlansTab` directly inside the clipped tab host. The separate route wrapper scrolls, but it does not protect the in-app tab path shown in the supplied screenshot.

| Surface | Current containment | Mobile review focus |
| --- | --- | --- |
| Plan list | `StudyPlanList` owns a full-height vertical scroller. | Retain its scroll ownership; reduce phone padding and check toolbar/card wrapping and the assistant pill near the bottom. |
| Plan Home | `PlanHomeTab` has no full-height scroller. | Add the screen scroll owner; check long titles, blocker lists, and bottom actions. |
| Create and source selection | `StudyPlanCreateForm` has no scroll owner in the tab path; the picker has its own bounded document list. | Make the whole form reachable, preserve the focused field during keyboard resize, and leave end clearance for shell controls. |
| Curriculum editor | `StudyPlanEditor` owns a vertical scroller; its six labeled section buttons share a non-scrolling flex row. | Keep one vertical owner, make every section reachable horizontally at phone width, and check wrapped header actions and detail panels. |
| Generation and recovery | `CurriculumGenerator` has a fixed overlay and a `90vh` scrolling panel; recovery/preview content is inside the editor. | Bound the overlay to the visual viewport and safe areas, and verify its primary actions while the keyboard is open. |
| Lessons and tutoring | `LessonView` opens in a fixed editor modal capped at `90vh`; tutor content is hosted from that lesson. | Use the visual viewport bound and confirm the lesson and tutor controls fit and scroll. |
| Assessment builder | `AssessmentBuilder` owns a vertical scroller; question editing opens a `90vh` dialog with an internal body scroller. | Retain one screen owner, keep long prompts and quota controls legible, and fit question editing to short viewports. |
| Attempt runner | `AttemptRunner` owns a vertical scroller; submit confirmation is a fixed overlay. | Keep title/status/submit controls and question navigation reachable in portrait, landscape, and with large text. |
| Results and history | `AttemptResults` uses `min-h-screen` without a local scroller; `AttemptHistoryView` has no scroll owner. | Add one bounded screen scroller for each view and reach the last question/attempt and its actions. |
| Evidence, research, remediation, grading | Evidence/research and remediation panels render within editor/assessment surfaces; grading review uses a `90vh` dialog with a body scroller. | Verify each panel inherits the intended screen scroller, and bound grading overlays to the keyboard-aware viewport. |
| Dashboard entry card | `StudyPlansDashboardCard` is hosted by Dashboard's shared safe scroller. | Check narrow card wrapping and that entry actions remain touch-accessible. |

## Goals / Non-Goals

**Goals:**

- Give each long mobile view one deliberate scroll owner that fits the shell's measured content area and reaches the final action.
- Keep existing Study Plans information and workflow semantics while reflowing dense controls and content for touch widths.
- Preserve usable focused fields, dialogs, and primary actions when the mobile keyboard or shell overlays are present.
- Make the mobile audit repeatable across the in-app tab entry and the route entry where that route is supported.

**Non-Goals:**

- Changing curriculum generation, source authority, assessment behavior, persistence, or study-plan data contracts.
- Redesigning the shared mobile navigation, Assistant, or audio player beyond accommodating their existing reserved or overlay geometry.
- Reworking desktop layouts except where a shared responsive component must retain its existing desktop behavior.

## Decisions

### Keep scrolling inside each long Study Plans view

Use the existing shell's available content height and make each Study Plans view that can exceed it scroll within its own view boundary. Keep flex children shrinkable (`min-height: 0` where needed), and avoid adding multiple nested vertical scrollers to one workflow. The create form must scroll as a complete unit from its header through its final actions. Apply the same ownership check to results and history, as well as any other view found during the audit without an existing scroll path.

**Alternative considered:** make `.mobile-main-content` scroll globally. This would weaken the shell's current separation between its fixed navigation/docks and full-height readers or other tabs, and would still leave nested hidden-overflow tab hosts as a source of clipping. Per-view scrolling follows the app's current containment model.

### Reflow dense controls without shrinking touch targets

Keep the existing content order and actions. At phone widths, stack multi-column cards and action rows, let long labels wrap, and give the curriculum section navigation a bounded way to reach every section without creating page-level horizontal overflow. Keep a single-column path for the create choices, source scope, assessment controls, and other form-heavy surfaces. Retain the desktop multi-column layouts at their current breakpoints.

**Alternative considered:** compress the existing desktop rows with smaller type and controls. That would reduce legibility and touch accuracy while leaving the content hierarchy unchanged.

### Fit overlays to the visual viewport and shared shell geometry

Audit Study Plans dialogs, generation flows, question editors, grading review, and floating actions against the current safe-area, keyboard, Assistant, and audio-control geometry. Long overlay content must scroll within the overlay, while its close/return path and task completion action remain reachable. Reuse the shell's existing geometry signals where available; do not add a second safe-area or bottom-navigation offset at the Study Plans layer.

**Alternative considered:** pin a new global bottom action bar over each screen. This competes with the mobile navigation, Assistant, audio controls, and keyboard, and can obscure content on short screens.

### Validate behavior as a flow, not just as isolated components

Exercise the list-to-create-to-generation/editor path, plan section navigation, lesson and assessment transitions, and history-to-results/runner paths at phone and tablet dimensions. Use a long form and long result/history fixtures so a short default state cannot hide a broken scroll path. Include portrait and landscape phone sizes, software-keyboard behavior, and viewport changes where the test environment supports them, followed by a native mobile smoke pass.

**Alternative considered:** rely only on component snapshots or desktop tests. They do not expose clipping caused by the mobile tab host, fixed shell controls, or visual-viewport changes.

## Risks / Trade-offs

- **Nested scroll regions can capture touch gestures unexpectedly** → Assign one vertical scroll owner per view where possible and validate continuous scrolling from the top to the final action.
- **Keyboard and safe-area behavior differs between Android, iOS, and browser/PWA shells** → Validate the same critical creation and editing paths on supported shells and ensure the available viewport is measured by the shared shell.
- **A compact editor navigation may hide section choices** → Keep all sections discoverable, preserve clear selected state, and test the narrowest supported phone width.
- **Responsive wrappers can affect desktop height behavior** → Keep desktop branches at their current breakpoints and verify representative wide layouts after shared-component changes.

## Migration Plan

No persisted data or native commands change. Ship the UI and regression coverage together. Rollback consists of reverting the responsive UI changes; no data migration or compatibility step is required.
