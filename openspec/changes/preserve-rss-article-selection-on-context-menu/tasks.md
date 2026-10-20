## 1. Reproduce selection loss

- [x] 1.1 Add `src/visual/rss-selection.visual.spec.ts` using the existing RSS harness and deterministic article text. Exercise real mouse selection followed immediately by right-click in the actual inline reader, full-content view, and Story view; verify the regression detects a collapsed or changed selection after menu opening and retain a screenshot of the failing stage.
- [x] 1.2 Trace selection contents and article node connectivity through secondary-button press, menu mounting, submenu interaction, and an unchanged-content rerender. Record the observed collapse boundary in `design.md` so the repair is supported by a reproducible trace.

## 2. Preserve the article selection

- [x] 2.1 Extend `useRssSelectionMenu` with article-scoped range capture as needed, validating both selection endpoints and retaining captured text/passage for actions. Apply any required trigger bindings to all three consumers; verify forward, backward, and multi-node selections with focused hook tests.
- [x] 2.2 Repair the event or rendering boundary demonstrated by task 1.2, keeping article text nodes stable across menu-only updates and guarding range restoration against detached or replaced content. If menu pointer preservation is needed, make it opt-in and propagate it to submenus; verify the browser regression retains the selection through menu opening, hovering, submenu presses, and action dispatch.
- [x] 2.3 Implement Escape retention and invalidate menu/range state on article changes, content replacement, and unmount without restoring over outside clicks or new selections. Verify Escape/reopen, replacement selection, article switch, and content replacement cases in hook or browser tests.

## 3. Verify action and input compatibility

- [x] 3.1 Extend `rssSelectionMenu.test.tsx` to assert that Copy, Highlight/extract, and a delayed dialog action receive the captured passage even after live selection changes following activation. Verify successful extraction retains its existing cleanup and no-selection/outside-article right-clicks never reuse stale text; run `npx vitest run src/components/media/__tests__/rssSelectionMenu.test.tsx`.
- [x] 3.2 Complete the browser matrix for immediate right-click, formatted multi-paragraph selection in both directions, submenu use, unchanged-content updates, Escape/reopen, outside click, and article/content replacement. Assert native selection text and non-collapsed ranges at the relevant stages, inspect open-menu screenshots, and run `npx playwright test src/visual/rss-selection.visual.spec.ts --workers=1`.
- [x] 3.3 Verify shared menu arrow-key navigation, focus return, dismissal, native link/image menus without selection, and editable-field behavior using existing shared menu tests plus focused cases for any opt-in preservation path. Smoke-test the sequence in the affected desktop Tauri webview and touch selection on a mobile viewport; record platform and results in `design.md`.
- [x] 3.4 Run the focused RSS and shared context-menu suites, `npx tsc --noEmit`, and the repository's required `npm run bench:check` gate. Record outcomes and investigate regressions; update a performance baseline only for an intentional measured performance change with its reason.
