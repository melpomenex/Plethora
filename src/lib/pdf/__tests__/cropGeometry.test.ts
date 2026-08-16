/**
 * Crop geometry (task 6.2): mapping an unrotated user-space rect onto a
 * rotation-applied crop canvas. Rotations mirror `RasterGeometry` in
 * src-tauri/src/pdf/coordinates.rs; rotation 0 must stay byte-identical to
 * the original inline crop math in reflowAssets.ts.
 */
import { describe, expect, it } from "vitest";
import { computeCropSourceRect, cropPadFor } from "../cropGeometry";

/** Letter portrait page in user space. */
const W = 612;
const H = 792;
const rect = { x0: 105, y0: 400, x1: 510, y1: 583 };
const S = 2;

function canvasFor(rotation: number): { w: number; h: number } {
  return rotation % 180 === 90 ? { w: H * S, h: W * S } : { w: W * S, h: H * S };
}

describe("computeCropSourceRect", () => {
  it("is byte-identical to the legacy rotation-0 arithmetic", () => {
    const canvas = canvasFor(0);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      rect,
      W,
      H,
      0,
      canvas.w,
      canvas.h,
      4,
    );
    // The exact expressions previously inlined in renderAndStoreRegionAsset.
    const sx = (rect.x0 / W) * canvas.w;
    const sy = (1 - rect.y1 / H) * canvas.h;
    const sw = ((rect.x1 - rect.x0) / W) * canvas.w;
    const sh = ((rect.y1 - rect.y0) / H) * canvas.h;
    expect(srcX).toBe(Math.max(0, Math.floor(sx) - 4));
    expect(srcY).toBe(Math.max(0, Math.floor(sy) - 4));
    expect(srcW).toBe(Math.min(canvas.w - srcX, Math.ceil(sw) + 8));
    expect(srcH).toBe(Math.min(canvas.h - srcY, Math.ceil(sh) + 8));
    // …and the concrete dims the renderer pinned historically (srcY floors
    // 417.999…94 → 413: the legacy expression order, kept verbatim).
    expect([srcX, srcY, srcW, srcH]).toEqual([206, 413, 818, 374]);
  });

  it("maps a user-space point to the same device point as the raster transform (rotation 90)", () => {
    // RasterGeometry rotation 90: vx = y·s, vy = x·s. A rect of size
    // 405×183pt must occupy a 183×405pt (366×810px) box in the swapped
    // H×W canvas, with its corner at the device point of (x0, y0).
    const canvas = canvasFor(90);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      rect,
      W,
      H,
      90,
      canvas.w,
      canvas.h,
      4,
    );
    expect(srcX).toBe(Math.floor((rect.y0 / H) * canvas.w) - 4);
    expect(srcY).toBe(Math.floor((rect.x0 / W) * canvas.h) - 4);
    expect(srcW).toBe(Math.ceil(((rect.y1 - rect.y0) / H) * canvas.w) + 8);
    expect(srcH).toBe(Math.ceil(((rect.x1 - rect.x0) / W) * canvas.h) + 8);
  });

  it("maps rotation 180 (vx = (W−x)·s, vy = y·s — no y flip)", () => {
    const canvas = canvasFor(180);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      rect,
      W,
      H,
      180,
      canvas.w,
      canvas.h,
      0,
    );
    // Right edge x1=510 → device left = (1 − x1/W) · canvasW (the same
    // expression shape as the rotation-0 legacy math).
    expect(srcX).toBe(Math.floor((1 - rect.x1 / W) * canvas.w));
    // Bottom edge y0=400 → device top = y0/H · canvasH (y grows downward
    // from the user-space bottom at rotation 180).
    expect(srcY).toBe(Math.floor((rect.y0 / H) * canvas.h));
    expect(srcW).toBe(Math.ceil(((rect.x1 - rect.x0) / W) * canvas.w));
    expect(srcH).toBe(Math.ceil(((rect.y1 - rect.y0) / H) * canvas.h));
  });

  it("maps rotation 270 (vx = (H−y)·s, vy = (W−x)·s)", () => {
    const canvas = canvasFor(270);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      rect,
      W,
      H,
      270,
      canvas.w,
      canvas.h,
      0,
    );
    expect(srcX).toBe(Math.floor((1 - rect.y1 / H) * canvas.w));
    expect(srcY).toBe(Math.floor((1 - rect.x1 / W) * canvas.h));
    expect(srcW).toBe(Math.ceil(((rect.y1 - rect.y0) / H) * canvas.w));
    expect(srcH).toBe(Math.ceil(((rect.x1 - rect.x0) / W) * canvas.h));
  });

  it("keeps the crop inside the canvas for edge-hugging rects at every rotation", () => {
    const edges = [
      { x0: 0, y0: 0, x1: 612, y1: 792 },
      { x0: 600, y0: 0, x1: 612, y1: 12 },
      { x0: 0, y0: 780, x1: 12, y1: 792 },
    ];
    for (const rotation of [0, 90, 180, 270]) {
      const canvas = canvasFor(rotation);
      for (const r of edges) {
        const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
          r,
          W,
          H,
          rotation,
          canvas.w,
          canvas.h,
          4,
        );
        expect(srcX).toBeGreaterThanOrEqual(0);
        expect(srcY).toBeGreaterThanOrEqual(0);
        expect(srcX + srcW).toBeLessThanOrEqual(canvas.w);
        expect(srcY + srcH).toBeLessThanOrEqual(canvas.h);
        expect(srcW).toBeGreaterThan(0);
        expect(srcH).toBeGreaterThan(0);
      }
    }
  });

  it("preserves the rect's device-pixel size at every rotation (no sideways strips)", () => {
    // The sideways-full-height-strip bug: a rotated page's rect normalized
    // against swapped dims produced a negative/clamped top edge. Every
    // rotation must produce the same crop SIZE (axes swapped at 90/270).
    for (const rotation of [0, 180]) {
      const canvas = canvasFor(rotation);
      const { srcW, srcH } = computeCropSourceRect(rect, W, H, rotation, canvas.w, canvas.h, 4);
      expect(srcW).toBe(818);
      expect(srcH).toBe(374);
    }
    for (const rotation of [90, 270]) {
      const canvas = canvasFor(rotation);
      const { srcW, srcH } = computeCropSourceRect(rect, W, H, rotation, canvas.w, canvas.h, 4);
      expect(srcW).toBe(374);
      expect(srcH).toBe(818);
    }
  });
});

describe("cropPadFor", () => {
  it("keeps the historical 4px pad for real figures", () => {
    // 2–4 % expansion per side: a 366px min-side crop wants ~15px but the
    // pad is capped at the historical 4px.
    expect(cropPadFor(810, 366)).toBe(4);
    expect(cropPadFor(200, 200)).toBe(4);
  });

  it("shrinks the pad for thin crops instead of inflating them", () => {
    expect(cropPadFor(600, 8)).toBe(1);
    expect(cropPadFor(24, 24)).toBe(1); // 0.96 rounds to 1
    expect(cropPadFor(100, 40)).toBe(2); // 1.6 rounds to 2
  });
});
