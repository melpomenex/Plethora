## 1. Scroll ownership and creation flow

- [x] 1.1 Inventory every Study Plans view and overlay from the mobile tab and route entry points, identify the scroll owner for each long surface, and verify the inventory covers list/home, create/generation, editor sections, lessons, assessments, attempts, results/history, evidence/remediation, research, and grading.
- [x] 1.2 Give the create and curriculum-generation flow a continuous mobile scroll path through all options and final actions; verify a long form remains scrollable with the keyboard open and the submit action can be brought into view.
- [x] 1.3 Give long assessment history and result views a bounded mobile scroll path; verify long fixtures reach the last item and every final action above the fixed shell controls.

## 2. Responsive Study Plans views

- [x] 2.1 Adapt the plan list, plan home, curriculum editor header and section navigation, outline, node details, source scope, version history/diff, and evidence sections for phone and tablet widths; verify every editor section is reachable and no page-level horizontal overflow appears at the narrow phone width.
- [x] 2.2 Adapt curriculum generation, source selection, web research, lesson/tutor, practice, gap, and remediation panels for mobile reading and touch; verify long labels, empty/error states, and primary actions remain visible and operable.
- [x] 2.3 Adapt assessment builder, blueprint/history panels, previews, question editors, attempt runner, results, and grading controls for phone and tablet widths; verify long prompts and response controls remain readable and all task actions are reachable.

## 3. Overlays and shell interactions

- [x] 3.1 Fit Study Plans dialogs and sheets to the available visual viewport, including generation, question editing, publishing, and grading review; verify long overlay content scrolls internally and its close and completion actions remain reachable with safe-area insets and the keyboard present.
- [x] 3.2 Check Study Plans content and floating actions against the mobile navigation, Assistant, and audio dock geometry; verify no field, section control, or primary action is obscured in portrait, landscape, or after viewport resizing.

## 4. Responsive regression coverage

- [x] 4.1 Add focused automated coverage for create-to-editor, editor sections, lesson/assessment transitions, and history-to-results/runner flows using long content at phone and tablet dimensions; verify scrolling, focus visibility, primary-action reachability, and absence of page-level horizontal overflow.
- [ ] 4.2 Perform a native mobile smoke pass on representative Android and iOS or supported mobile shells, including phone portrait/landscape and keyboard-open create/edit flows; record that all acceptance scenarios in `specs/responsive-app-shell/spec.md` pass.
