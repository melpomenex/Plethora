import { describe, expect, it } from "vitest";
import { BoundedRegionCache, buildLogicalRegion } from "../logicalIndex";
import { moveLogicalCursor, type LogicalMotionSource } from "../logicalMotion";
import { PdfLogicalIndex } from "../pdfLogicalIndex";

/**
 * Document Vim correctness at scale.
 *
 * The absolute wall-clock budgets (`performance.now() - start < 500/750 ms`)
 * that used to live here are gone: raw-millisecond thresholds flake across
 * machines and catch nothing meaningful. Speed is gated by the benchmark
 * harness (`npm run bench` + scripts/check-perf-budget.mjs); what remains is
 * pure correctness at representative input sizes.
 */
describe("document Vim motion and indexing at scale", () => {
  it("resolves 500 repeated motions", async () => {
    const regions = Array.from({ length: 20 }, (_, index) => buildLogicalRegion(index, [Array.from({ length: 100 }, (__, word) => `w${word}`).join(" ")]));
    const source: LogicalMotionSource = { firstRegion: 0, lastRegion: 19, region: async (index) => regions[index] };
    const result = await moveLogicalCursor(source, { region: 0, token: 0 }, "word-forward", 500);
    expect(result.cursor.region).toBeGreaterThan(0);
  });

  it("indexes a large PDF page lazily", async () => {
    const items = Array.from({ length: 2500 }, (_, index) => ({ str: `word${index} `, transform: [1,0,0,10,(index % 50) * 8,1000 - Math.floor(index / 50) * 12], width: 8, height: 10, hasEOL: index % 50 === 49 }));
    const index = new PdfLogicalIndex(async () => items);
    const page = await index.page(1);
    expect(page.tokens.length).toBe(2500);
  });

  it("keeps region cache memory bounded under churn", () => {
    const cache = new BoundedRegionCache<number, string>(9);
    for (let index = 0; index < 1000; index += 1) cache.set(index, `page-${index}`);
    expect(cache.size).toBe(9); expect(cache.has(999)).toBe(true); expect(cache.has(0)).toBe(false);
  });
});
