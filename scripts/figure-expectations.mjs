/**
 * Pure expectations checker for the synthetic figure-fixture corpus
 * (gauntlet Piece D). Imported by `scripts/diagnose-pdf-figures.mjs
 * --fixtures` (end-to-end gate) and unit-tested in
 * `scripts/__tests__/figureExpectations.test.mjs` — no I/O here.
 *
 * Model:
 *   result  — per-fixture analyzer output shape:
 *     { slug, pageWidth, pageHeight, rotation, analysisFailed,
 *       warnings?: string[], blocks: [{ kind, bbox: {x0,y0,x1,y1},
 *       crop: {w,h} | null }] }
 *   fixture expectation:
 *     { figureCount?: number, rotation?: number, warningsInclude?: string[],
 *       regions: [{ kind?: "figure" (default), bbox: [x0,y0,x1,y1],
 *                   minCoverage?: number (default 0.85),
 *                   checkCropAspect?: boolean (default true) }] }
 *
 * `checkCropAspect: false` documents a region whose crop aspect is not
 * asserted against the drawn aspect on purpose: adjacent same-band figures
 * the analyzer legitimately merges into ONE crop (the merged crop covers the
 * band, so its aspect is the band-plus-gap aspect, not either figure's), and
 * extreme slivers (>=8:1) whose aspect is hypersensitive to ±2pt of caption
 * bleed (a 19.5:1 banner's aspect moves ~45% when the bbox swallows one
 * caption line). Position and coverage stay pinned either way.
 *
 * Region matching (against the KNOWN drawn coordinates):
 *   - a detected block of the expected kind must cover ≥ minCoverage of the
 *     drawn region (intersection area / region area);
 *   - the detected bbox must stay within the region grown by
 *     `tolerance * max(pageWidth, pageHeight)` (default tolerance 0.10) —
 *     i.e. the bbox approximates the drawn region ±10%, not something else;
 *   - if the block has a crop, its aspect must match the region's expected
 *     crop aspect (inverted for viewer rotation 90/270) within
 *     `aspectTolerance` (default 0.12) — the crop-completeness check.
 */

export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_MIN_COVERAGE = 0.85;
export const DEFAULT_ASPECT_TOLERANCE = 0.12;

function rectArea(r) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

function intersectionArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return Math.max(0, w) * Math.max(0, h);
}

function regionToRect(region) {
  const [x0, y0, x1, y1] = region;
  return { x0, y0, x1, y1 };
}

function grown(rect, by) {
  return { x0: rect.x0 - by, y0: rect.y0 - by, x1: rect.x1 + by, y1: rect.y1 + by };
}

function contains(outer, inner) {
  return (
    inner.x0 >= outer.x0 - 1e-9 &&
    inner.y0 >= outer.y0 - 1e-9 &&
    inner.x1 <= outer.x1 + 1e-9 &&
    inner.y1 <= outer.y1 + 1e-9
  );
}

function expectedCropAspect(regionRect, rotation) {
  const w = regionRect.x1 - regionRect.x0;
  const h = regionRect.y1 - regionRect.y0;
  const rot = ((Number.isFinite(rotation) ? rotation : 0) % 360 + 360) % 360;
  const regionAspect = h > 0 ? w / h : Number.POSITIVE_INFINITY;
  return rot === 90 || rot === 270 ? 1 / regionAspect : regionAspect;
}

/**
 * Check one fixture result against its expectation.
 * Returns { ok, failures: string[] } — failures are human-readable reasons.
 */
export function checkFixture(result, expectation, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const minCoverageDefault = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const aspectTolerance = options.aspectTolerance ?? DEFAULT_ASPECT_TOLERANCE;
  const failures = [];

  if (!result || typeof result !== "object") {
    return { ok: false, failures: ["missing analyzer result"] };
  }
  if (result.analysisFailed) {
    failures.push(`analyzer failed: ${result.analysisFailed}`);
    return { ok: false, failures };
  }
  if (expectation.rotation !== undefined && result.rotation !== expectation.rotation) {
    failures.push(`rotation ${result.rotation} ≠ expected ${expectation.rotation}`);
  }
  for (const want of expectation.warningsInclude ?? []) {
    if (!(result.warnings ?? []).includes(want)) {
      failures.push(
        `missing warning ${want} (warnings: ${(result.warnings ?? []).join(", ") || "none"})`,
      );
    }
  }
  const blocks = result.blocks ?? [];
  if (expectation.figureCount !== undefined) {
    const figures = blocks.filter((b) => b.kind === "figure");
    if (figures.length !== expectation.figureCount) {
      failures.push(
        `figure count ${figures.length} ≠ expected ${expectation.figureCount} ` +
          `(kinds seen: ${blocks.map((b) => b.kind).join(", ") || "none"})`,
      );
    }
  }
  const pageSpan = Math.max(result.pageWidth ?? 0, result.pageHeight ?? 0);
  for (const [index, region] of (expectation.regions ?? []).entries()) {
    const wantKind = region.kind ?? "figure";
    const regionRect = regionToRect(region.bbox);
    const minCoverage = region.minCoverage ?? minCoverageDefault;
    const candidates = blocks.filter((b) => b.kind === wantKind);
    let matched = false;
    const reasons = [];
    for (const block of candidates) {
      const coverage = intersectionArea(block.bbox, regionRect) / rectArea(regionRect);
      if (coverage < minCoverage) {
        reasons.push(
          `candidate bbox=(${block.bbox.x0},${block.bbox.y0},${block.bbox.x1},${block.bbox.y1}) covers ${(coverage * 100).toFixed(0)}% < ${minCoverage * 100}%`,
        );
        continue;
      }
      if (!contains(grown(regionRect, tolerance * pageSpan), block.bbox)) {
        reasons.push(
          `candidate bbox=(${block.bbox.x0},${block.bbox.y0},${block.bbox.x1},${block.bbox.y1}) escapes the region grown by ${(tolerance * 100).toFixed(0)}% of the page span`,
        );
        continue;
      }
      if (block.crop && (region.checkCropAspect ?? true)) {
        const cropAspect = block.crop.h > 0 ? block.crop.w / block.crop.h : Number.POSITIVE_INFINITY;
        const want = expectedCropAspect(regionRect, result.rotation);
        const delta = Math.abs(cropAspect / want - 1);
        if (delta > aspectTolerance) {
          reasons.push(
            `crop aspect ${cropAspect.toFixed(2)} deviates ${(delta * 100).toFixed(0)}% from expected ${want.toFixed(2)} (rotation ${result.rotation ?? 0})`,
          );
          continue;
        }
      }
      matched = true;
      break;
    }
    if (!matched) {
      failures.push(
        `region #${index} [${region.bbox.join(",")}] (${wantKind}): no matching block — ` +
          (candidates.length === 0 ? "no blocks of that kind" : reasons.join("; ")),
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Check a whole run: results keyed by fixture slug against the expectations
 * file's `fixtures` map. Returns { ok, failures: [{fixture, reasons}],
 * checked } — missing fixtures (no result) and missing expectations are both
 * failures so the gate cannot silently skip files.
 */
export function checkExpectations(results, expectations, options = {}) {
  const failures = [];
  const expectedSlugs = Object.keys(expectations?.fixtures ?? {});
  const resultSlugs = Object.keys(results ?? {});
  for (const slug of expectedSlugs) {
    const result = results?.[slug];
    if (!result) {
      failures.push({ fixture: slug, reasons: ["expected fixture produced no analyzer result"] });
      continue;
    }
    const { ok, failures: reasons } = checkFixture(result, expectations.fixtures[slug], options);
    if (!ok) failures.push({ fixture: slug, reasons });
  }
  for (const slug of resultSlugs) {
    if (!expectedSlugs.includes(slug)) {
      failures.push({ fixture: slug, reasons: ["analyzer result has no expectation entry"] });
    }
  }
  return { ok: failures.length === 0, failures, checked: expectedSlugs.length };
}
