## Context

App CI already runs huge Vitest/cargo/bench suites. Website quality must be a **separate workflow** so marketing work does not wait on Rust. Playwright exists at repo root for PDF visuals — **do not** mix snapshot directories.

## Goals / Non-Goals

**Goals:** Measurable gates; privacy-respecting analytics; staging noindex guaranteed; launch/rollback written; claim/banned-phrase CI; CWV budgets ambitious but mid-range Android survivable.

**Non-Goals:** Perfect 100 Lighthouse vanity; deploying from this change; replacing app visual tests.

## Decisions

### Performance budgets (homepage, cable/4G emulation, mid Android)

| Metric | Budget |
|---|---|
| LCP | ≤ 2.5s |
| INP | ≤ 200ms |
| CLS | ≤ 0.05 (stricter than 0.1 because device frames) |
| JS transferred (homepage initial) | ≤ 180 KB gzip (demo not in initial) |
| Demo chunk | ≤ 80 KB gzip additional on interaction |
| Fonts | ≤ 80 KB (subsets) |
| Hero images | explicit dimensions; AVIF/WebP; LQIP or reserved aspect-ratio |
| Animation | no unbounded rAF; pause hidden/offscreen |

Tooling: Playwright + `playwright-lighthouse` or `unlighthouse` on preview URLs; local `astro build` size check.

### Accessibility

WCAG 2.2 AA. axe on `/`, `/pricing`, `/downloads`, `/privacy`, `/demo` slot. Manual keyboard script in `website/docs/a11y.md`. Target 44px. Forced-colors: borders remain visible. No information only-in-screenshots (E/D provide text). Captions if any video. No flashing Peck.

### SEO / indexing

- Unique title/description per route.
- Canonical absolute URLs.
- `robots.txt` + meta robots from `PUBLIC_INDEXING`.
- **Invariant test:** on `indexing=noindex` OR Vercel Preview, every document has `noindex`.
- Sitemap omitted or disallowed when noindex.
- OG 1200×630 from C/B.
- JSON-LD: do not set `AggregateRating` or `reviewCount`. `offers.availability` ComingSoon while checkout disabled.

### Analytics

Default vendor: **none** until founder picks. Recommended: Plausible or self-hosted, cookieless if possible. If cookies/fingerprinting: consent banner required (E/A slot). Events from contracts only. Dev: no network. Tests use a fake `window.plausible`/`dataLayer` sink.

### CI workflow

`.github/workflows/website.yml`:
- on paths `website/**`, `marketing/**`, `openspec/changes/*useplethora*`
- `npm ci` in website
- `astro check`, unit tests, playwright (chromium + webkit job), axe, phrase grep, bundle size
- does **not** run `cargo test`

### Launch / rollback

`website/docs/launch.md`:
1. Preview URL QA
2. Confirm flags
3. Attach domain
4. Flip indexing only after blockers
5. Rollback: Vercel Instant Rollback / redeploy previous alias
6. Post-launch: home, pricing, downloads, privacy, demo, sitemap, robots, https, www redirect

### Visual regression

`website/tests/visual` snapshots. Independent of `src/visual/__snapshots__` (app Playwright; warn-only in `ci-regression.yml`). Update via explicit `npm run test:visual:website --update` — not silently in marketing capture. Website CI MUST NOT run or rewrite the app visual job.

## Risks

- Lighthouse flake → median of 3, retry once.
- WebKit scroll-timeline missing → F asserts reduced functionality still passes a11y, not pixel-identical motion.

## Open Questions

Founder analytics vendor; whether GitHub Actions minutes should run Lighthouse only on `main`.
