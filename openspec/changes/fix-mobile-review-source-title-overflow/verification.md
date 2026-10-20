# Verification — fix-mobile-review-source-title-overflow

Date: 2026-10-20
Environment: Linux (x86_64), Chromium 1.62.1 via Playwright, Vitest 4.0.18.
No iOS simulator or Android device was attached.

## Implementation reviewed

- `src/components/review/CardSourceContext.tsx`
  - The title area is now the passage-navigation button: book icon, localized
    `From:` label, two-line clamped title, separate page marker, persistent
    navigation icon, and the desktop `View source` / `V` affordance.
  - A separate `Source details` disclosure expands the full wrapping title,
    page marker, stored excerpt, and a sibling external link. It never
    navigates and remains available when source navigation reports unavailable.
  - Containment uses `min-w-0` at each flexible boundary, `overflow-wrap:
    anywhere` for unbroken text, and a container-query padding adjustment for
    very narrow strips. The layout wraps the icon/title group before it can
    collapse the title to zero at 200% text.
  - Targets use 40px minimums, 48px minimums under `(pointer: coarse)`, theme
    tokens, and inset focus rings.
- `src/components/review/ReviewCard.tsx`: added `min-w-0` to the card article
  and padded card body so ancestors no longer impose a content minimum.
- Locales: added `review.sourcePage`, `review.sourceDetails`, and
  `review.sourceDetailsHide` to `en`, `zh`, `es`, `de`, `fr`, `ja`.
- Coverage: extended `CardSourceContext.test.tsx`, added
  `src/visual/cardSourceContextHarness.tsx` with
  `public/card-source-context-harness.html`, and added
  `src/visual/card-source-context.visual.spec.ts`.

## Focused unit/integration tests

Passed:

```text
npx vitest run src/components/review/__tests__/CardSourceContext.test.tsx \
  src/components/review/__tests__/ReviewCard.test.tsx \
  src/components/review/__tests__/ReviewCard.freeResponse.test.tsx \
  src/utils/__tests__/cardSourceReturnContract.test.ts \
  src/utils/__tests__/cardSourceOutcome.test.ts
```

- `CardSourceContext.test.tsx`: 12/12 — default navigation, `onActivate`
  override, loading deduplication, disclosure with/without a snippet, sibling
  external link, inert HTML, unavailable access, disabled/hidden state.
- `ReviewCard.test.tsx`: 9/9; `ReviewCard.freeResponse.test.tsx`: 6/6.
- `cardSourceReturnContract.test.ts`: 4/4 — `reviewReturn` tab payload and
  review-tab retention.
- `cardSourceOutcome.test.ts`: 14/14.
- i18n parity: `src/lib/__tests__/i18n.test.ts` 4/4 after adding the new keys.

One pre-existing failure was reproduced in isolation and is unrelated to this
change (neither the test nor `cardSourceNavigation.ts` is modified here):

```text
src/utils/__tests__/cardSourceNavigation.test.ts
  > resolveCardSource > refuses to highlight when the quote matches multiple places
  expected 'no-anchor' to be 'ambiguous'
```

`ReviewCard`'s source strip is still rendered inside the card question area; the
live review-session return path was not exercised on a native build in this
environment. The evidence above is component/contract coverage with mocked
navigation, not a physical-device reader integration run.

## Browser geometry and interaction

Command (the local dev server is killed periodically by the environment, so a
restarting wrapper and bounded `openHarness` retry were used):

```text
npx playwright test src/visual/card-source-context.visual.spec.ts
19 passed
```

Coverage: 320/360/390/430px phones, phone landscape, 768px tablet, 1440px
desktop, and a 600px narrow desktop pane; collapsed and expanded for every
fixture. The suite checks strip/card/viewport containment, document horizontal
scroll, title clamp, page-marker visibility, disclosure expanded state and
panel association, title/disclosure/link target geometry, hit testing, keyboard
order, unavailable feedback, and 200% text at 320/390px. A coarse-pointer pass
confirms 48px targets.

Representative captures were inspected at 390px expanded, 1440px desktop
expanded, and 320px with 200% text. The first pass found two presentation
defects, both fixed before the confirmation pass:

1. The disclosure label broke inside words because its row had no available
   width. The row now drops horizontal padding below a 180px container and the
   label wraps by word.
2. The harness fell back to the browser serif font because `ThemeContext` was
   absent. The harness now sets the app's system font variable.

The confirmation pass reran all 19 tests with no further defects.

## Static analysis

- ESLint on every changed TS/TSX file: 0 errors. The only warnings were five
  pre-existing `no-useless-escape` warnings in `src/lib/i18n/locales/fr.ts`
  outside the added lines.
- Impeccable detect (`--json`) on the changed UI targets: exit 0. Findings were
  five advisories for 11px/10px text. `11px` is the documented label-small size
  in `DESIGN.md`; `10px` is the pre-existing link/shortcut size.
- `npx tsc --noEmit`: only pre-existing errors in
  `src/components/media/RSSReader.tsx` (unrelated working-tree changes).

## Performance gate

`npm run bench:check` ran the full benchmark suite and bundle budget, then
failed on four unrelated benchmarks:

```text
commandPalette/recent-selection-3000-docs   1.36x limit 1.25
article-import-static-large-260p            1.48x limit 1.40
citation renderAnswer (40 claims)           1.27x limit 1.25
sourcePlan page context                     1.45x limit 1.25
```

This change touches no benchmarked runtime path and did not modify
`scripts/perf-baselines.json`. Those failures were not suppressed. The bundle
budget passed independently: entry 3 KB, 1 PDF worker, total 26.1 MB.

## Device gaps

- `adb devices`: no devices attached.
- Linux host: no iOS simulator available.
- Chromium browser engine only; iOS WKWebView and Android WebView touch
  navigation/disclosure were not exercised. Physical-device verification
  remains outstanding.
