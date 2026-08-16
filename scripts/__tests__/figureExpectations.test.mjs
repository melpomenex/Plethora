import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFixture,
  checkExpectations,
  DEFAULT_TOLERANCE,
  DEFAULT_MIN_COVERAGE,
  DEFAULT_ASPECT_TOLERANCE,
} from "../figure-expectations.mjs";

/**
 * Pure unit tests for the figure-expectations checker (gauntlet Piece D).
 * No I/O here — the expectations FILE's existence/loud-missing behavior is the
 * orchestrator's job (scripts/diagnose-pdf-figures.mjs --fixtures exits 2 when
 * the file is absent); these tests pin the checker's matching semantics
 * against synthetic analyzer-result shapes mirroring each fixture shape.
 */

const LETTER = { pageWidth: 612, pageHeight: 792 };

/** Analyzer-result shape produced by the --fixtures orchestrator. */
function result(overrides = {}) {
  return {
    slug: "synthetic",
    ...LETTER,
    rotation: 0,
    analysisFailed: null,
    blocks: [],
    ...overrides,
  };
}

function figureBlock(bbox, crop = null) {
  return {
    kind: "figure",
    bbox: { x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] },
    crop,
  };
}

/** Crop dims whose aspect matches w/h of the given region within tolerance. */
function cropFor(region, rotation = 0, skew = 1) {
  const w = region[2] - region[0];
  const h = region[3] - region[1];
  const aspect = h > 0 ? w / h : 1;
  const expected = rotation === 90 || rotation === 270 ? 1 / aspect : aspect;
  const cropAspect = expected * skew;
  // Scale to plausible pixel sizes while preserving the aspect exactly.
  const scale = 2;
  return { w: Math.round(400 * cropAspect * scale), h: Math.round(400 * scale) };
}

const REGION = [100, 400, 340, 580]; // fig01 shape: 240x180 drawn image rect

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("exact detection passes: coverage, tolerance, crop aspect, counts, warnings", () => {
  const expectation = {
    rotation: 0,
    figureCount: 1,
    warningsInclude: ["figure-ink-uncovered"],
    regions: [{ bbox: REGION }],
  };
  const res = result({
    blocks: [figureBlock(REGION, cropFor(REGION))],
    warnings: ["figure-ink-uncovered", "another-warning"],
  });
  const { ok, failures } = checkFixture(res, expectation);
  assert.equal(ok, true, failures.join("; "));
});

test("near-miss bbox within the 10%-of-page-span tolerance still passes", () => {
  // Detected box 4pt outside the region on every edge (raster granularity +
  // caption bleed): inside region ± 0.10 * max(612, 792) = 79.2pt.
  const grown = [REGION[0] - 4, REGION[1] - 4, REGION[2] + 4, REGION[3] + 4];
  const res = result({ blocks: [figureBlock(grown, cropFor(REGION, 0, 1.05))] });
  const { ok, failures } = checkFixture(res, { regions: [{ bbox: REGION }] });
  assert.equal(ok, true, failures.join("; "));
});

test("crop dims skewed within the 12% aspect tolerance pass, beyond it fail", () => {
  const within = result({ blocks: [figureBlock(REGION, cropFor(REGION, 0, 1.11))] });
  assert.equal(checkFixture(within, { regions: [{ bbox: REGION }] }).ok, true);
  const beyond = result({ blocks: [figureBlock(REGION, cropFor(REGION, 0, 1.13))] });
  const { ok, failures } = checkFixture(beyond, { regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /crop aspect/);
});

test("defaults are re-exported so the gate's tolerances are pinned", () => {
  assert.equal(DEFAULT_TOLERANCE, 0.1);
  assert.equal(DEFAULT_MIN_COVERAGE, 0.85);
  assert.equal(DEFAULT_ASPECT_TOLERANCE, 0.12);
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

test("insufficient coverage: a block covering only part of the region fails", () => {
  // Block overlaps just the left half of the drawn region (~50% < 85%).
  const half = [REGION[0], REGION[1], REGION[0] + (REGION[2] - REGION[0]) / 2, REGION[3]];
  const res = result({ blocks: [figureBlock(half, cropFor(half))] });
  const { ok, failures } = checkFixture(res, { regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /covers 50% < 85%/);
});

test("bbox out of tolerance: a block over-extending past the grown region fails", () => {
  // Block still COVERS the region fully but claims 90pt of extra width beyond
  // x1=340 — more than the 79.2pt growth allows, so it is a box for something
  // else (e.g. a merged neighbor), not this drawn region.
  const overWide = [REGION[0], REGION[1], REGION[2] + 90, REGION[3]];
  const res = result({ blocks: [figureBlock(overWide, cropFor(REGION))] });
  const { ok, failures } = checkFixture(res, { regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /escapes the region grown by 10%/);
});

test("figureCount mismatch fails and reports the kinds seen", () => {
  const res = result({
    blocks: [figureBlock(REGION), { kind: "paragraph", bbox: { x0: 72, y0: 700, x1: 540, y1: 720 }, crop: null }],
  });
  const { ok, failures } = checkFixture(res, { figureCount: 2, regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /figure count 1 ≠ expected 2/);
  assert.match(failures.join("; "), /figure, paragraph/);
});

test("figureCount counts only figure-kind blocks", () => {
  // unknown-visual companion blocks (like fig06's tiny heading fragment) do
  // not inflate the figure count.
  const res = result({
    blocks: [
      figureBlock(REGION),
      { kind: "unknown-visual", bbox: { x0: 267, y0: 739.8, x1: 271.2, y1: 747.6 }, crop: { w: 11, h: 18 } },
    ],
  });
  const { ok, failures } = checkFixture(res, { figureCount: 1, regions: [{ bbox: REGION }] });
  assert.equal(ok, true, failures.join("; "));
});

test("rotation mismatch fails", () => {
  const res = result({ rotation: 90, blocks: [figureBlock(REGION, cropFor(REGION, 90))] });
  const { ok, failures } = checkFixture(res, { rotation: 0, regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /rotation 90 ≠ expected 0/);
});

test("warningsInclude: present warnings pass, missing warnings fail", () => {
  const withWarning = result({
    warnings: ["figure-ink-uncovered"],
    blocks: [figureBlock(REGION, cropFor(REGION))],
  });
  const okCase = checkFixture(withWarning, {
    warningsInclude: ["figure-ink-uncovered"],
    regions: [{ bbox: REGION }],
  });
  assert.equal(okCase.ok, true, okCase.failures.join("; "));

  const withoutWarning = result({ blocks: [figureBlock(REGION, cropFor(REGION))] });
  const failCase = checkFixture(withoutWarning, {
    warningsInclude: ["figure-ink-uncovered"],
    regions: [{ bbox: REGION }],
  });
  assert.equal(failCase.ok, false);
  assert.match(failCase.failures.join("; "), /warning figure-ink-uncovered/);
});

test("analyzer failure fails the fixture immediately", () => {
  const res = result({ analysisFailed: "panic at 'raster decode'" });
  const { ok, failures } = checkFixture(res, { regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /analyzer failed/);
});

test("missing or malformed result fails", () => {
  assert.equal(checkFixture(null, { regions: [] }).ok, false);
});

test("region with no block of the expected kind fails with 'no blocks of that kind'", () => {
  const res = result({
    blocks: [{ kind: "unknown-visual", bbox: { x0: REGION[0], y0: REGION[1], x1: REGION[2], y1: REGION[3] }, crop: null }],
  });
  const { ok, failures } = checkFixture(res, { regions: [{ bbox: REGION }] });
  assert.equal(ok, false);
  assert.match(failures.join("; "), /no blocks of that kind/);
});

// ---------------------------------------------------------------------------
// Crop aspect under viewer rotation (the fig09 guarantee)
// ---------------------------------------------------------------------------

test("rotation 90: crop aspect must be the INVERTED region aspect", () => {
  // Drawn region 380x220 (aspect 1.727); under /Rotate 90 the crop's width and
  // height swap, so the expected crop aspect is 220/380 = 0.579.
  const rotatedRegion = [100, 300, 480, 520];
  const inverted = result({ rotation: 90, blocks: [figureBlock(rotatedRegion, cropFor(rotatedRegion, 90))] });
  const okCase = checkFixture(inverted, { regions: [{ bbox: rotatedRegion }] });
  assert.equal(okCase.ok, true, okCase.failures.join("; "));

  // A crop with the UN-inverted (same-basis) aspect deviates ~200% and fails —
  // this is the partial/uncorrected rotation-basis crop the gate exists for.
  const uninverted = result({ rotation: 90, blocks: [figureBlock(rotatedRegion, cropFor(rotatedRegion, 0))] });
  const failCase = checkFixture(uninverted, { regions: [{ bbox: rotatedRegion }] });
  assert.equal(failCase.ok, false);
  assert.match(failCase.failures.join("; "), /crop aspect/);
  assert.match(failCase.failures.join("; "), /rotation 90/);
});

test("rotation 270 also inverts; rotation 0 does not", () => {
  const region270 = [100, 300, 480, 520];
  const res270 = result({ rotation: 270, blocks: [figureBlock(region270, cropFor(region270, 270))] });
  assert.equal(checkFixture(res270, { regions: [{ bbox: region270 }] }).ok, true);

  const res0 = result({ rotation: 0, blocks: [figureBlock(REGION, cropFor(REGION, 0))] });
  const invertedCrop = figureBlock(REGION, cropFor(REGION, 90));
  const res0Bad = result({ rotation: 0, blocks: [invertedCrop] });
  assert.equal(checkFixture(res0, { regions: [{ bbox: REGION }] }).ok, true);
  assert.equal(checkFixture(res0Bad, { regions: [{ bbox: REGION }] }).ok, false);
});

// ---------------------------------------------------------------------------
// Fixture-shape guarantees (one per corpus shape, as synthetic mini-cases)
// ---------------------------------------------------------------------------

test("fig02/fig03/fig05 shape: vector/flowchart/sparse-lineart tight-ink regions match", () => {
  // Sparse line art is the risky shape (little ink): a full-cover bbox with a
  // correct-aspect crop must pass.
  const sparse = [170, 440, 440, 580];
  const res = result({
    blocks: [figureBlock([169.8, 439.2, 441.0, 580.8], cropFor(sparse, 0, 1.02))],
  });
  const { ok, failures } = checkFixture(res, { figureCount: 1, regions: [{ bbox: sparse }] });
  assert.equal(ok, true, failures.join("; "));
});

test("fig04 shape: chart bbox including its axis labels passes, axes-only region would not pin aspect", () => {
  // Region is the axes union the 'Load' axis label (x0 90 < axis 140).
  const chartWithLabel = [90, 380, 520, 570];
  const res = result({
    blocks: [figureBlock([86.0, 379.2, 520.2, 570.0], cropFor(chartWithLabel, 0, 0.99))],
  });
  const { ok, failures } = checkFixture(res, { figureCount: 1, regions: [{ bbox: chartWithLabel }] });
  assert.equal(ok, true, failures.join("; "));
});

test("fig06 shape: column-confined figure — a block drifted into the other column fails tolerance", () => {
  const columnRegion = [330, 380, 530, 560];
  const confined = result({
    blocks: [figureBlock([329.4, 379.2, 531.0, 561.0], cropFor(columnRegion, 0, 0.99))],
  });
  const okCase = checkFixture(confined, { figureCount: 1, regions: [{ bbox: columnRegion }] });
  assert.equal(okCase.ok, true, okCase.failures.join("; "));

  // Same-height block that still COVERS the region but wrongly claims 90pt of
  // the left column's gutter: x0=240 is 90pt past the region edge — beyond
  // the 79.2pt growth (coverage passes; the bbox-tolerance check bites).
  const drifted = result({
    blocks: [figureBlock([240, 379.2, 531, 561.0], cropFor(columnRegion))],
  });
  const failCase = checkFixture(drifted, { regions: [{ bbox: columnRegion }] });
  assert.equal(failCase.ok, false);
  assert.match(failCase.failures.join("; "), /escapes the region grown/);
});

test("fig08 shape: merged adjacent figures — band coverage passes with checkCropAspect off, bites without it", () => {
  const topBand = [90, 560, 540, 690]; // union of the two drawn top figures
  const mergedBlock = figureBlock([68.0, 544.0, 540.6, 752.0], { w: 954, h: 425 }); // band + gap + swallowed captions
  const res = result({ blocks: [mergedBlock] });

  const withOptOut = checkFixture(res, {
    figureCount: 1,
    regions: [{ bbox: topBand, checkCropAspect: false }],
  });
  assert.equal(withOptOut.ok, true, withOptOut.failures.join("; "));

  const withoutOptOut = checkFixture(res, { regions: [{ bbox: topBand }] });
  assert.equal(withoutOptOut.ok, false);
  assert.match(withoutOptOut.failures.join("; "), /crop aspect/);
});

test("fig10 shape: extreme slivers — tall strip aspect pinned, banner aspect opted out", () => {
  const tallStrip = [280, 80, 320, 470]; // 1:9.75
  const banner = [72, 640, 540, 664]; // 19.5:1
  const res = result({
    figureCount: 2,
    blocks: [
      figureBlock([70.8, 624.0, 541.2, 665.4], { w: 947, h: 89 }), // banner + caption bleed
      figureBlock([279.0, 64.0, 321.0, 471.0], { w: 91, h: 820 }), // strip, aspect within 12%
    ],
  });
  const { ok, failures } = checkFixture(res, {
    figureCount: 2,
    regions: [
      { bbox: banner, checkCropAspect: false },
      { bbox: tallStrip },
    ],
  });
  assert.equal(ok, true, failures.join("; "));
});

// ---------------------------------------------------------------------------
// checkExpectations (whole-corpus semantics)
// ---------------------------------------------------------------------------

test("checkExpectations: green run reports the checked count", () => {
  const expectations = {
    fixtures: {
      "fig01-raster": { figureCount: 1, regions: [{ bbox: REGION }] },
      "fig09-rotated-figure": { rotation: 90, regions: [] },
    },
  };
  const results = {
    "fig01-raster": result({ slug: "fig01-raster", blocks: [figureBlock(REGION, cropFor(REGION))] }),
    "fig09-rotated-figure": result({ slug: "fig09-rotated-figure", rotation: 90 }),
  };
  const { ok, failures, checked } = checkExpectations(results, expectations);
  assert.equal(ok, true, JSON.stringify(failures));
  assert.equal(checked, 2);
});

test("checkExpectations: expected fixture with no analyzer result fails", () => {
  const expectations = { fixtures: { "fig01-raster": { regions: [] } } };
  const { ok, failures } = checkExpectations({}, expectations);
  assert.equal(ok, false);
  assert.deepEqual(failures, [{ fixture: "fig01-raster", reasons: ["expected fixture produced no analyzer result"] }]);
});

test("checkExpectations: analyzer result with no expectation entry fails (no silent skips)", () => {
  const expectations = { fixtures: { "fig01-raster": { regions: [] } } };
  const results = {
    "fig01-raster": result({ slug: "fig01-raster" }),
    "fig11-not-in-corpus": result({ slug: "fig11-not-in-corpus" }),
  };
  const { ok, failures } = checkExpectations(results, expectations);
  assert.equal(ok, false);
  assert.deepEqual(failures, [
    { fixture: "fig11-not-in-corpus", reasons: ["analyzer result has no expectation entry"] },
  ]);
});

test("checkExpectations: per-fixture failure reasons are surfaced per slug", () => {
  const expectations = {
    fixtures: {
      "fig01-raster": { figureCount: 2, regions: [{ bbox: REGION }] },
      "fig02-vector-labels": { regions: [] },
    },
  };
  const results = {
    "fig01-raster": result({ slug: "fig01-raster", blocks: [figureBlock(REGION, cropFor(REGION))] }),
    "fig02-vector-labels": result({ slug: "fig02-vector-labels" }),
  };
  const { ok, failures } = checkExpectations(results, expectations);
  assert.equal(ok, false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].fixture, "fig01-raster");
  assert.match(failures[0].reasons.join("; "), /figure count 1 ≠ expected 2/);
});

test("custom options tighten the gate (tolerance, coverage, aspect)", () => {
  const grown = [REGION[0] - 4, REGION[1] - 4, REGION[2] + 4, REGION[3] + 4];
  const res = result({ blocks: [figureBlock(grown, cropFor(REGION, 0, 1.05))] });
  // 4pt bleed is fine at 10% page-span tolerance but not at 0.5%.
  assert.equal(checkFixture(res, { regions: [{ bbox: REGION }] }).ok, true);
  const strict = checkFixture(res, { regions: [{ bbox: REGION }] }, { tolerance: 0.005 });
  assert.equal(strict.ok, false);
  assert.match(strict.failures.join("; "), /escapes the region grown by 1%/);
});
