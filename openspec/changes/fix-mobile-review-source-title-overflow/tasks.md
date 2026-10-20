## 1. Contained source controls

- [x] 1.1 Refactor `CardSourceContext` into a bounded, shrinkable title-navigation control with a two-line compact title, separate visible page metadata, and persistent icon/navigation cues; verify the title invokes the existing default handler or `onActivate` override and the reported title fits in the browser harness.
- [x] 1.2 Add an independent source-details disclosure showing the full wrapping title, optional excerpt, and sibling external link, including sources without snippets and unavailable outcomes; verify disclosure never navigates, snippets remain inert text, and no interactive element contains another interactive element.
- [x] 1.3 Apply existing theme/focus tokens, 40px control minimums and 48px coarse-pointer minimums, and localized disclosure labels; verify keyboard order, full-title accessible names, expanded-state/panel association, and existing locale parity for new keys.

## 2. Focused regression coverage

- [x] 2.1 Extend `src/components/review/__tests__/CardSourceContext.test.tsx` to cover title navigation, the callback override, loading deduplication, independent full-title disclosure with/without a snippet, external-link activation, and retained unavailable/hidden states; verify with `npx vitest run src/components/review/__tests__/CardSourceContext.test.tsx`.
- [x] 2.2 Add a minimal real-component harness under `src/visual` with an HTML entry following existing fixtures, mocked source data/navigation, and representative review-card padding; verify it renders short, screenshot-length, unbroken long-title, page/URL, no-snippet, and unavailable fixtures with observable action counts.
- [x] 2.3 Add `src/visual/card-source-context.visual.spec.ts` to check collapsed/expanded containment, horizontal scroll, target geometry and hit testing at 320/360/390/430px, landscape, tablet, desktop, and a narrow desktop pane, including 200% text size; verify with `npx playwright test src/visual/card-source-context.visual.spec.ts` and save representative screenshots for painted-text/focus inspection.

## 3. Integrated verification

- [x] 3.1 Run the focused source tests plus `ReviewCard.test.tsx` and `ReviewCard.freeResponse.test.tsx`, and exercise source opening/return on a real review session; verify the card, answer state, typed response, session position, and progress survive, and distinguish mocked navigation assertions from actual reader integration evidence.
- [x] 3.2 Run ESLint on changed TypeScript/TSX files, `.agents/skills/impeccable/scripts/impeccable detect --json <changed UI targets>`, and the required local `npm run bench:check` gate; record results and any pre-existing failures without changing unrelated code or budgets to suppress them.
- [x] 3.3 Review phone/desktop screenshots together in one visual pass, address observed defects in one batch, and perform at most one confirmation pass; verify touch navigation/disclosure in available iOS/Android WebViews and record engine/device evidence or unavailable-device gaps in the change's verification notes.
