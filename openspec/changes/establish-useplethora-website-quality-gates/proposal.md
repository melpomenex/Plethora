## Why

A beautiful site that is slow, unindexable in production by accident, inaccessible, or full of banned claims will fail the launch. Quality must be encoded as CI and a written launch/rollback procedure, not “we’ll check Lighthouse later.”

## What Changes

- Playwright (or equivalent) smoke across routes: nav, pricing toggle, downloads recommendation, demo start/complete, legal draft banner.
- axe-core WCAG 2.2 AA on key pages; keyboard path for demo.
- Performance budgets: LCP, INP, CLS, JS weight, font weight, image weight, no infinite rAF.
- SEO: unique titles/descriptions, canonicals, sitemap, robots, OG, structured data validity **without false offers**.
- Preview/staging always noindex; production index only when blockers empty.
- Analytics wrapper tests: events fire to sink; disabled in `astro dev` by default; no document text in payloads.
- Visual snapshots for homepage + pricing (separate from app `src/visual` baselines).
- Cross-browser matrix documented: last 2 Chrome/Edge, Safari 16.4+, Firefox, iOS Safari, Android Chrome; mid-range Android budget.
- Broken-link check; asset freshness (C’s script) as a release job.
- Launch-day checklist + rollback (previous Vercel deployment).
- **Non-goals:** deploying; implementing B/D/E features; modifying app CI budgets (`scripts/bundle-budgets.json`) except adding an **additive** `website` workflow.

## Capabilities

### New Capabilities

- `useplethora-website-quality-gates`: tests, budgets, SEO/robots, analytics privacy, launch/rollback, claim enforcement.

## Impact

- `website/tests/**`, `website/playwright.config.ts`, `website/lighthouserc.*`, `.github/workflows/website.yml` (new).
- Does not change `.github/workflows/ci.yml` app jobs except adding a path filter so app CI ignores `website/**` if currently triggered by them (only if needed).

## Dependencies

- A for package.
- Full budgets after B/D; harness can land on stubs.
- E’s `banned-phrases.json` and `claims.json`.
- C’s freshness script.

## Ownership

**May modify:** website tests, website CI workflow, launch docs under `website/docs/launch.md`.

**Must not modify:** visual homepage implementation except adding `data-testid`; demo machine except testids; app Playwright snapshots; root PWA vercel.json.
