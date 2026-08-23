#!/usr/bin/env node
/**
 * Marketing asset freshness + license inventory.
 *
 * Exits non-zero when:
 * - a binary/source under the marketing trees lacks an ATTRIBUTION.md row
 * - ATTRIBUTION lists a missing path
 * - required manifest assets are placeholder while PUBLIC_INDEXING=index
 *
 * Usage: node scripts/marketing/check-freshness.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_ASSET_IDS } from "./surfaces.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ATTR = join(ROOT, "marketing/licenses/ATTRIBUTION.md");

const TREES = [
  "marketing/demo-library",
  "marketing/licenses",
  "marketing/screenshots",
  "website/public/images/product",
];

const EXTRA_FILES = ["marketing/asset-manifest.json", "website/src/config/asset-manifest.json"];

const SKIP_NAMES = new Set([".DS_Store", ".gitkeep"]);

function walk(relDir, acc = []) {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs)) {
    if (SKIP_NAMES.has(name)) continue;
    const rel = join(relDir, name).replaceAll("\\", "/");
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
}

function parseAttribution(markdown) {
  const paths = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(markdown))) {
    const p = m[1];
    if (
      p.startsWith("marketing/") ||
      p.startsWith("website/public/") ||
      p.startsWith("website/src/config/asset-manifest")
    ) {
      paths.add(p);
    }
  }
  return paths;
}

function loadManifest() {
  const p = join(ROOT, "marketing/asset-manifest.json");
  if (!existsSync(p)) {
    throw new Error("missing marketing/asset-manifest.json");
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

export function checkFreshness({ env = process.env } = {}) {
  const errors = [];
  if (!existsSync(ATTR)) {
    return { ok: false, errors: ["missing marketing/licenses/ATTRIBUTION.md"] };
  }
  const listed = parseAttribution(readFileSync(ATTR, "utf8"));
  const onDisk = [];
  for (const tree of TREES) onDisk.push(...walk(tree));
  for (const extra of EXTRA_FILES) {
    if (existsSync(join(ROOT, extra))) onDisk.push(extra);
  }

  const skipAttributionSelf = "marketing/licenses/ATTRIBUTION.md";
  for (const rel of onDisk) {
    if (rel === skipAttributionSelf) continue;
    if (!listed.has(rel)) errors.push(`unattributed file: ${rel}`);
  }
  for (const rel of listed) {
    if (!existsSync(join(ROOT, rel))) errors.push(`attribution path missing on disk: ${rel}`);
  }

  const forbidden = /(^|[^a-z])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}(?=$|[^a-z])/i;
  const photoHints = /headshot|portrait of|photo of (a |the )?(man|woman|child|person)/i;
  for (const rel of onDisk) {
    if (!/\.(md|html|json|svg|txt)$/i.test(rel)) continue;
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (forbidden.test(text) && !rel.includes("ATTRIBUTION") && !rel.includes("capture-screenshots")) {
      errors.push(`possible email or personal address in ${rel}`);
    }
    if (photoHints.test(text)) errors.push(`possible photo-of-person language in ${rel}`);
  }

  const manifest = loadManifest();
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  for (const id of REQUIRED_ASSET_IDS) {
    const asset = byId.get(id);
    if (!asset) {
      errors.push(`manifest missing required asset ${id}`);
      continue;
    }
    if (!asset.width || !asset.height || !asset.alt) {
      errors.push(`${id} missing width/height/alt`);
    }
    if (!asset.placeholder) {
      const src = join(ROOT, asset.sourcePath);
      if (!existsSync(src)) errors.push(`${id} source missing: ${asset.sourcePath}`);
    }
  }

  const indexing =
    env.PUBLIC_INDEXING === "index" || env.PUBLIC_INDEXING === "index" ? "index" : "noindex";
  if (indexing === "index") {
    for (const id of REQUIRED_ASSET_IDS) {
      const asset = byId.get(id);
      if (!asset || asset.placeholder) {
        errors.push(`PUBLIC_INDEXING=index but ${id} is placeholder or missing`);
      }
    }
    if (Array.isArray(manifest.blockers) && manifest.blockers.length > 0) {
      errors.push(`PUBLIC_INDEXING=index with manifest.blockers: ${manifest.blockers.join(", ")}`);
    }
  }

  return { ok: errors.length === 0, errors, indexing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkFreshness();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`ok indexing=${result.indexing}`);
}
