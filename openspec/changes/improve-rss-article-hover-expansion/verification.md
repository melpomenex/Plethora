# Verification — improve-rss-article-hover-expansion

Verified on 2026-10-20 against the working tree based on `e5e52634` plus the
concurrent worktree edits. No Rust, Tauri/Cargo, installer, sidecar prebuild,
dependency, or backend/schema command was run.

## Commands

| Check | Result |
| --- | --- |
| `npx vitest run src/components/media/__tests__/rssListArticleCard.test.tsx src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx src/components/media/__tests__/rssCustomizationPanel.test.tsx src/types/__tests__/rssCustomization.test.ts src/components/media/__tests__/rssSelectionMenu.test.tsx` | 64 passed (5 files) |
| `npx playwright test src/visual/rss-list-disclosure.visual.spec.ts src/visual/rss-customization.visual.spec.ts` | 33 passed (27 new List-disclosure tests + 6 existing customization tests) |
| `npx tsc --noEmit` | passed |
| `npx eslint src/components/media/RSSReader.tsx src/components/media/RSSListArticleCard.tsx src/components/media/KeyboardShortcutProvider.tsx src/lib/i18n/locales/en.ts src/components/media/__tests__/rssListArticleCard.test.tsx src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx src/visual/rssCustomizationHarness.tsx src/visual/rss-list-disclosure.visual.spec.ts` | 0 errors; one pre-existing unused-parameter warning at `RSSReader.tsx:415` |
| `npm run bench:check` | passed on the second run (perf budgets + bundle budgets). The first run was contaminated by concurrent machine load: `postpone/plan-1000-items` measured 2.66× while a standalone rerun measured its normal cost. Stale-baseline warnings are pre-existing. |
| `npx vite build` + `node scripts/check-bundle-budget.mjs` | passed: entry 5 KB, 1 PDF worker, total 26.2 MB |
| `openspec validate improve-rss-article-hover-expansion --strict` | valid |

## Evidence

`.playwright/results/` contains the full browser artifacts from the suite.
Durable copies for this change live in `evidence/`:

- `rss-list-420-collapsed.png`, `rss-list-420-expanded.png`
- `rss-list-420-aurora-light.png`, `rss-list-420-modern-dark.png`,
  `rss-list-420-legal-pad.png`
- `rss-list-320-touch-expanded.png`
- `rss-list-real-420-expanded.png` (real `RSSReader`, 1,000 articles)
- `rss-list-420-200pct-zoom.png` + `rss-list-zoom-metrics.json`
  (720px CSS viewport = 200% of a 1440px physical window; 420px card,
  7 controls, no horizontal overflow)
- `rss-list-production-trace.json` — production-bundle 1,000-article trace:
  15 mounted cards initially, 25 at item 900, disclosure expanded/collapsed,
  no long tasks and no disclosure task over 50 ms.

The Vite dev server used by Playwright runs React development mode and recorded
two 60–75 ms long tasks around expand/collapse in the same stress lane. The
production bundle trace above is the performance acceptance trace; the dev
suite keeps only a pathological-work smoke bound so it is not a machine-speed
gate.

## Known limitations / deviations

- `RSSReader.tsx` gained one small sync effect that keeps `selectedFeed` current
  when article read/favorite state changes in `feeds`. Without it, the items memo
  recomputed a selected-feed row from a stale feed object and the star/read
  state reverted. This is outside the List card itself but is required for
  AC07 in a selected-feed scope.
- The details toggle clears pointer focus suppression when the pointer goes down
  on the toggle itself. The toggle is an explicit disclosure command; clearing
  keyboard intent first made a touch/keyboard-expanded card look collapsed and
  immediately reopen on the same tap.
- Training retains its pre-existing contract: the menu acts on the currently
  selected article, not the row whose button was clicked. The visual suite
  verifies that documented limitation rather than retargeting training.
- The full `dist` build for the bundle gate includes unrelated concurrent
  worktree changes; budget results reflect the whole working tree.
