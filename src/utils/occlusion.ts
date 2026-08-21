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

/**
 * Viewport math for the occlusion canvas.
 *
 * The canvas renders the image at a "fit to view" size described by
 * `OcclusionImgBounds` (the rendered image rect inside its container), then
 * applies a CSS `transform: translate(panX, panY) scale(scale)` to the
 * image+overlay wrapper (transform-origin 0 0). Screen space therefore maps
 * to fit-view space as `screen = fit * scale + pan`. Region coordinates stay
 * percent-based (0–100) relative to the source image and are unaffected by
 * zoom/pan — only these two functions translate between the spaces.
 */
export interface OcclusionViewport {
  /** Zoom factor, 1 = fit-to-view, 8 = 800%. Must be > 0. */
  scale: number;
  /** Horizontal translation in screen pixels applied after scaling. */
  panX: number;
  /** Vertical translation in screen pixels applied after scaling. */
  panY: number;
}

/** The rendered rect of the image inside its (untransformed) container. */
export interface OcclusionImgBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export const DEFAULT_OCCLUSION_VIEWPORT: OcclusionViewport = { scale: 1, panX: 0, panY: 0 };

/** Map a percent coordinate (0–100 on the source image) to screen space. */
export function percentToViewport(
  point: { x: number; y: number },
  viewport: OcclusionViewport,
  imgBounds: OcclusionImgBounds,
): { x: number; y: number } {
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  return {
    x: (imgBounds.offsetX + (point.x / 100) * imgBounds.width) * scale + viewport.panX,
    y: (imgBounds.offsetY + (point.y / 100) * imgBounds.height) * scale + viewport.panY,
  };
}

/** Map a screen-space coordinate back to percent (clamped to 0–100). */
export function viewportToPercent(
  point: { x: number; y: number },
  viewport: OcclusionViewport,
  imgBounds: OcclusionImgBounds,
): { x: number; y: number } {
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  const x = (((point.x - viewport.panX) / scale - imgBounds.offsetX) / imgBounds.width) * 100;
  const y = (((point.y - viewport.panY) / scale - imgBounds.offsetY) / imgBounds.height) * 100;
  return { x: clampPercent(x), y: clampPercent(y) };
}

/** Minimum zoom: fit-to-view. */
export const MIN_OCCLUSION_ZOOM = 1;
/** Maximum zoom: 800%. */
export const MAX_OCCLUSION_ZOOM = 8;

/**
 * Zoom `viewport` by `factor`, keeping the screen point `anchor` (relative to
 * the canvas container) pinned to the same image location. The scale is
 * clamped to [MIN_OCCLUSION_ZOOM, MAX_OCCLUSION_ZOOM]; when the clamp
 * prevents any change the same viewport is returned.
 */
export function zoomViewportAt(
  viewport: OcclusionViewport,
  anchor: { x: number; y: number },
  factor: number,
): OcclusionViewport {
  const scale = Math.max(
    MIN_OCCLUSION_ZOOM,
    Math.min(MAX_OCCLUSION_ZOOM, viewport.scale * factor),
  );
  if (scale === viewport.scale) return viewport;
  // The image point currently under the anchor must stay under it:
  // anchor = fit * scale_old + pan_old  =>  pan_new = anchor - fit * scale_new.
  const fitX = (anchor.x - viewport.panX) / viewport.scale;
  const fitY = (anchor.y - viewport.panY) / viewport.scale;
  return { scale, panX: anchor.x - fitX * scale, panY: anchor.y - fitY * scale };
}

/** Occlusion modes: how a session's regions expand into saved cards. */
export type OcclusionMode = "hide-all" | "hide-one" | "per-region";

/** A card draft produced by `expandRegionsToCards`. */
export interface OcclusionCardDraft {
  /** Regions masked on this card's front face. */
  hiddenRegions: ImageOcclusionRegion[];
  /** Regions left visible on this card's front face. */
  visibleRegions: ImageOcclusionRegion[];
  /** The specific region being tested/prompted by this card. */
  targetRegionId?: string;
  /** Answer text: explicit answer if supplied, else derived from region labels. */
  answer?: string;
}

/** Optional authoring metadata for card expansion. */
export interface ExpandRegionsMeta {
  /** Explicit answer text per region id; wins over the region's label. */
  answersByRegionId?: Record<string, string>;
  /** Explicit answer fallback (e.g. single region or custom override). */
  answer?: string;
}

/**
 * Expand a session's regions into the card drafts it will produce.
 *
 * - `hide-all`: one card per usable region; all usable regions are hidden on
 *   the front face to prevent answer leakage, with `targetRegionId` designating
 *   the active test target.
 * - `hide-one` (or `per-region`): one card per usable region; that region alone
 *   is hidden, every other usable region is visible.
 *
 * Zero-area / out-of-bounds regions are excluded (they are dropped on save),
 * so the preview built from this function always matches what is persisted.
 * The answer for a card is the target region's label unless an explicit
 * answer is supplied for that region.
 */
export function expandRegionsToCards(
  regions: ImageOcclusionRegion[],
  mode: OcclusionMode = "hide-all",
  meta?: ExpandRegionsMeta,
): OcclusionCardDraft[] {
  const usable = regions.filter(regionHasUsableArea);
  if (usable.length === 0) return [];
  if (mode === "hide-all") {
    return usable.map((region) => {
      const explicit =
        meta?.answersByRegionId?.[region.id ?? ""]?.trim() ||
        (usable.length === 1 ? meta?.answer?.trim() : undefined);
      const answer = explicit || region.label?.trim() || undefined;
      return {
        targetRegionId: region.id,
        hiddenRegions: usable,
        visibleRegions: [],
        answer,
      };
    });
  }
  return usable.map((region) => {
    const explicit = meta?.answersByRegionId?.[region.id ?? ""]?.trim();
    const answer = explicit || region.label?.trim() || undefined;
    return {
      targetRegionId: region.id,
      hiddenRegions: [region],
      visibleRegions: usable.filter((r) => r !== region),
      answer,
    };
  });
}

/** Intersection-over-union of two percent rectangles (0 when disjoint). */
export function regionIoU(a: ImageOcclusionRegion, b: ImageOcclusionRegion): number {
  const aLeft = a.x;
  const aTop = a.y;
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bLeft = b.x;
  const bTop = b.y;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  const iw = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
  const ih = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
  const intersection = iw * ih;
  if (intersection === 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

/**
 * Whether a candidate region duplicates any existing region: IoU strictly
 * above `threshold` (default 0.6). Used to collapse overlapping AI proposals.
 */
export function isDuplicateRegion(
  candidate: ImageOcclusionRegion,
  existing: ImageOcclusionRegion[],
  threshold = 0.6,
): boolean {
  return existing.some((region) => regionIoU(candidate, region) > threshold);
}
