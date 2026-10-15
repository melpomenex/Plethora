## Why

Marketing must show the real Plethora UI, not invented chrome. The repo already has `demo/` seeding, Playwright visual tests, in-app screenshot helpers, and `docs/release/*.png` of unknown provenance. This change creates a **licensed, deterministic demo library** plus a **repeatable capture pipeline** that the website, App Store listing package, and Play listing can share.

## What Changes

- Author a canonical “Memory, sleep, and learning” library: original/CC/public-domain texts, original notes, cards (incl. image occlusion on owned diagrams), mock review history, and a small connection graph — no commercial book covers, no scraped articles, no personal data.
- Define seed format compatible with existing `demo/` + `src/lib/demoContent.ts` / `src-tauri/src/demo.rs` patterns; extend rather than fork.
- Document capture of desktop, iPhone, Android, and e-ink look viewports in light/dark/e-ink where supported.
- Produce `marketing/asset-manifest.json` consumed by the website.
- Record license/attribution; mark placeholders as launch blockers.
- **Non-goals:** website layout (B), demo JS machine (D), store metadata copy (iOS listing change), changing default first-run content for production users unless behind an explicit marketing seed command.

## Capabilities

### New Capabilities

- `plethora-marketing-assets`: demo corpus, licensing, capture, optimization, manifest, freshness.

### Modified Capabilities

- none (may add scripts that call existing demo seed APIs)

## Impact

- `marketing/**`, `scripts/marketing/**`, possibly `demo/marketing/` fixtures.
- App code only if a **dev/marketing seed flag** is required; default app behavior unchanged.
- Website consumes optimized files under `website/public/images/product/`.

## Dependencies

- Soft: iOS listing OpenSpec screenshot storyboard (reuse sizes).
- Website B/D: consume manifest; placeholders until captures exist.

## Ownership

**May modify:** `marketing/`, `scripts/marketing/`, `website/public/images/product/`, demo fixtures clearly named `marketing-*`.

**Must not modify:** homepage components (B), demo island (D), commercial copy (E), Vercel config (A), billing.
