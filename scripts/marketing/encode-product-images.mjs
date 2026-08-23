#!/usr/bin/env node
/** Encode one fully-approved showcase-v2 capture set into versioned assets. */
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableJson } from "./compile-fixture-v2.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CAPTURE_ROOT = join(ROOT, "marketing/screenshots/source/showcase-v2");
const PUBLIC_ROOT = join(ROOT, "website/public/images/showcase/v2");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeSegment = (value) => value.replace(/[^a-zA-Z0-9._+-]/g, "-");

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function validateCaptureSet(captureSet, manifest, sharp) {
  if (!inside(CAPTURE_ROOT, captureSet)) throw new Error("Capture set must be inside marketing/screenshots/source/showcase-v2");
  if (manifest.metadata?.schemaVersion !== 2 || manifest.metadata?.sourceType !== "playwright-css-viewport") {
    throw new Error("Unsupported showcase-v2 capture manifest");
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.metadata.fixtureHash) || !/^[0-9a-f]{7,12}$/.test(manifest.metadata.gitSha)) {
    throw new Error("Capture fixture/build hashes are invalid");
  }
  if (!Array.isArray(manifest.captures) || manifest.captures.length !== 16) {
    throw new Error("A complete capture set must contain 16 required scene layouts");
  }
  const keys = new Set();
  for (const capture of manifest.captures) {
    const key = `${capture.sceneId}/${capture.layout}`;
    if (keys.has(key)) throw new Error(`Duplicate capture ${key}`);
    keys.add(key);
    if (
      capture.fixtureHash !== manifest.metadata.fixtureHash ||
      capture.fixtureVersion !== manifest.metadata.fixtureVersion ||
      capture.gitSha !== manifest.metadata.gitSha ||
      capture.appVersion !== manifest.metadata.appVersion ||
      capture.theme !== manifest.metadata.theme ||
      capture.locale !== manifest.metadata.locale ||
      capture.sourceType !== manifest.metadata.sourceType
    ) throw new Error(`Metadata drift in ${key}`);
    if (!capture.accessibleDescription || !capture.safeArea || !Array.isArray(capture.hotspots)) {
      throw new Error(`Incomplete capture metadata for ${key}`);
    }
    const source = join(captureSet, capture.filename);
    if (!inside(captureSet, source)) throw new Error(`Unsafe capture filename for ${key}`);
    const bytes = await readFile(source);
    if (sha256(bytes) !== capture.sourceHash) throw new Error(`Source hash drift for ${key}`);
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== capture.intrinsicSize.width || metadata.height !== capture.intrinsicSize.height) {
      throw new Error(`Intrinsic size drift for ${key}`);
    }
  }
}

export async function encodeShowcaseV2Images({ captureSet: captureSetInput, root = ROOT } = {}) {
  const sharp = (await import("sharp")).default;
  if (!captureSetInput) throw new Error("MARKETING_CAPTURE_SET is required");
  const captureSet = resolve(root, captureSetInput);
  const manifestPath = join(captureSet, "showcase-capture-v2.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateCaptureSet(captureSet, manifest, sharp);

  const versionDirectory = safeSegment(`${manifest.metadata.fixtureVersion}/${manifest.metadata.buildId}`);
  const publicRoot = root === ROOT ? PUBLIC_ROOT : join(root, "website/public/images/showcase/v2");
  const finalDirectory = join(publicRoot, versionDirectory);
  await access(finalDirectory).then(
    () => { throw new Error(`Refusing to overwrite existing encoded set ${finalDirectory}`); },
    () => {},
  );
  await mkdir(publicRoot, { recursive: true });
  const stage = await mkdtemp(join(publicRoot, ".stage-"));
  let published = false;
  try {
    const assets = [];
    for (const capture of manifest.captures) {
      const source = join(captureSet, capture.filename);
      const sourceBytes = await readFile(source);
      const widths = capture.layout === "desktop" ? [720, capture.intrinsicSize.width] : [capture.intrinsicSize.width];
      const formats = {};
      for (const format of ["avif", "webp", "png"]) {
        formats[format] = [];
        for (const width of widths) {
          const filename = `${capture.sceneId}--${capture.layout}--${width}.${format}`;
          const output = join(stage, filename);
          let pipeline = sharp(sourceBytes).resize({ width, withoutEnlargement: true });
          if (format === "avif") pipeline = pipeline.avif({ quality: 58, effort: 6 });
          if (format === "webp") pipeline = pipeline.webp({ quality: 84, effort: 5 });
          if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
          await pipeline.toFile(output);
          const bytes = await readFile(output);
          formats[format].push({
            width,
            path: `/images/showcase/v2/${versionDirectory}/${filename}`,
            sha256: sha256(bytes),
          });
        }
      }
      assets.push({
        ...capture,
        sourcePath: relative(root, source),
        formats,
      });
    }

    const assetManifest = {
      metadata: {
        ...manifest.metadata,
        schemaVersion: 2,
        encodedAt: new Date().toISOString(),
        assetBasePath: `/images/showcase/v2/${versionDirectory}`,
      },
      assets,
    };
    await writeFile(join(stage, "asset-manifest-v2.json"), stableJson(assetManifest), "utf8");
    await rename(stage, finalDirectory);
    published = true;
    return { finalDirectory, manifest: assetManifest };
  } finally {
    if (!published) await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await encodeShowcaseV2Images({ captureSet: process.env.MARKETING_CAPTURE_SET });
  console.log(result.finalDirectory);
  console.log(`assets=${result.manifest.assets.length}`);
}
