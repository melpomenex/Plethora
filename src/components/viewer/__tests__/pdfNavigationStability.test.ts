import { buildPdfPageOffsets } from "../pdfNavigationStability";
import { describe, expect, it } from "vitest";
import {
  deriveCurrentPageFromOffsets,
  isNavigationSettled,
  isStaleNavigationToken,
  shouldSuppressProgrammaticScroll,
} from "../pdfNavigationStability";

describe("pdfNavigationStability", () => {
  it("derives current page from offsets using binary search", () => {
    const offsets = [0, 1000, 2000, 3000];

    expect(deriveCurrentPageFromOffsets(offsets, 4, 1, 0)).toBe(1);
    expect(deriveCurrentPageFromOffsets(offsets, 4, 1, 950)).toBe(1);
    expect(deriveCurrentPageFromOffsets(offsets, 4, 1, 1100)).toBe(2);
    expect(deriveCurrentPageFromOffsets(offsets, 4, 1, 2500)).toBe(3);
  });

  it("suppresses non-TOC programmatic updates during user lockout", () => {
    const suppressed = shouldSuppressProgrammaticScroll({
      enabled: true,
      source: "restore",
      now: 200,
      lockoutUntil: 1200,
      activeToken: null,
    });

    expect(suppressed).toBe(true);
  });

  it("allows TOC programmatic updates only for the active token", () => {
    expect(
      shouldSuppressProgrammaticScroll({
        enabled: true,
        source: "toc",
        token: 2,
        now: 100,
        lockoutUntil: 1000,
        activeToken: 2,
      }),
    ).toBe(false);

    expect(
      shouldSuppressProgrammaticScroll({
        enabled: true,
        source: "toc",
        token: 1,
        now: 100,
        lockoutUntil: 1000,
        activeToken: 2,
      }),
    ).toBe(true);
  });

  it("marks stale token and settle status correctly", () => {
    expect(isStaleNavigationToken(5, 4)).toBe(true);
    expect(isStaleNavigationToken(5, 5)).toBe(false);
    expect(isNavigationSettled(24, true, 40)).toBe(true);
    expect(isNavigationSettled(55, true, 40)).toBe(false);
    expect(isNavigationSettled(10, false, 40)).toBe(false);
  });
});


describe("measured page geometry across virtualization", () => {
  it("retains mixed page heights and scales them without reverting to estimates", () => {
    const measured = new Map([[0, 1200], [1, 500]]);
    expect(buildPdfPageOffsets(4, 800, measured, 1, 24)).toEqual([0, 1224, 1748, 2572, 3396]);
    expect(buildPdfPageOffsets(4, 800, measured, 2, 24)).toEqual([0, 2424, 3448, 5072, 6696]);
    // Unmounting a page removes its viewport/DOM; the source-size cache remains.
    expect(buildPdfPageOffsets(4, 800, measured, 1, 24)[2]).toBe(1748);
  });
});
