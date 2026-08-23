# Marketing scripts

Canonical demo library: `marketing/demo-library/`.
Stills: `marketing/screenshots/source/` → `website/public/images/product/`.
Manifest: `marketing/asset-manifest.json` (copied to `website/src/config/asset-manifest.json`).

## Seed (opt-in)

Does **not** run on normal installs.

```bash
# Build PDF/EPUB/WAV and copy into demo/books + demo/audio
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs

# Wipe seeded demo files only
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs --reset --reset-only
```

Re-seed after wipe: omit `--reset-only`. `SKIP_DEMO_IMPORT=1` still disables first-run import.

## Capture + encode

```bash
node scripts/marketing/capture-screenshots.mjs
node scripts/marketing/encode-product-images.mjs
node scripts/marketing/check-freshness.mjs
```

`PUBLIC_INDEXING=index node scripts/marketing/check-freshness.mjs` **fails** while required stills are placeholders.

Protocol: `capture-screenshots.md`. No Percy/Chromatic/Storybook. Do not touch `src/visual/__snapshots__`.
