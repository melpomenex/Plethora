## 1. Mobile header layout

- [x] 1.1 Refactor mobile upper controls into one safe-area-aware stack containing session/actions and reader-mode rows; keep the current priority label visible, give controls 44px touch targets, and adapt the Details trigger accessibly. Verify the real overlay renders all applicable actions at 320px and ordinary phone widths without overlap or clipping, including long labels and neural review.
- [x] 1.2 Enclose every upper row in the measured header region and retain desktop layout. Verify rating-dock bounds clear the mode row and wrapped content at all four dock positions; retain existing desktop action routing tests.

## 2. Adaptive priority editor

- [x] 2.1 Share the local priority editor body/state between a mobile `ResponsiveDialogSheet` and the existing desktop anchored popover. Verify mobile opens a titled modal sheet, desktop remains anchored, and both show the same presets/current value without duplicate interactive editors.
- [x] 2.2 Apply theme surface roles, readable preset selection markers, responsive preset reflow, 44px targets, and a labeled fine-tune slider with percentage. Verify enlarged/translated labels remain readable, all controls remain reachable in short landscape, and light/dark/e-ink states retain non-color selection cues.
- [x] 2.3 Integrate close/backdrop/Escape/system Back, focus containment/return, and background blocking through existing dialog infrastructure. Verify dismissal preserves reading position/overlay visibility and cannot trigger a mode, rating, Assistant, or navigation action underneath.

## 3. Persistence and item lifecycle

- [x] 3.1 Pass/reset by current queue-item identity and close the editor when the item changes, priority disappears, overlay hides, or reader unmounts. Verify with document-to-extract and same-parent extract transitions, including deferred save resolution; stale completions must not affect the new item.
- [x] 3.2 Preserve preset save-and-close and slider completion saves, prevent conflicting/duplicate commits, and localize/announce pending and error states. Verify preset success/failure, retry, touch/pointer slider completion, keyboard operation, and blur behavior with focused component tests.

## 4. Integrated validation

- [x] 4.1 Add or extend a real-component visual harness with priority enabled, Details, reader modes, shell navigation, Assistant launcher, and rating controls. Add browser assertions for bounding-box separation, safe-area containment, and `elementFromPoint`/actual-click reachability of the priority trigger before opening its editor; verify at 320, 360, 390, and 430px portrait widths, one short landscape size, and a desktop control case. Include nonzero safe-area insets, enlarged/long text, supported document/extract states, and unsupported item types.
- [x] 4.2 Exercise sheet dismissal and slider gestures plus existing stationary-tap, scroll, selection, long-press, and volume-key overlay behavior. Record the tested browser engines/input methods and physical-device coverage or gaps in a validation note; viewport screenshots alone do not establish gesture correctness.
- [x] 4.3 Run focused overlay/queue/dock tests and the new visual suite, TypeScript checking, lint on changed application files, `npm run bench:check`, and strict OpenSpec validation. Record results and any reproduced pre-existing failures; keep all performance/bundle budgets passing or document and justify an intentional baseline change according to repository policy.
