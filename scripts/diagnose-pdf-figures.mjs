#!/usr/bin/env node
/**
 * PDF reflow figure-geometry diagnostic harness (dev-only, Piece A).
 *
 * Runs the app's REAL PDF-reflow figure pipeline end-to-end on real PDFs and
 * emits a side-by-side diagnostic report (debug/gauntlet/report.html +
 * summary.json) that makes figure geometry failures — thin slivers, partial
 * crops — immediately visible, visually AND numerically.
 *
 * What is REAL here (no reimplementation):
 *   - collection:  src/components/viewer/pdfCanonicalCollector.ts
 *                  `collectPageAnalysisInput` is bundled AS-IS by esbuild and
 *                  executed in headless Chromium against the installed
 *                  pdfjs-dist (import-mapped to node_modules).
 *   - analysis:    Rust `pdf::analysis::analyze_page` (the exact function the
 *                  `pdf_reflow_analyze_page` Tauri command calls), run by
 *                  `src-tauri/src/bin/pdf-reflow-diag.rs` with no Tauri
 *                  runtime.
 *   - crop math:   src/lib/pdf/cropGeometry.ts `computeCropSourceRect` /
 *                  `cropPadFor` are bundled AS-IS by esbuild and used for the
 *                  per-block crops AND the bbox overlay on every page
 *                  (including rotation ≠ 0) — the same functions
 *                  `src/lib/pdf/reflowAssets.ts` calls, so the harness can
 *                  never drift from the app's crop math. Only the
 *                  asset-store/Tauri upload is skipped, per the harness spec.
 *
 * Usage (from the repo root):
 *   node scripts/diagnose-pdf-figures.mjs
 *   node scripts/diagnose-pdf-figures.mjs --top 12
 *   node scripts/diagnose-pdf-figures.mjs --pages 31,32                 # all books
 *   node scripts/diagnose-pdf-figures.mjs --pages applied-evolutionary-psychology:31,32
 *   node scripts/diagnose-pdf-figures.mjs --books handbook-evolutionary-psych-vol1
 *   node scripts/diagnose-pdf-figures.mjs --max-rank 400                # cap ranking pass
 *
 * Outputs (all under --out, default debug/gauntlet, gitignored):
 *   inputs/<slug>-p<N>.json            collected analyzer input (real collector output)
 *   pages/<slug>-p<N>.canonical.json   real Rust analysis output
 *   render/<slug>-p<N>.analysis.png    the raster the Rust analyzer saw (120dpi)
 *   render/<slug>-p<N>.render.png      full-page render at CROP_RENDER_SCALE=2.0
 *   render/<slug>-p<N>.overlay.png     2.0x render + color-coded bbox overlay
 *   crops/<slug>-p<N>-b<I>.png         exact-math crop per ASSET-KIND block
 *   report.html, summary.json
 *
 * reportVersion 2 (summary.reportVersion) — semantics changes vs v1:
 *   - summary.blocks / rankings / headline counts cover ONLY asset kinds:
 *     figure, equation, table WITHOUT structure data (!block.table), and
 *     unknown-visual — mirroring the app's lazy-asset filter in
 *     src/components/viewer/PDFViewer.tsx (~line 1612). horizontal-rule and
 *     structured tables are OVERLAY-ONLY: drawn on the bbox overlay, but no
 *     crop file, no metrics, no ranking (rules are thin by design and never
 *     become app assets). v1 wrongly included horizontal-rule and excluded
 *     equation.
 *   - new block flags: `bbox-out-of-page` (any bbox edge beyond the scale-1
 *     page box by >1pt — the box the crop math divides by) and
 *     `rotation-basis-suspect` (out-of-page AND page rotation ≠ 0: the
 *     analyzer's bbox basis disagrees with pdfjs's rotated viewport, so the
 *     crop clamps to a partial image).
 *   - "Worst blocks" is ranked by metrics.severity (4 rotation-basis-suspect
 *     > 3 bbox-out-of-page > 2 sliver/degenerate flags > 1 |Δ|>10% > 0
 *     clean), then bbox area descending, then |aspect Δ| descending. New
 *     additive metrics fields: severity, outOfPageByPt, pageRotation. All
 *     pre-existing fields keep their meaning.
 *   - v3: crop/overlay geometry comes from the REAL cropGeometry.ts functions
 *     (rotation-aware — rotated-page crops/overlays are correct), and equation
 *     blocks are exempt from sliver/|aspect Δ| metrics (line-thin text-pipeline
 *     blocks; they still get crops and geometry-basis flags). Clean runs now
 *     expect ~0 flags on non-rotated pages.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkExpectations } from "./figure-expectations.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const esbuild = require("esbuild");
const { chromium } = require("playwright");

// ---------------------------------------------------------------------------
// Books (the user's actual books where the sliver bug was observed).
// ---------------------------------------------------------------------------

const DEFAULT_BOOKS = [
  {
    slug: "applied-evolutionary-psychology",
    path:
      "/Users/mini/Downloads/Applied Evolutionary Psychology (S. Craig Roberts) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  },
  {
    slug: "handbook-evolutionary-psych-vol1",
    // NOTE: the apostrophe in "Anna's" is U+2019 in the on-disk filename.
    path:
      "/Users/mini/Downloads/The Handbook of Evolutionary Psychology, Vol_ 1_ Foundation -- David M_ Buss (ed_) -- 1, 2nd, 2015 -- John Wiley & Sons, Incorporated -- isbn13 9781118755808 -- f043b013fc767f117bd5e7460d85dc28 -- Anna\u2019s Archive.pdf",
  },
];

// Kinds rendered on the page bbox overlay — everything visual the analyzer
// emits (superset of asset kinds, so the overlay still shows the full picture).
const VISUAL_KINDS = new Set(["figure", "equation", "table", "horizontal-rule", "unknown-visual"]);
const KIND_COLORS = {
  figure: "#d97706",
  equation: "#059669",
  table: "#3b82f6",
  "unknown-visual": "#a855f7",
  "horizontal-rule": "#6b7280",
};

/**
 * Asset kinds — mirrors the app's lazy-asset filter verbatim
 * (src/components/viewer/PDFViewer.tsx ~line 1612): the app builds crop
 * assets ONLY for figure / equation / table-without-structure-data /
 * unknown-visual. Only these blocks get crop files, metric flags, "worst"
 * rankings, and headline counts. horizontal-rule is thin BY DESIGN and never
 * becomes an app asset; tables carrying structure (`block.table`) render as
 * HTML tables in the app, not image crops.
 */
function isAssetKind(block) {
  return (
    block.kind === "figure" ||
    block.kind === "equation" ||
    (block.kind === "table" && !block.table) ||
    block.kind === "unknown-visual"
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { top: 12, out: path.join(REPO_ROOT, "debug", "gauntlet"), pages: new Map(), books: null, maxRank: Infinity, fixtures: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--top": opts.top = Number(argv[++i]); break;
      case "--out": opts.out = path.resolve(argv[++i]); break;
      case "--max-rank": opts.maxRank = Number(argv[++i]); break;
      case "--books": opts.books = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean)); break;
      case "--fixtures": opts.fixtures = true; break;
      case "--pages": {
        const spec = argv[++i];
        if (spec.includes(":")) {
          const idx = spec.lastIndexOf(":");
          opts.pages.set(spec.slice(0, idx), spec.slice(idx + 1));
        } else {
          opts.pages.set("*", spec);
        }
        break;
      }
      default:
        console.error(`unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Browser harness bundle (esbuild) — imports the REAL collector module.
// ---------------------------------------------------------------------------

/**
 * The browser-side harness entry. Nothing data-path is reimplemented here:
 * both the collector (`collectPageAnalysisInput`) and the crop geometry
 * (`computeCropSourceRect` / `cropPadFor` from src/lib/pdf/cropGeometry.ts)
 * are the REAL modules, bundled as-is by esbuild — the harness cannot drift
 * from the app. Only the pdf.js worker bootstrap and the PNG encodes are
 * harness-specific.
 */
function harnessEntrySource(repoRoot) {
  const collectorRel = path
    .relative(path.join(opts.out, "browser"), path.join(repoRoot, "src/components/viewer/pdfCanonicalCollector"))
    .split(path.sep)
    .join("/");
  const cropGeometryRel = path
    .relative(path.join(opts.out, "browser"), path.join(repoRoot, "src/lib/pdf/cropGeometry"))
    .split(path.sep)
    .join("/");
  return `
// Generated by scripts/diagnose-pdf-figures.mjs — do not edit.
// Bundled by esbuild with pdfjs-dist left external (resolved via import map).
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

// THE REAL COLLECTOR (src/components/viewer/pdfCanonicalCollector.ts).
// esbuild bundles this module as-is; nothing is reimplemented here.
import { collectPageAnalysisInput } from "${collectorRel}";

// THE REAL CROP MATH (src/lib/pdf/cropGeometry.ts) — the exact functions
// src/lib/pdf/reflowAssets.ts renderAndStoreRegionAsset calls. The harness
// never inlines crop/overlay geometry again, so it cannot drift from the app.
import { computeCropSourceRect, cropPadFor } from "${cropGeometryRel}";

// Worker setup mirrors src/components/viewer/PDFViewer.tsx. The app builds its
// own bootstrap Worker (src/workers/pdfjs.worker.ts) for old Tauri WebViews;
// on a plain same-origin http:// page the stock worker URL works, so we point
// workerSrc at the served pdfjs-dist worker (the polyfills in the app's
// bootstrap target old WebViews and are unnecessary in headless Chromium).
GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

const docs = new Map();

export async function openBook(slug, url) {
  const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  docs.set(slug, pdf);
  return pdf.numPages;
}

/** Cheap text-only pass over every page to rank figure-dense candidates. */
export async function rankPages(slug, maxPages) {
  const pdf = docs.get(slug);
  const out = [];
  const limit = Math.min(pdf.numPages, maxPages);
  for (let n = 1; n <= limit; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let textArea = 0, captionHits = 0, chars = 0, items = 0;
    for (const raw of content.items) {
      if (typeof raw.str !== "string") continue; // marked-content items
      items++;
      textArea += Math.max(0, raw.width) * Math.max(0, Math.abs(raw.height));
      chars += raw.str.length;
      if (/\\b(?:figure|table|fig\\.)[\\s.]?\\s*\\d/i.test(raw.str)) captionHits++;
    }
    const area = Math.max(1, vp.width * vp.height);
    out.push({
      pageNumber: n,
      width: vp.width,
      height: vp.height,
      coverage: Math.min(1, textArea / area),
      captionHits,
      chars,
      items,
    });
    page.cleanup();
  }
  return out;
}

/** Run the REAL collector for one page and return its JSON. */
export async function collect(slug, pageNumber) {
  return await collectPageAnalysisInput(docs.get(slug), pageNumber);
}

// reflowAssets.ts: const CROP_RENDER_SCALE = 2.0;
const CROP_RENDER_SCALE = 2.0;

/**
 * Render diagnostics for one page: full-page render at CROP_RENDER_SCALE,
 * bbox overlay, and per-block crops using the EXACT crop math from
 * src/lib/pdf/reflowAssets.ts renderAndStoreRegionAsset (only the
 * asset-store/Tauri upload is skipped).
 */
export async function renderDiag(slug, pageNumber, blocks) {
  const pdf = docs.get(slug);
  const page = await pdf.getPage(pageNumber);
  // reflowAssets.ts: base geometry is in the model rect's basis — UNROTATED
  // user space (rotation: 0), matching the analysis basis.
  const base = page.getViewport({ scale: 1, rotation: 0 });
  // reflowAssets.ts: const viewport = page.getViewport({ scale: CROP_RENDER_SCALE });
  // (applies the page's viewer rotation, like the analysis raster)
  const viewport = page.getViewport({ scale: CROP_RENDER_SCALE });
  const rotation = viewport.rotation ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const canvasContext = canvas.getContext("2d");
  canvasContext.fillStyle = "#ffffff";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext, viewport, canvas }).promise;

  // Overlay: same rotation-aware geometry as the crop (computeCropSourceRect
  // with pad 0 gives the device-space box), plus color-coded boxes.
  const overlay = document.createElement("canvas");
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const octx = overlay.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, overlay.width, overlay.height);
  octx.drawImage(canvas, 0, 0);
  octx.lineWidth = 2;
  octx.font = "bold 20px sans-serif";
  blocks.forEach((b, i) => {
    const { srcX: dx, srcY: dy, srcW: dw, srcH: dh } = computeCropSourceRect(
      b.bbox, base.width, base.height, rotation, canvas.width, canvas.height, 0,
    );
    const color = b.color || "#ef4444";
    octx.strokeStyle = color;
    octx.strokeRect(dx, dy, dw, dh);
    const label = \`#\${i} \${b.kind}\`;
    const tw = octx.measureText(label).width;
    const ly = dy > 26 ? dy - 6 : dy + dh + 24;
    octx.fillStyle = color;
    octx.fillRect(dx, ly - 20, tw + 10, 24);
    octx.fillStyle = "#ffffff";
    octx.fillText(label, dx + 5, ly - 2);
  });

  // Crops — the REAL reflowAssets.ts crop geometry via computeCropSourceRect /
  // cropPadFor (bundled from src/lib/pdf/cropGeometry.ts, rotation-aware).
  // Only blocks flagged asset:true (the app's asset-kind filter, mirrored by
  // the node driver) get crops; horizontal-rule / structured-table blocks
  // stay overlay-only, so their (expensive) PNG encode is skipped entirely.
  const crops = blocks.map((b) => {
    if (!b.asset) return null;
    const zero = computeCropSourceRect(
      b.bbox, base.width, base.height, rotation, canvas.width, canvas.height, 0,
    );
    const pad = cropPadFor(zero.srcW, zero.srcH);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      b.bbox, base.width, base.height, rotation, canvas.width, canvas.height, pad,
    );
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, srcW);
    crop.height = Math.max(1, srcH);
    const cropContext = crop.getContext("2d");
    cropContext.fillStyle = "#ffffff";
    cropContext.fillRect(0, 0, crop.width, crop.height);
    cropContext.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    return { dataUrl: crop.toDataURL("image/png"), w: crop.width, h: crop.height };
  });

  return {
    renderPng: canvas.toDataURL("image/png"),
    overlayPng: overlay.toDataURL("image/png"),
    base: { width: base.width, height: base.height },
    canvas: { width: canvas.width, height: canvas.height },
    crops,
  };
}
`;
}

const HARNESS_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>pdf reflow diag harness</title>
  <!-- Maps the esbuild-external "pdfjs-dist" specifier to the installed
       pdfjs-dist v5 ESM bundle served by the same local http server. -->
  <script type="importmap">
    { "imports": { "pdfjs-dist": "/pdfjs/pdf.mjs" } }
  </script>
</head>
<body>
  <script type="module">
    import * as diag from "/harness.mjs";
    window.__diag = diag;
    window.__diagReady = true;
  </script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Local http server: harness + pdfjs ESM + book PDFs.
// ---------------------------------------------------------------------------

function startServer(port, books, browserDir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, type, body) => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    try {
      if (url.pathname === "/harness.html") return send(200, "text/html", HARNESS_HTML);
      if (url.pathname === "/harness.mjs")
        return send(200, "text/javascript", readFileSync(path.join(browserDir, "harness.mjs")));
      if (url.pathname === "/pdfjs/pdf.mjs")
        return send(
          200,
          "text/javascript",
          readFileSync(path.join(REPO_ROOT, "node_modules", "pdfjs-dist", "build", "pdf.mjs")),
        );
      if (url.pathname === "/pdfjs/pdf.worker.min.mjs")
        return send(
          200,
          "text/javascript",
          readFileSync(path.join(REPO_ROOT, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")),
        );
      if (url.pathname.startsWith("/book/")) {
        const slug = decodeURIComponent(url.pathname.slice("/book/".length));
        const book = books.find((b) => b.slug === slug);
        if (!book) return send(404, "text/plain", `unknown book ${slug}`);
        return send(200, "application/pdf", readFileSync(book.path));
      }
      return send(404, "text/plain", `no route for ${url.pathname}`);
    } catch (error) {
      return send(500, "text/plain", String(error));
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Rust analysis runner (batched once — cargo startup is slow).
// ---------------------------------------------------------------------------

function runRustAnalyzer(inputDir, outputDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["run", "--bin", "pdf-reflow-diag", "--", "--input-dir", inputDir, "--output-dir", outputDir],
      { cwd: path.join(REPO_ROOT, "src-tauri"), stdio: "inherit" },
    );
    // Non-zero exit is tolerated: the runner isolates per-page panics and
    // writes <stem>.error.txt for failures; the report surfaces them (an
    // analyzer panic on a real page IS diagnostic data).
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function computeBlockMetrics(block, page) {
  const { x0, y0, x1, y1 } = block.bbox;
  const bboxW = x1 - x0;
  const bboxH = y1 - y0;
  const bboxAspect = bboxH > 0 ? bboxW / bboxH : Infinity;
  const { w: cropW, h: cropH } = block.cropDims;
  const cropAspect = cropH > 0 ? cropW / cropH : Infinity;
  // Under viewer rotation 90/270 the crop's width/height are the bbox's
  // height/width, so the EXPECTED crop aspect is the inverted bbox aspect —
  // comparing raw aspects on rotated pages flagged every rotated figure.
  const rot = Number.isFinite(page?.rotation) ? ((page.rotation % 360) + 360) % 360 : 0;
  const expectedCropAspect =
    rot === 90 || rot === 270 ? (bboxAspect !== 0 ? 1 / bboxAspect : Infinity) : bboxAspect;
  const aspectDeltaPct =
    Number.isFinite(expectedCropAspect) &&
    Number.isFinite(cropAspect) &&
    expectedCropAspect !== 0
      ? ((cropAspect - expectedCropAspect) / expectedCropAspect) * 100
      : Number.NaN;
  // Equations are line-thin TEXT-pipeline blocks (the crop's ~1px pad is a
  // large fraction of a thin baseline), so sliver/aspect flags on them are
  // false positives — like horizontal-rule they are non-assets for metrics.
  // They still get crop files (the app does build equation assets) and still
  // get the basis-independent geometry flags (out-of-page/degenerate).
  const metricsExempt = block.kind === "equation";
  const padDominates = Math.min(cropW, cropH) < 40; // pad is a large fraction of a tiny crop
  const flagged =
    !metricsExempt &&
    !padDominates &&
    Number.isFinite(aspectDeltaPct) &&
    Math.abs(aspectDeltaPct) > 10;
  const flags = [];
  if (!metricsExempt) {
    if (Math.min(bboxW, bboxH) < 15) flags.push("thin-bbox-pt");
    if (Math.min(bboxW, bboxH) < 0.15 * Math.max(bboxW, bboxH) && Math.min(bboxW, bboxH) < 40)
      flags.push("bbox-sliver");
    if (Math.min(cropW, cropH) < 40) flags.push("tiny-crop-px");
    if (Math.min(cropW, cropH) < 0.15 * Math.max(cropW, cropH) && Math.min(cropW, cropH) < 60)
      flags.push("crop-sliver");
  }
  if (bboxW <= 0 || bboxH <= 0) flags.push("degenerate-bbox");

  // Geometry that cannot be right in any basis: an edge outside the page box
  // the crop math divides by (pdfjs scale-1 viewport = rotated display box).
  // >1pt tolerance absorbs float noise; overshoot is how far out, in pt.
  const pageW = Number.isFinite(page?.pageWidth) ? page.pageWidth : Infinity;
  const pageH = Number.isFinite(page?.pageHeight) ? page.pageHeight : Infinity;
  const outOfPageByPt = Math.max(-x0, -y0, x1 - pageW, y1 - pageH, 0);
  const outOfPage = outOfPageByPt > 1;
  const pageRotation = Number.isFinite(page?.rotation) ? page.rotation : null;
  if (outOfPage) flags.push("bbox-out-of-page");
  if (outOfPage && pageRotation !== 0 && pageRotation !== null) flags.push("rotation-basis-suspect");

  // Ranking severity (higher = more certainly broken for figure fidelity):
  //   4 bbox-out-of-page on a rotated page (rotation-basis mismatch — the
  //     clamped partial-crop failure mode seen on rotation-90 pages)
  //   3 bbox-out-of-page on an unrotated page
  //   2 any sliver/degenerate flag (bbox-sliver, crop-sliver, thin-bbox-pt,
  //     tiny-crop-px, degenerate-bbox)
  //   1 |aspect Δ| > 10% with no geometric flag
  //   0 clean
  const severity = flags.includes("rotation-basis-suspect")
    ? 4
    : flags.includes("bbox-out-of-page")
      ? 3
      : flags.length > 0
        ? 2
        : flagged
          ? 1
          : 0;

  return {
    bboxW: round3(bboxW),
    bboxH: round3(bboxH),
    bboxAspect: round3(bboxAspect),
    bboxAreaPt2: round3(bboxW * bboxH),
    cropW,
    cropH,
    cropAspect: round3(cropAspect),
    aspectDeltaPct: round3(aspectDeltaPct),
    flagged,
    flags,
    severity,
    outOfPageByPt: round3(outOfPageByPt),
    pageRotation,
  };
}

const round3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Worst-first comparator for figure fidelity: severity desc, then bbox area
// desc (big blocks matter more), then |aspect Δ| desc. Raw |Δ| stays visible
// as a column — it is a symptom, not the diagnosis.
function bySeverity(a, b) {
  const sa = a.metrics.severity ?? 0;
  const sb = b.metrics.severity ?? 0;
  if (sa !== sb) return sb - sa;
  const areaA = Number.isFinite(a.metrics.bboxAreaPt2) ? a.metrics.bboxAreaPt2 : 0;
  const areaB = Number.isFinite(b.metrics.bboxAreaPt2) ? b.metrics.bboxAreaPt2 : 0;
  if (areaA !== areaB) return areaB - areaA;
  return Math.abs(b.metrics.aspectDeltaPct ?? 0) - Math.abs(a.metrics.aspectDeltaPct ?? 0);
}

const SLIVER_FLAG_NAMES = new Set(["bbox-sliver", "crop-sliver", "thin-bbox-pt", "tiny-crop-px", "degenerate-bbox"]);

function buildReport(summary) {
  const worst = [...summary.blocks].sort(bySeverity);
  const failedPages = summary.pages.filter((p) => p.analysisFailed);
  const outOfPageBlocks = summary.blocks.filter((b) => b.metrics.flags.includes("bbox-out-of-page"));
  const rotationSuspectBlocks = summary.blocks.filter((b) =>
    b.metrics.flags.includes("rotation-basis-suspect"),
  );
  const sliverBlocks = summary.blocks.filter((b) =>
    b.metrics.flags.some((f) => SLIVER_FLAG_NAMES.has(f)),
  );
  const sliverFigures = sliverBlocks.filter((b) => b.kind === "figure");
  const flagCount = summary.blocks.filter((b) => b.metrics.flagged).length;
  const kindCounts = {};
  for (const b of summary.blocks) kindCounts[b.kind] = (kindCounts[b.kind] ?? 0) + 1;
  const rotatedPages = summary.pages.filter((p) => (p.rotation ?? 0) !== 0);

  const worstRows = worst
    .map((b, rank) => {
      const m = b.metrics;
      const cls = (m.severity ?? 0) >= 3 ? "bad" : m.flagged ? "warnrow" : "";
      return `<tr class="${cls}">
        <td>${rank + 1}</td>
        <td><a href="#page-${b.slug}-${b.pageNumber}">${esc(b.slug)} p${b.pageNumber}</a></td>
        <td>${esc(b.kind)}</td>
        <td>${m.bboxW} × ${m.bboxH} pt</td>
        <td>${m.bboxAreaPt2} pt²</td>
        <td>${m.cropW} × ${m.cropH} px</td>
        <td>${fmtPct(m.aspectDeltaPct)}</td>
        <td>${m.severity ?? 0}</td>
        <td>${esc(m.flags.join(", ")) || "—"}</td>
      </tr>`;
    })
    .join("\n");

  const pageSections = summary.pages
    .map((p) => {
      const id = `page-${p.slug}-${p.pageNumber}`;
      const blockRows = p.blocks
        .map((b) => {
          const m = b.metrics;
          const color = KIND_COLORS[b.kind] ?? "#ef4444";
          return `<tr class="${m.flagged ? "bad" : ""}">
            <td><a href="${b.cropPath}"><img class="crop" src="${b.cropPath}" style="border-color:${color}" alt="crop"/></a></td>
            <td><span class="kind" style="background:${color}">${b.blockIndex}</span> ${esc(b.kind)}<br/>
                <span class="dim">${esc(b.blockId)} conf ${b.confidence ?? "?"}</span></td>
            <td>x0=${b.bbox.x0}<br/>y0=${b.bbox.y0}<br/>x1=${b.bbox.x1}<br/>y1=${b.bbox.y1}</td>
            <td>${m.bboxW} × ${m.bboxH}<br/>aspect ${m.bboxAspect}<br/>area ${m.bboxAreaPt2} pt²</td>
            <td>${m.cropW} × ${m.cropH}<br/>aspect ${m.cropAspect}</td>
            <td class="${m.flagged ? "bad" : ""}">${fmtPct(m.aspectDeltaPct)}${m.flagged ? " ⚠" : ""}</td>
            <td>${esc(m.flags.join(", ")) || "—"}</td>
            <td class="alt">${esc(b.altText ?? "")}</td>
          </tr>`;
        })
        .join("\n");
      return `<section id="${id}">
        <h2>${esc(p.slug)} — page ${p.pageNumber}${p.analysisFailed ? ' <span style="color:#b91c1c">ANALYZER FAILED</span>' : ""}</h2>
        ${p.analysisFailed ? `<p class="meta" style="color:#b91c1c"><b>analyze_page error:</b> ${esc(p.analysisFailed)}</p>` : ""}
        <p class="meta">
          ${p.pageWidth} × ${p.pageHeight} pt ·
          ${(p.rotation ?? 0) !== 0
            ? `<b style="color:#b91c1c">rotation ${p.rotation} ⚠ rotated page — check bbox basis</b>`
            : `rotation ${p.rotation ?? 0}`} ·
          classification <b>${esc(p.classification)}</b> · confidence ${p.confidence ?? "n/a"} ·
          text coverage ${p.textCoverage ?? "n/a"} ·
          blocks: ${p.totalBlocks} total / ${p.visualBlockCount ?? p.blocks.length} visual (overlay) / ${p.blocks.length} asset-kind ·
          warnings: <span class="warn">${esc(p.warnings.join(", ") || "none")}</span>
        </p>
        <div class="imgs">
          <figure><figcaption>analysis raster (collector input, ~120dpi)</figcaption><a href="${p.analysisPng}"><img src="${p.analysisPng}" alt="analysis render"/></a></figure>
          <figure><figcaption>render @ CROP_RENDER_SCALE 2.0</figcaption><a href="${p.renderPng}"><img src="${p.renderPng}" alt="2x render"/></a></figure>
          <figure><figcaption>bbox overlay (figure orange, equation green, table blue, unknown purple, rule gray — rules/structured tables are overlay-only, not app assets)</figcaption><a href="${p.overlayPng}"><img src="${p.overlayPng}" alt="overlay"/></a></figure>
        </div>
        ${p.blocks.length
          ? `<table class="blocks">
              <thead><tr><th>crop (exact reflowAssets math)</th><th>block</th><th>bbox (pt, bottom-up)</th><th>bbox size</th><th>crop px</th><th>aspect Δ</th><th>flags</th><th>caption/alt</th></tr></thead>
              <tbody>${blockRows}</tbody>
            </table>`
          : `<p class="warn">${p.analysisFailed ? "no blocks — the analyzer panicked on this page (see error above; renders below show the page it choked on)" : "no visual blocks detected on this page"}</p>`}
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>PDF reflow figure diagnostics</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 24px auto; max-width: 1400px; padding: 0 16px; color: #111827; }
  h1 { font-size: 22px; }
  h2 { font-size: 17px; margin-top: 40px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; }
  th, td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; vertical-align: top; }
  thead th { background: #f9fafb; position: sticky; top: 0; }
  tr.bad { background: #fef2f2; }
  tr.bad td { color: #b91c1c; }
  tr.warnrow { background: #fffbeb; }
  .imgs { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .imgs figure { margin: 0; flex: 1 1 300px; min-width: 260px; max-width: 33%; }
  .imgs figcaption { font-size: 11px; color: #6b7280; margin-bottom: 4px; font-family: ui-monospace, monospace; }
  .imgs img { width: 100%; height: auto; border: 1px solid #d1d5db; display: block; }
  img.crop { max-width: 360px; max-height: 220px; border: 2px solid; display: block; background:
    repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 16px 16px; }
  .meta { font-size: 12px; font-family: ui-monospace, monospace; color: #374151; }
  .warn { color: #b45309; }
  .kind { color: #fff; border-radius: 3px; padding: 0 4px; font-weight: 600; }
  .dim { color: #9ca3af; }
  .alt { max-width: 260px; white-space: pre-wrap; }
  .summary-top { margin-bottom: 8px; font-size: 13px; }
  #worst { width: 100%; }
  #worst td:nth-child(7) { font-weight: 600; }
  .blocks td:nth-child(6) { font-weight: 600; }
</style></head>
<body>
<h1>PDF reflow figure-geometry diagnostics</h1>
<p class="summary-top">
  ${summary.books.map((b) => `${esc(b.slug)}: ${b.numPages} pages, sampled ${b.selectedPages.length} (${b.selectedPages.join(", ")})`).join(" · ")} ·
  rotated pages in sample: <b>${rotatedPages.map((p) => `${esc(p.slug)} p${p.pageNumber} (rot ${p.rotation})`).join(", ") || "none"}</b><br/>
  <b style="color:#b91c1c">analyzer panics: ${failedPages.length}${failedPages.length ? ` (${failedPages.map((p) => `${esc(p.slug)} p${p.pageNumber}`).join(", ")})` : ""}</b> ·
  <b style="color:#b91c1c">bbox-out-of-page: ${outOfPageBlocks.length}</b>
  (rotation-basis-suspect: <b>${rotationSuspectBlocks.length}</b>) ·
  <b class="warn">asset blocks with sliver flags: ${sliverBlocks.length} (figure kind: ${sliverFigures.length})</b><br/>
  asset-kind blocks: <b>${summary.blocks.length}</b> (${Object.entries(kindCounts).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}) ·
  |aspect Δ| &gt; 10%: <b class="warn">${flagCount}</b> ·
  generated ${esc(summary.generatedAt)} · reportVersion ${summary.reportVersion}
</p>
<h2>Worst blocks (severity: rotation-basis-suspect &gt; out-of-page &gt; sliver &gt; |Δ|&gt;10% · then bbox area ↓ · then |Δ| ↓)</h2>
<table id="worst">
  <thead><tr><th>#</th><th>page</th><th>kind</th><th>bbox (pt)</th><th>bbox area</th><th>crop (px)</th><th>aspect Δ</th><th>sev</th><th>flags</th></tr></thead>
  <tbody>${worstRows}</tbody>
</table>
${pageSections}
</body></html>`;
}

const fmtPct = (n) => (Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "n/a");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));

/**
 * Fixtures mode book list: every PDF in the synthetic figure corpus
 * (src-tauri/tests/fixtures/pdf-reflow/figures/). Fails loudly when the
 * corpus has not been generated.
 */
function figureFixtureBooks() {
  const dir = path.join(REPO_ROOT, "src-tauri", "tests", "fixtures", "pdf-reflow", "figures");
  if (!existsSync(dir)) {
    console.error(`[fixtures] figure fixture corpus missing: ${dir}`);
    console.error("[fixtures] generate it first: node scripts/generate-pdf-reflow-fixtures.mjs");
    process.exit(2);
  }
  const books = readdirSync(dir)
    .filter((name) => name.endsWith(".pdf"))
    .sort()
    .map((name) => ({ slug: name.replace(/\.pdf$/, ""), path: path.join(dir, name) }));
  if (books.length === 0) {
    console.error(`[fixtures] no PDFs in ${dir} — regenerate the corpus`);
    process.exit(2);
  }
  return books;
}

const books = opts.fixtures ? figureFixtureBooks() : DEFAULT_BOOKS.filter((b) => !opts.books || opts.books.has(b.slug));
if (books.length === 0) {
  console.error(`no books selected from ${[...opts.books].join(", ")}`);
  process.exit(2);
}
for (const b of books) {
  if (!existsSync(b.path)) {
    console.error(`book PDF not found: ${b.path}`);
    process.exit(2);
  }
}

// Expectations gate (fixtures mode): the expectations file MUST exist —
// never silently skip the check.
const expectationsPath = path.join(REPO_ROOT, "scripts", "pdf-reflow-figure-expectations.json");
let expectations = null;
if (opts.fixtures) {
  if (!existsSync(expectationsPath)) {
    console.error(`[fixtures] expectations file missing: ${expectationsPath}`);
    process.exit(2);
  }
  expectations = JSON.parse(readFileSync(expectationsPath, "utf8"));
}

const outDir = opts.out;
const browserDir = path.join(outDir, "browser");
const inputsDir = path.join(outDir, "inputs");
const pagesDir = path.join(outDir, "pages");
const renderDir = path.join(outDir, "render");
const cropsDir = path.join(outDir, "crops");
for (const dir of [browserDir, inputsDir, pagesDir, renderDir, cropsDir]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// 1. Bundle the real collector for the browser.
writeFileSync(path.join(browserDir, "harness-entry.mjs"), harnessEntrySource(REPO_ROOT));
await esbuild.build({
  entryPoints: [path.join(browserDir, "harness-entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["pdfjs-dist"],
  outfile: path.join(browserDir, "harness.mjs"),
  logLevel: "warning",
});
console.log(`[diag] bundled real collector -> ${path.join(browserDir, "harness.mjs")}`);

// 2. Serve harness + pdfjs + books; launch headless Chromium.
const server = await startServer(0, books, browserDir);
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(180000);
await page.goto(`${origin}/harness.html`);
await page.waitForFunction("window.__diagReady === true");
console.log(`[diag] harness page loaded (${origin})`);

const run = (fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg)})`);

const summary = {
  reportVersion: 3,
  generatedAt: new Date().toISOString(),
  outDir,
  books: [],
  pages: [],
  blocks: [],
};

/** Fixtures mode: analyzer results per fixture slug (expectations gate). */
const fixtureResults = {};

try {
  // 3. Per book: rank + collect with the REAL collector.
  for (const book of books) {
    const explicitRaw =
      opts.pages.get(book.slug) ??
      (opts.pages.has("*") ? opts.pages.get("*") : null);
    const t0 = Date.now();
    const numPages = await run((a) => window.__diag.openBook(a.slug, a.url), {
      slug: book.slug,
      url: `${origin}/book/${encodeURIComponent(book.slug)}`,
    });
    console.log(`[diag] ${book.slug}: opened, ${numPages} pages`);

    let selected;
    let rankingSample = null;
    if (opts.fixtures) {
      // Every page of every fixture (single-page corpus today).
      selected = Array.from({ length: numPages }, (_, i) => i + 1);
      console.log(`[diag] ${book.slug}: fixtures mode -> all ${numPages} page(s)`);
    } else if (explicitRaw) {
      selected = [...new Set(explicitRaw.split(",").map((s) => Number(s.trim())).filter(Number.isInteger))]
        .filter((n) => n >= 1 && n <= numPages)
        .sort((a, b) => a - b);
      console.log(`[diag] ${book.slug}: explicit pages -> [${selected.join(", ")}]`);
    } else {
      const ranked = await run((a) => window.__diag.rankPages(a.slug, a.maxRank), {
        slug: book.slug,
        maxRank: Number.isFinite(opts.maxRank) ? opts.maxRank : numPages,
      });
      console.log(`[diag] ${book.slug}: ranked ${ranked.length} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      const scored = ranked
        .filter((p) => p.items > 0 || p.coverage > 0)
        .map((p) => {
          // Figure-dense pages: many figure/table captions, sparse text
          // coverage, or full-page visuals with minimal text.
          const captionScore = Math.min(6, p.captionHits) * 2;
          const sparseScore = p.items > 0 ? Math.max(0, 0.22 - p.coverage) * 12 : 3;
          const score = round3(captionScore + sparseScore);
          return { ...p, score };
        })
        .sort((a, b) => b.score - a.score);
      rankingSample = scored.slice(0, 30);
      selected = scored.slice(0, opts.top).map((p) => p.pageNumber).sort((a, b) => a - b);
      console.log(
        `[diag] ${book.slug}: top ${opts.top} -> [${selected.join(", ")}] (scores ${scored
          .slice(0, opts.top)
          .map((p) => `${p.pageNumber}:${p.score}`)
          .join(" ")})`,
      );
    }

    for (const n of selected) {
      const input = await run((a) => window.__diag.collect(a.slug, a.pageNumber), {
        slug: book.slug,
        pageNumber: n,
      });
      if (!input || typeof input.pageNumber !== "number") throw new Error(`collect failed for ${book.slug} p${n}`);
      writeFileSync(path.join(inputsDir, `${book.slug}-p${n}.json`), JSON.stringify(input));
      console.log(
        `[diag]   collected p${n} (${input.pageWidth.toFixed(0)}×${input.pageHeight.toFixed(0)}pt, raster ${input.rasterPngBase64 ? `${(input.rasterPngBase64.length / 1024).toFixed(0)}KiB b64` : "none"}, ${input.textItems.length} text items)`,
      );
    }
    summary.books.push({ slug: book.slug, path: book.path, numPages, selectedPages: selected, rankingSample });
  }

  // 4. Run the REAL Rust analyzer over everything (one cargo invocation).
  console.log(`[diag] running cargo pdf-reflow-diag over ${inputsDir} ...`);
  await runRustAnalyzer(inputsDir, pagesDir);

  // 5. Diagnostics rendering + metrics per page.
  for (const book of summary.books) {
    for (const n of book.selectedPages) {
      const stem = `${book.slug}-p${n}`;
      const input = JSON.parse(readFileSync(path.join(inputsDir, `${stem}.json`), "utf8"));
      const canonicalPath = path.join(pagesDir, `${stem}.canonical.json`);
      const analysisFailed = !existsSync(canonicalPath)
        ? existsSync(path.join(pagesDir, `${stem}.error.txt`))
          ? readFileSync(path.join(pagesDir, `${stem}.error.txt`), "utf8").trim()
          : "no canonical output produced"
        : null;
      if (analysisFailed) {
        console.warn(`[diag] ${stem}: ANALYZER FAILED -> ${analysisFailed}`);
      }
      const canonical = analysisFailed
        ? { blocks: [], rotation: input.rotation, warnings: [`analyzer-failed: ${analysisFailed}`], classification: "failed", confidence: null, textCoverage: null }
        : JSON.parse(readFileSync(canonicalPath, "utf8"));
      const visualBlocks = canonical.blocks.filter((b) => VISUAL_KINDS.has(b.kind) && b.sourceRegions?.[0]);

      // The analysis-scale raster the Rust analyzer actually saw.
      const analysisPng = `render/${stem}.analysis.png`;
      if (input.rasterPngBase64) {
        writeFileSync(
          path.join(outDir, analysisPng),
          Buffer.from(input.rasterPngBase64, "base64"),
        );
      }

      const diag = await run(
        (a) => window.__diag.renderDiag(a.slug, a.pageNumber, a.blocks),
        {
          slug: book.slug,
          pageNumber: n,
          blocks: visualBlocks.map((b) => ({
            kind: b.kind,
            bbox: b.sourceRegions[0].bbox,
            color: KIND_COLORS[b.kind],
            asset: isAssetKind(b),
          })),
        },
      );

      const renderPng = `render/${stem}.render.png`;
      const overlayPng = `render/${stem}.overlay.png`;
      writeFileSync(path.join(outDir, renderPng), Buffer.from(diag.renderPng.split(",")[1], "base64"));
      writeFileSync(path.join(outDir, overlayPng), Buffer.from(diag.overlayPng.split(",")[1], "base64"));

      const pageEntry = {
        slug: book.slug,
        pageNumber: n,
        pageWidth: input.pageWidth,
        pageHeight: input.pageHeight,
        rotation: canonical.rotation,
        classification: canonical.classification,
        confidence: canonical.confidence,
        textCoverage: canonical.textCoverage,
        analysisFailed,
        warnings: canonical.warnings ?? [],
        totalBlocks: canonical.blocks.length,
        analysisPng: input.rasterPngBase64 ? analysisPng : null,
        renderPng,
        overlayPng,
        visualBlockCount: visualBlocks.length,
        blocks: [],
      };

      const fixtureBlocks = [];
      visualBlocks.forEach((b, i) => {
        // Overlay-only kinds (horizontal-rule, structured tables) get no crop
        // file and no metrics/ranking entry — they never become app assets.
        if (!diag.crops[i]) return;
        const cropRel = `crops/${stem}-b${i}.png`;
        writeFileSync(path.join(outDir, cropRel), Buffer.from(diag.crops[i].dataUrl.split(",")[1], "base64"));
        fixtureBlocks.push({
          kind: b.kind,
          bbox: b.sourceRegions[0].bbox,
          crop: { w: diag.crops[i].w, h: diag.crops[i].h },
        });
        const entry = {
          book: book.slug,
          slug: book.slug,
          pageNumber: n,
          blockIndex: i,
          blockId: b.id,
          kind: b.kind,
          bbox: b.sourceRegions[0].bbox,
          altText: b.altText ?? null,
          confidence: b.confidence,
          cropPath: cropRel,
          cropDims: { w: diag.crops[i].w, h: diag.crops[i].h },
          pageWarnings: canonical.warnings ?? [],
        };
        entry.metrics = computeBlockMetrics(entry, pageEntry);
        pageEntry.blocks.push(entry);
        summary.blocks.push(entry);
      });

      summary.pages.push(pageEntry);
      if (opts.fixtures) {
        fixtureResults[book.slug] = {
          slug: book.slug,
          pageWidth: input.pageWidth,
          pageHeight: input.pageHeight,
          rotation: canonical.rotation,
          analysisFailed,
          warnings: canonical.warnings ?? [],
          blocks: fixtureBlocks,
        };
      }
      console.log(
        `[diag] ${stem}: ${visualBlocks.length} visual block(s), warnings [${(canonical.warnings ?? []).join(", ") || "none"}]`,
      );
    }
  }
} finally {
  // 6. Write report + summary, then tear down.
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(outDir, "report.html"), buildReport(summary));
  await browser.close();
  server.close();
}

const failedPages = summary.pages.filter((p) => p.analysisFailed);
const outOfPageBlocks = summary.blocks.filter((b) => b.metrics.flags.includes("bbox-out-of-page"));
const rotationSuspectBlocks = summary.blocks.filter((b) =>
  b.metrics.flags.includes("rotation-basis-suspect"),
);
const sliverBlocks = summary.blocks.filter((b) =>
  b.metrics.flags.some((f) => SLIVER_FLAG_NAMES.has(f)),
);
const flagged = summary.blocks.filter((b) => b.metrics.flagged);
console.log("");
console.log(
  `[diag] DONE (reportVersion ${summary.reportVersion}): ${summary.pages.length} pages (${failedPages.length} analyzer panics), ${summary.blocks.length} asset-kind blocks, ${outOfPageBlocks.length} bbox-out-of-page (${rotationSuspectBlocks.length} rotation-basis-suspect), ${sliverBlocks.length} with sliver flags, ${flagged.length} with |aspect delta| > 10%`,
);
const worst = [...summary.blocks].sort(bySeverity).slice(0, 10);
for (const b of worst) {
  const m = b.metrics;
  console.log(
    `  worst: ${b.slug} p${b.pageNumber} #${b.blockIndex} ${b.kind} bbox=(${b.bbox.x0},${b.bbox.y0},${b.bbox.x1},${b.bbox.y1}) ${m.bboxW}x${m.bboxH}pt area=${m.bboxAreaPt2}pt2 crop=${m.cropW}x${m.cropH}px delta=${fmtPct(m.aspectDeltaPct)} sev=${m.severity} flags=[${m.flags.join(",")}]`,
  );
}
console.log(`[diag] report: ${path.join(outDir, "report.html")}`);
console.log(`[diag] summary: ${path.join(outDir, "summary.json")}`);

// Fixtures mode gate: assert the REAL pipeline output against the known
// drawn coordinates in scripts/pdf-reflow-figure-expectations.json.
if (opts.fixtures) {
  const { ok, failures, checked } = checkExpectations(fixtureResults, expectations);
  console.log("");
  console.log(`[fixtures] ${checked} fixture expectation(s) checked`);
  if (!ok) {
    for (const { fixture, reasons } of failures) {
      console.error(`[fixtures] FAIL ${fixture}:`);
      for (const reason of reasons) console.error(`[fixtures]   - ${reason}`);
    }
    console.error("[fixtures] FIGURE EXPECTATIONS GATE FAILED");
    process.exit(1);
  }
  console.log("[fixtures] FIGURE EXPECTATIONS GATE PASSED");
}
