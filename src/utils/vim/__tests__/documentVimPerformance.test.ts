import { describe, expect, it } from "vitest";
import { BoundedRegionCache, buildLogicalRegion } from "../logicalIndex";
import { moveLogicalCursor, type LogicalMotionSource } from "../logicalMotion";
import { PdfLogicalIndex } from "../pdfLogicalIndex";

describe("document Vim performance budgets", () => {
  it("resolves 500 repeated motions within the interaction budget", async () => {
    const regions = Array.from({ length: 20 }, (_, index) => buildLogicalRegion(index, [Array.from({ length: 100 }, (__, word) => `w${word}`).join(" ")]));
    const source: LogicalMotionSource = { firstRegion: 0, lastRegion: 19, region: async (index) => regions[index] };
    const start = performance.now();
    const result = await moveLogicalCursor(source, { region: 0, token: 0 }, "word-forward", 500);
    expect(result.cursor.region).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("indexes a large PDF page lazily within budget", async () => {
    const items = Array.from({ length: 2500 }, (_, index) => ({ str: `word${index} `, transform: [1,0,0,10,(index % 50) * 8,1000 - Math.floor(index / 50) * 12], width: 8, height: 10, hasEOL: index % 50 === 49 }));
    const index = new PdfLogicalIndex(async () => items);
    const start = performance.now(); const page = await index.page(1);
    expect(page.tokens.length).toBe(2500); expect(performance.now() - start).toBeLessThan(750);
  });

  it("keeps region cache memory bounded under churn", () => {
    const cache = new BoundedRegionCache<number, string>(9);
    for (let index = 0; index < 1000; index += 1) cache.set(index, `page-${index}`);
    expect(cache.size).toBe(9); expect(cache.has(999)).toBe(true); expect(cache.has(0)).toBe(false);
  });
});
