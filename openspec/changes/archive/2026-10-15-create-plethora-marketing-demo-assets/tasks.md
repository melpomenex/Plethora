## 1. Corpus

- [x] 1.1 Create `marketing/demo-library/` with the six source types in the design (essay, lecture, PDF, PD excerpt, occlusion diagram, notes/cards/graph).
- [x] 1.2 Add `marketing/licenses/ATTRIBUTION.md` listing every file, license, and origin. Reject unknown files.
- [x] 1.3 Ensure no real emails, photos of people, or third-party commercial covers.

## 2. Seed tooling

- [x] 2.1 Define JSON schema for the library (ids, media paths, card templates, connection list).
- [x] 2.2 Implement deterministic seed script extending `demo/` or demo-mode import; gate with `MARKETING_SEED=1` (or equivalent) so normal installs do not change.
- [x] 2.3 Document how to reset and re-seed.

## 3. Capture

- [x] 3.1 Write `scripts/marketing/capture-screenshots.md` protocol: build id, theme, viewports, devices.
- [x] 3.2 Automate what can be automated (Playwright against demo seed); remaining shots listed as human steps.
- [x] 3.3 Produce source images into `marketing/screenshots/source/`.

## 4. Web pipeline

- [x] 4.1 Encode AVIF/WebP + PNG fallbacks into `website/public/images/product/`.
- [x] 4.2 Write `website/src/config/asset-manifest.json` (or `marketing/asset-manifest.json` copied at build) matching the shared `MarketingAssetManifest` type.
- [x] 4.3 Include intrinsic widths/heights and alt text derived from the story.

## 5. Freshness and blockers

- [x] 5.1 Script `scripts/marketing/check-freshness.mjs` exits non-zero if required assets are placeholder while `PUBLIC_INDEXING=index`.
- [x] 5.2 Do not update `src/visual/__snapshots__` as part of marketing regeneration.
- [x] 5.3 `openspec validate create-plethora-marketing-demo-assets --strict`.
