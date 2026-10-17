# Legal Pad material source

`source-4096.png` is the original **4096×4096, 8-bit SDR color map** from [ambientCG Paper006](https://ambientcg.com/a/Paper006), distributed under [CC0](https://docs.ambientcg.com/license/). It is retained at original resolution; the smaller generated reference was rejected for production. The source's paper fibers are neutralized; theme colors provide the archival yellow. The author provides no physical scale/color-chart calibration, so none is claimed here.

Rebuild the packaged lossless WebP/PNG derivatives with the existing local Sharp dependency:

```sh
node scripts/build-paper-material.mjs
node --test scripts/__tests__/paper-material.test.mjs
```

The script checks source dimensions, derives high-frequency fibers at each density, separates macro variation, bounds signed opacity, matches tile edges, embeds sRGB profiles and writes hashes/dimensions/byte sizes to `public/theme-materials/legal-pad/v1/manifest.json`. It does not upscale the original source or run at application startup. Runtime uses one grain variant and one macro asset; no runtime shader or procedural grain is involved.

Paper controls live in Appearance after selecting **Legal Pad — Archival Yellow**. Explicit RSS/PDF palettes take precedence; EPUB offers **App theme / Original book**. Original PDF pixels and fixed-layout book art retain source rendering. Forced colors, E-Ink and high contrast suppress decoration. Hardware-limited environments may reduce effective detail without changing the saved preference.

The current release path is sRGB SDR only. Wide-gamut output is not certified and production HDR is disabled. See [implementation evidence](../../../docs/theme-materials/legal-pad/validation.md), the [design](../../../openspec/changes/add-legal-pad-paper-theme/design.md) and the [test matrix](../../../openspec/changes/add-legal-pad-paper-theme/test-matrix.md) for pending gates. Remove registration/material application to roll back; optional settings can remain ignored and imported source files are never changed by the theme.
