# Capture screenshots (marketing)

Production stills must come from the **real Plethora UI** plus the memory/sleep/learning demo library. Do not Photoshop fictional chrome. Do not draw controls the app does not have. Do not use `src-tauri/src/screenshot.rs`. Do not update `src/visual/__snapshots__`.

## Prerequisites

```bash
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs
```

Record:

| Field | How |
|---|---|
| `MARKETING_BUILD_ID` | App version + git SHA of the RC (example `2.7.0-abcdef1`) |
| Theme | Built-in light / dark, plus e-ink (`plethora-display-mode=eink`) |
| F-31 | Note whether chrome is still green (`#6daa2c`) vs purple brand |

## Viewports

| Surface | Platform | Size |
|---|---|---|
| Phone library / reader / explain / card / review | iPhone CSS | 390×844 |
| iOS frame | iPhone 14 Pro CSS | 430×932 |
| Android frame | mid Android CSS | 412×915 |
| Desktop collage | desktop | 1440×900 |
| E-ink reader | phone CSS | 390×844 |
| Store sizes | device/RC | 6.9" / 6.5" / iPad 13" — **human**, not this Playwright config |

Themes: `light`, `dark`, `eink`. File name:

`{surface}_{platform}_{viewport}_{theme}_{buildId}.png`

## Automated (Playwright)

If a **web** demo host is running with the seeded library:

```bash
MARKETING_CAPTURE_URL=http://127.0.0.1:5199 \
MARKETING_SEED=1 \
MARKETING_BUILD_ID=2.7.0-sha \
node scripts/marketing/capture-screenshots.mjs
```

Query params (DEV only, no default-user behavior): `marketing-capture=<surface>&marketing-seed=1`.

This environment often **cannot drive Tauri**. When capture fails, the script writes **labeled placeholders** (the word PLACEHOLDER, not fake UI).

Then encode:

```bash
node scripts/marketing/encode-product-images.mjs
```

## Human / device steps (remaining)

1. Launch the RC **desktop** app with `MARKETING_SEED=1` already applied to `demo/books`.
2. Capture library, reader+extract, explain, card, review at 1440×900 (macOS chrome as actually shown — do not fake Windows).
3. Repeat light and dark.
4. Capture e-ink if available; otherwise leave `screenshot-eink` as a labeled placeholder (`required: false`).
5. On iPhone 14-class and a mid Android device, capture the same five surfaces at native resolution for store listings.
6. Drop PNGs into `marketing/screenshots/source/`, update `buildId`, re-run encode.
7. Confirm `marketing/asset-manifest.json` `placeholder: false` for required ids and `blockers` is empty before `PUBLIC_INDEXING=index`.

## Reset seed

```bash
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs --reset --reset-only
```

Normal app installs never set `MARKETING_SEED`, so `demo/books` stays empty in git.
