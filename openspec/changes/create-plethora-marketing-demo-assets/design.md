## Context

`demo/README.md` describes auto-import of `demo/apkg` and `demo/books` on empty DB, but those directories are not populated in git. `src/lib/demoContent.ts` loads `/demo-content/index.json` for PWA. Playwright (`playwright.config.ts`) snapshots PDF reflow at 390×844 warn-only. `src-tauri/src/screenshot.rs` is in-app overlay capture, not App Store export. `docs/release/*.png` exist without a license/provenance file. iOS listing OpenSpec requires captures from the **RC TestFlight build** after F-31 theme decision.

## Goals / Non-Goals

**Goals:** A coherent, legal demo story; deterministic seed; documented capture commands; web-optimized derivatives; manifest; blocker list for missing shots.

**Non-Goals:** Shipping copyrighted textbooks; replacing user libraries; asserting store screenshots are final before RC; implementing website CSS.

## Decisions

### Story

Working title: **“Why we forget what we read.”** Sources (all original or PD):

1. Original ~1,500-word essay on encoding vs highlighting (HTML).
2. Short original “lecture” transcript + chaptered audio (self-recorded or TTS labeled as demo).
3. Original one-page “methods” PDF on spaced retrieval.
4. Public-domain excerpt (e.g. William James on habit/memory) with Gutenberg attribution.
5. Original diagram (SVG) of encoding → retrieval for **image occlusion**.
6. Notes, extracts, five card types, fake but consistent review log, three labeled connections.

Theme may change if the founder objects; legality and coherence MUST remain.

### Seeding

- Source of truth: `marketing/demo-library/` (json + files).
- Loader: `scripts/marketing/seed-demo-library.mjs` that either (a) writes into `demo/` **only when** `MARKETING_SEED=1`, or (b) generates a `.plethora`/sqlite fixture consumed by a documented Tauri command already used by demo-mode OpenSpec.
- Prefer extending `add-demo-mode-with-onboarding` rather than a third importer.
- Seed MUST be deterministic (fixed UUIDs, timestamps, RNG seed).

### Capture

- Desktop: 1440×900 and 1280×800, macOS and Windows chrome **as actually available** on the capture machine; do not Photoshop a fake Windows window around macOS.
- iPhone: 390×844 and 430×932.
- Android: 360×800 and 412×915.
- iPad if used on site: 1024×1366.
- Themes: light, dark, e-ink (`data-display-mode="eink"`).
- Command: **Extend existing Playwright** (`playwright.config.ts`, default 390×844, `src/visual/`) with marketing scene-freeze URLs modeled on Knowledge Peck (`kp-freeze`, eink `localStorage`). Do **not** install Percy/Chromatic/Storybook. Do **not** use `src-tauri/src/screenshot.rs`. Do **not** overwrite `src/visual/__snapshots__`. Store-size frames (6.9"/6.5"/iPad 13") remain a device/RC capture path. If OS windows cannot be automated, a human protocol is acceptable but files still need hashes + build id.
- Naming: `{surface}_{platform}_{viewport}_{theme}_{build}.png`.

### Optimization

- Commit **source PNG/AVIF masters** under `marketing/screenshots/source/` if size allows; web derivatives as AVIF/WebP + PNG fallback in `website/public/images/product/`.
- Explicit width/height in manifest to prevent CLS.
- Do not overwrite Playwright **app** visual baselines when regenerating marketing shots.

### Placeholders

Any missing required surface is `{ "placeholder": true, "blocker": true }` in the manifest. Required for launch: library, reader+extract, explain, card, review, desktop collage, iOS frame, Android frame. E-ink MAY be placeholder with blocker=false if labeled.

## Risks

- Accidental copyrighted covers in library grid → seed linter that flags known-empty cover using branded placeholder.
- Drift from RC UI → freshness script compares `buildId` to release tag.
- F-31 green chrome in shots → record theme id in manifest; founder decision.

## Open Questions

Founder: story theme; whether marketing seed may replace empty `demo/books` in git.
