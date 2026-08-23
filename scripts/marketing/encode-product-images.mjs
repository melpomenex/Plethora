/**
 * Encode marketing/screenshots/source PNG → AVIF/WebP/PNG in website/public/images/product
 * and write MarketingAssetManifest JSON (repo + website copy).
 */
import { existsSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_SPECS, PLACEHOLDER_BUILD_ID, STORY_ID, sourcePngName } from "./surfaces.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export async function encodeProductImages() {
  const sharp = (await import("sharp")).default;
  const publicDir = join(ROOT, "website/public/images/product");
  mkdirSync(publicDir, { recursive: true });

  const generatedAt = "2026-08-23T12:00:00.000Z";
  const assets = [];
  const blockers = [];

  for (const spec of CAPTURE_SPECS) {
    const sourceRelPreferred = `marketing/screenshots/source/${sourcePngName(spec)}`;
    const sourceRelFallback = `marketing/screenshots/source/${sourcePngName(spec, PLACEHOLDER_BUILD_ID)}`;
    const sourceAbs = existsSync(join(ROOT, sourceRelPreferred))
      ? join(ROOT, sourceRelPreferred)
      : join(ROOT, sourceRelFallback);
    const sourceRel = existsSync(join(ROOT, sourceRelPreferred)) ? sourceRelPreferred : sourceRelFallback;
    const pngName = `${spec.id}.png`;
    const webpName = `${spec.id}.webp`;
    const avifName = `${spec.id}.avif`;
    const img = sharp(sourceAbs);
    await img.clone().png().toFile(join(publicDir, pngName));
    await img.clone().webp({ quality: 82 }).toFile(join(publicDir, webpName));
    await img.clone().avif({ quality: 55 }).toFile(join(publicDir, avifName));

    const placeholder = basename(sourceRel).includes("placeholder");
    if (placeholder && spec.required) blockers.push(spec.id);

    assets.push({
      id: spec.id,
      kind: spec.kind,
      sourcePath: sourceRel,
      publicPath: `/images/product/${webpName}`,
      alt: spec.alt,
      license: "CC0-1.0",
      attribution: placeholder
        ? "Labeled placeholder (not product UI). Replace from RC capture protocol."
        : "Captured from Plethora UI with marketing demo library.",
      viewport: spec.viewport,
      theme: spec.theme,
      buildId: placeholder ? PLACEHOLDER_BUILD_ID : process.env.MARKETING_BUILD_ID,
      placeholder,
      width: spec.width,
      height: spec.height,
      fallbacks: {
        avif: `/images/product/${avifName}`,
        webp: `/images/product/${webpName}`,
        png: `/images/product/${pngName}`,
      },
    });
  }

  const manifest = {
    storyId: STORY_ID,
    generatedAt,
    assets,
    blockers,
  };

  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const marketingPath = join(ROOT, "marketing/asset-manifest.json");
  const websitePath = join(ROOT, "website/src/config/asset-manifest.json");
  writeFileSync(marketingPath, json);
  mkdirSync(dirname(websitePath), { recursive: true });
  copyFileSync(marketingPath, websitePath);
  return { marketingPath, websitePath, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await encodeProductImages();
  console.log(result.marketingPath);
  console.log(`assets=${result.manifest.assets.length} blockers=${result.manifest.blockers.length}`);
}
