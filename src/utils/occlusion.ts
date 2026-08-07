import type { ImageOcclusionRegion } from "../types/learningItemInteractions";

/**
 * Occlusion-region geometry helpers.
 *
 * Regions are stored as percentages of the source image (0–100). Every
 * mutation in the editor must route through `clampRegion` so a region can
 * never be dragged, resized or imported outside the image bounds.
 */

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Clamp a single region so its bounds stay inside the image and keep positive size. */
export function clampRegion(region: ImageOcclusionRegion): ImageOcclusionRegion {
  const x = clampPercent(region.x);
  const y = clampPercent(region.y);
  // Clip to the image on both edges: a region spanning -20..10 becomes 0..10.
  const right = clampPercent(region.x + region.width);
  const bottom = clampPercent(region.y + region.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  return { ...region, x, y, width, height };
}

/** Clamp every region and drop any that collapsed to zero size (outside bounds). */
export function clampRegions(regions: ImageOcclusionRegion[]): ImageOcclusionRegion[] {
  return regions.map(clampRegion).filter((r) => r.width > 0 && r.height > 0);
}

/** Whether a region has any usable area after clamping (positive, in-bounds). */
export function regionHasUsableArea(region: ImageOcclusionRegion): boolean {
  return (
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 100 &&
    region.y + region.height <= 100
  );
}
