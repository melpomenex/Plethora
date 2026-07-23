#!/usr/bin/env node
/**
 * Bundle budget check — fails the build when startup-critical or total bundle
 * size regresses past recorded budgets.
 *
 * Run after `vite build`:  node scripts/check-bundle-budget.mjs [distDir]
 * Wired into `npm run build:check` and intended for CI.
 *
 * Budgets live in scripts/bundle-budgets.json and are set to post-optimization
 * actuals + ~10% headroom (see openspec/changes/optimize-performance-hotspots).
 * If you intentionally grow the bundle (new feature, new vendor), update the
 * budget in the same PR and say why in the PR description.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ?? join(scriptDir, "..", "dist");
const budgets = JSON.parse(readFileSync(join(scriptDir, "bundle-budgets.json"), "utf8"));

const assetsDir = join(distDir, "assets");

/** Recursively sum file sizes under a directory. */
function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += statSync(p).size;
  }
  return total;
}

let assets;
try {
  assets = readdirSync(assetsDir).map((name) => ({
    name,
    size: statSync(join(assetsDir, name)).size,
  }));
} catch (err) {
  console.error(`[bundle-budget] Cannot read ${assetsDir} — run \`vite build\` first (${err.message})`);
  process.exit(2);
}

const failures = [];
const kb = (bytes) => Math.round(bytes / 1024);

// 1. Entry chunk: the script index.html actually loads before first paint
//    (several small dynamic chunks are also named index-*.js, so pattern
//    matching on the name would blur the metric).
const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
const entryMatch = indexHtml.match(/src="\.?\/?(assets\/index-[^"]+\.js)"/);
const entryChunks = [];
if (!entryMatch) {
  failures.push("entry chunk: could not find the entry <script src> in dist/index.html (build layout changed? update this script)");
} else {
  const entryName = entryMatch[1].replace(/^assets\//, "");
  const chunk = assets.find((a) => a.name === entryName);
  if (!chunk) {
    failures.push(`entry chunk: ${entryName} referenced by index.html not found in assets/`);
  } else {
    entryChunks.push(chunk);
    if (chunk.size > budgets.entryChunkBytes) {
      failures.push(
        `entry chunk ${chunk.name}: ${kb(chunk.size)} KB exceeds budget ${kb(budgets.entryChunkBytes)} KB`
      );
    }
  }
}

// 2. Exactly one PDF.js worker build may ship (they are ~1 MB each; a second
//    one means the pdf.worker.min.mjs?url duplication regressed).
const pdfWorkers = assets.filter((a) => /pdf.*worker|pdfjs\.worker/i.test(a.name));
if (pdfWorkers.length !== budgets.pdfWorkerAssetCount) {
  failures.push(
    `PDF worker assets: found ${pdfWorkers.length} (${pdfWorkers.map((w) => w.name).join(", ") || "none"}), budget is exactly ${budgets.pdfWorkerAssetCount}`
  );
}

// 3. Total dist size (all shipped assets, including wasm).
const totalBytes = dirSize(distDir);
if (totalBytes > budgets.totalDistBytes) {
  failures.push(
    `total dist size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds budget ${(budgets.totalDistBytes / 1024 / 1024).toFixed(1)} MB`
  );
}

if (failures.length > 0) {
  console.error("[bundle-budget] FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("[bundle-budget] If this growth is intentional, update scripts/bundle-budgets.json in the same PR.");
  process.exit(1);
}

console.log(
  `[bundle-budget] OK — entry ${entryChunks.map((c) => `${kb(c.size)} KB`).join(", ")}, ` +
    `${pdfWorkers.length} PDF worker, total ${(totalBytes / 1024 / 1024).toFixed(1)} MB`
);
