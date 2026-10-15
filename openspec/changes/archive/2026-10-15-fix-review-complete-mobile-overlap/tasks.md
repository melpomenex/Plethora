## 1. Completion Viewport Layout

- [x] 1.1 Make the ReviewSession completion branch scroll vertically within the mobile content viewport and verify the final return-to-review action can be reached on a short phone screen.
- [x] 1.2 Apply the same constrained scroll layout to the review route completion branch and verify its final action stays reachable above fixed navigation.
- [x] 1.3 Preserve the current centered layout when completion content fits and verify desktop completion behavior remains intact.

## 2. Regression Coverage

- [x] 2.1 Add viewport regression coverage for both completion entry points with fixed mobile navigation, including the trailing Review Home action, and verify the final action is fully visible at the scroll end.
- [x] 2.2 Verify bottom safe-area spacing on a phone-sized viewport and run the targeted review completion checks.
