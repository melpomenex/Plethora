## 1. Bottom control geometry

- [x] 1.1 Add a shell-owned bottom-geometry bridge with an empty default for desktop/isolated consumers; publish visible navigation and Assistant bubble bounds using existing refs and viewport metrics. Verify show/hide, resize, unmount cleanup, and nonzero viewport offsets with focused geometry/host tests.
- [x] 1.2 Replace the settled bottom dock's fixed offset with the occupied-boundary calculation and safe-area fallback; use it for initial mount, drag release, and directional placement. Verify at least 8px separation, no invisible-control reservation, unchanged saved edge, and no automatic docking haptic in focused overlay tests.
- [x] 1.3 Preserve Assistant sheet interaction priority and restore clearance on dismissal. Verify ratings cannot receive clicks or keyboard focus through the open sheet and become usable again after closing it.

## 2. Responsive rating dock

- [x] 2.1 Constrain horizontal dock width to visible safe bounds and reflow positioning utilities below the ratings when required, keeping targets at least 44px. Verify every applicable action and placement control is reachable at 320px and 390px widths without horizontal viewport overflow.
- [x] 2.2 Bound dock height to the region between upper controls and reserved bottom controls, support internal scrolling, and keep the placement menu visible. Verify short landscape and enlarged-text states with touch, keyboard focus, and all four saved edge positions.

## 3. Theme-aware orb presentation

- [x] 3.1 Introduce shared rating presentation styles using existing surface/foreground roles and semantic accents for Again, Hard, Good, Easy, and Dismiss. Verify resolved foreground/background contrast in light, dark, saturated custom, and monochrome themes; reuse existing color helpers if additional readable pairs are needed.
- [x] 3.2 Apply shared styles to the Scroll Mode dock, orbs, utilities, placement menu, and tooltips, removing fixed rainbow/slate/white color assumptions. Verify live theme switching updates normal, hover, pressed, disabled, and focus-visible states without resetting the queue item or dock preference.
- [x] 3.3 Apply the same orb styles to the inline queue reader, including Good/mark-as-read and dismiss variants, and ensure explicit accessible action names and keyboard-visible labels. Verify existing action sets, queue-origin gating, handler arguments, shortcuts, and haptics remain correct in component tests.

## 4. Integration and validation

- [x] 4.1 Run focused overlay, viewer rating-gating, mobile Assistant host, and any changed theme resolver tests; run TypeScript checking and the repository lint command as applicable. Record exact commands and results, separating any pre-existing failures.
- [x] 4.2 Capture and inspect actual rendered bounds and screenshots for bottom docking on 320px/390px phones, safe-area portrait, short landscape, enlarged text, navigation/bubble shown and hidden, sheet open/closed, and restored settings. Include a desktop four-edge smoke check and confirm the Assistant and every applicable rating remain independently operable.
- [x] 4.3 Inspect theme screenshots for light, dark, custom saturated, and monochrome/e-ink modes, including a live theme switch and menu/focus states; confirm text contrast of at least 4.5:1 and icon/focus contrast of at least 3:1. Run the Impeccable detector on changed UI files and resolve or explain findings.
- [x] 4.4 Run `npm run bench:check` as the repository performance gate and `openspec validate fix-bottom-rating-dock-overlap --strict`; record results. Update performance/bundle baselines only for an intentional measured change with a documented reason. See `validation.md` for the noisy performance gate exception and unchanged-HEAD comparison; baselines were not modified.
