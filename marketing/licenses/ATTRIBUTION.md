# Attribution

Every production-consumable file under `marketing/demo-library`, `marketing/screenshots`, `marketing/generated`, `website/public/images/product`, and `website/public/images/showcase/v2` must appear here either directly or through a trailing-slash directory entry whose files are hash-inventoried by a manifest. `scripts/marketing/check-freshness.mjs` fails on unlisted paths. Files classified by `marketing/screenshots/quarantine.json` are deliberately excluded from production and do not gain approval by appearing on disk.

No real emails, photographs of people, or third-party commercial covers are used.

## Policy

| Kind | License | Origin |
|---|---|---|
| Original essay, lecture transcript, methods PDF, notes, cards, graph, SVG | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Written for this demo |
| James excerpt | Public domain (US) | William James, *The Principles of Psychology* (1890) |
| Lecture WAV | CC0-1.0 | Synthetic demo tone (not a human recording) |
| Placeholder stills | CC0-1.0 | Generated label art, **not** product UI |
| Encoded AVIF/WebP/PNG | same as source | `scripts/marketing/encode-product-images.mjs` |
| Plethora product UI in showcase-v2 captures | Apache-2.0 | Real Plethora capture build; embedded corpus text retains its source license |

## Files

### Manifests

- `marketing/asset-manifest.json` — CC0-1.0 — generated manifest
- `website/src/config/asset-manifest.json` — CC0-1.0 — copy of the marketing manifest
- `marketing/showcase-scenes-v2.source.json` — Apache-2.0 — authored scene graph and accessibility descriptions
- `marketing/showcase-v2-contract.ts` — Apache-2.0 — shared typed capture contract
- `marketing/generated/showcase-scenes-v2.json` — Apache-2.0 — generated scene catalog
- `website/src/config/showcase-scenes-v2.json` — Apache-2.0 — generated website copy of the scene catalog
- `website/src/config/showcase-v2-active.json` — Apache-2.0 — reviewed active-set policy

### Demo library

- `marketing/demo-library/README.md` — CC0-1.0 — original
- `marketing/demo-library/library.json` — CC0-1.0 — original
- `marketing/demo-library/schema/library.schema.json` — CC0-1.0 — original
- `marketing/demo-library/TAURI_IMPORT.md` — CC0-1.0 — native disposable-profile procedure
- `marketing/demo-library/sources/01-essay/encoding-versus-highlighting.html` — CC0-1.0 — original essay
- `marketing/demo-library/sources/02-lecture/lecture-transcript.md` — CC0-1.0 — original transcript
- `marketing/demo-library/sources/02-lecture/chapters.json` — CC0-1.0 — original
- `marketing/demo-library/sources/04-pd-excerpt/william-james-habit-memory.md` — public domain text (James 1890); this excerpt file CC0-1.0
- `marketing/demo-library/sources/04-pd-excerpt/william-james-habit-memory.html` — same
- `marketing/demo-library/sources/05-occlusion/encoding-retrieval.svg` — CC0-1.0 — original diagram
- `marketing/demo-library/sources/05-occlusion/occlusion-regions.json` — CC0-1.0 — original
- `marketing/demo-library/sources/06-notes-cards-graph/notes.md` — CC0-1.0 — fictional study notes
- `marketing/demo-library/sources/06-notes-cards-graph/extracts.json` — CC0-1.0 — original
- `marketing/demo-library/sources/06-notes-cards-graph/cards.json` — CC0-1.0 — original
- `marketing/demo-library/sources/06-notes-cards-graph/review-log.json` — CC0-1.0 — original
- `marketing/demo-library/sources/06-notes-cards-graph/connections.json` — CC0-1.0 — original
- `marketing/demo-library/generated/spaced-retrieval-methods.pdf` — CC0-1.0 — original methods one-pager
- `marketing/demo-library/generated/encoding-versus-highlighting.epub` — CC0-1.0 — original essay EPUB
- `marketing/demo-library/generated/william-james-habit-memory.epub` — James 1890 public domain; packaging CC0-1.0
- `marketing/demo-library/generated/lecture-demo.wav` — CC0-1.0 — labeled synthetic tone
- `marketing/demo-library/generated/marketing-fixture-v2.json` — mixed CC0-1.0/public-domain corpus, deterministic generated fixture

### Capture policy and approved showcase source

- `marketing/screenshots/capture-policy.json` — Apache-2.0 — launch theme, build-ID, path, and omission policy
- `marketing/screenshots/native-capture-protocol.md` — Apache-2.0 — native simulator/store capture protocol
- `marketing/screenshots/quarantine.json` — Apache-2.0 — explicit non-production classifications
- `marketing/screenshots/source/CAPTURE_LOG.md` — Apache-2.0 — source capture audit log
- `marketing/screenshots/source/showcase-v2/2.7.0+9a6e7dc075b2-2026-08-23T14-01-22-773Z/` — Apache-2.0 Plethora UI with CC0-1.0/public-domain fictional corpus — approved 16-scene source set and hash manifest

Unapproved legacy PWA, placeholder, superseded showcase-run, and personal-device files remain covered only by quarantine rules. They are not licensed or approved for website production consumption by this inventory.

### Source stills (placeholders until RC capture)

- `marketing/screenshots/source/README.md` — CC0-1.0
- `marketing/screenshots/source/library_iphone_iphone-14-390x844_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/reader_iphone_iphone-14-390x844_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/explain_iphone_iphone-14-390x844_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/card_iphone_iphone-14-390x844_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/review_iphone_iphone-14-390x844_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/desktop-collage_desktop_desktop-1440x900_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/ios-frame_iphone_iphone-14-pro-430x932_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/android-frame_android_android-412x915_light_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/eink-reader_iphone_iphone-14-390x844_eink_placeholder-unreleased.png` — CC0-1.0 placeholder
- `marketing/screenshots/source/og_web_og-1200x630_light_placeholder-unreleased.png` — CC0-1.0 placeholder

### Website derivatives

- `website/public/images/showcase/v2/2.0.0-2.7.0+9a6e7dc075b2/` — same as approved showcase source — generated AVIF/WebP/PNG set plus per-file SHA-256 manifest

- `website/public/images/product/screenshot-library.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-library.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-library.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-reader.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-reader.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-reader.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-explain.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-explain.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-explain.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-card.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-card.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-card.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-review.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-review.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-review.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-desktop-collage.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-desktop-collage.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-desktop-collage.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-ios-frame.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-ios-frame.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-ios-frame.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-android-frame.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-android-frame.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-android-frame.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-eink.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-eink.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/screenshot-eink.avif` — CC0-1.0 placeholder derivative
- `website/public/images/product/og-default.png` — CC0-1.0 placeholder derivative
- `website/public/images/product/og-default.webp` — CC0-1.0 placeholder derivative
- `website/public/images/product/og-default.avif` — CC0-1.0 placeholder derivative
