## Why

Plethora has no commercial marketing site. Root `vercel.json` deploys the **PWA**, README still cites `readsync.org`, and `src/config/product.ts` still uses placeholder `plethora.app`. Launch-day needs https://useplethora.com as a static-first, flag-driven site that can stay noindex with downloads and checkout off until the LLC, stores, and binaries exist — without stuffing a brochure into the Tauri webview.

## What Changes

- Add a new **`website/`** Astro 5 package at the repository root, independent of `plethora-tauri` Vite config and independent of root `vercel.json`.
- Encode launch, pricing, download, legal-placeholder, claim, analytics, and demo **TypeScript contracts** from `openspec/planning/useplethora-website-shared-contracts.md`.
- Provide global layout: skip link, header, footer, landmarks, meta slot, consent slot (empty until F/E decide).
- Add Vercel configuration **scoped to `website/`** (headers, redirects, trailing slash, `www` → apex, preview noindex).
- Document env vars and a **verify-before-link** Vercel CLI procedure. Do not link or deploy in this change if credentials/project are ambiguous.
- Stub routes for pages owned by later changes (simple “coming soon / owned by change E/B/D” is acceptable) so the router and sitemap exist.
- **Non-goals:** homepage art direction, demo state machine, screenshot pipeline, legal prose, root PWA Vercel changes, app billing.

## Capabilities

### New Capabilities

- `useplethora-web-foundation`: package layout, routing shell, config modules, env schema, Vercel project files under `website/`, preview vs production indexing flags, coexistence with the existing PWA deployment.

### Modified Capabilities

- (none in `openspec/specs/`)

## Impact

- New directory `website/` (Node/Astro). Root `package.json` of the app SHOULD NOT need to install Astro; optional root script `website:build` MAY proxy.
- New docs: `website/README.md`, `website/docs/vercel.md`.
- CI: none required here except not breaking app CI; F adds `website-ci.yml`.
- Does not modify `src/`, `src-tauri/`, `server/`, or root `vercel.json`.

## Dependencies

- Hard: none on other *website* changes.
- Soft: consume facts from `establish-plethora-commercial-product-foundation` (`src/types/entitlements.ts`) when seeding default plan feature ids — copy ids, do not import app code into the website bundle.
- Must not start: overwriting PWA hosting.

## Ownership

**May modify:** `website/**` (create), `openspec/planning/useplethora-website-shared-contracts.md` only if types need a fix (prefer code matching the doc).

**Must not modify:** homepage visual components owned by B, `website/src/components/demo/**` (D), commercial page bodies (E), `scripts/marketing/**` (C), root `vercel.json`, application runtime.

## Merge order

First website change to merge. Unblocks B/C/E/D/F.
