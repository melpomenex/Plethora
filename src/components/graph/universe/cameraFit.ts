/**
 * Knowledge Universe — aspect-aware camera fit math.
 *
 * Pure helpers (no three.js, no DOM) so the zoom-range and focal-zoom math is
 * unit-testable. The perspective camera's FOV is *vertical*; on narrow
 * (portrait) viewports the horizontal FOV shrinks, so distances that frame the
 * galaxy must be derived from the tighter of the two axes.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraRange {
  homeDist: number;
  maxDist: number;
}

const DEG2RAD = Math.PI / 180;

/** Home distance never drops below this, even for tiny collections. */
export const MIN_HOME_DIST = 140;

/** Half-angle (radians) of the narrower FOV axis for a vertical fov + aspect. */
export function minHalfFov(fovDeg: number, aspect: number): number {
  const halfV = (fovDeg / 2) * DEG2RAD;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.01));
  return Math.min(halfV, halfH);
}

/** Distance at which a sphere of `radius` fits within both FOV axes. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  return radius / Math.tan(minHalfFov(fovDeg, aspect));
}

/**
 * Camera travel range for a layout. The `bounds × 2.6` / `homeDist × 1.6`
 * floors keep landscape/desktop behavior identical to the pre-aspect-aware
 * formulas; the fitDistance terms only dominate when the viewport is narrower
 * than the galaxy needs, letting portrait devices pull back far enough to see
 * the whole universe.
 */
export function computeCameraRange(
  bounds: number,
  coreBounds: number,
  fovDeg: number,
  aspect: number
): CameraRange {
  const homeDist = Math.max(fitDistance(coreBounds, fovDeg, aspect) * 1.1, MIN_HOME_DIST);
  const maxDist = Math.max(
    fitDistance(bounds, fovDeg, aspect) * 1.25,
    bounds * 2.6,
    homeDist * 1.6
  );
  return { homeDist, maxDist };
}

/**
 * Projection shift that places the camera target at the midpoint of the
 * unobscured region to the left of a right-side panel.
 *
 * `obstructionLeft` is measured in viewport-local CSS pixels. Three.js's
 * positive view offset moves the projected target left by the same amount.
 */
export function computeUsableViewportOffset(
  viewportWidth: number,
  obstructionLeft: number,
  obstructionConsumesSpace: boolean
): number {
  if (!obstructionConsumesSpace || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }
  const visibleRight = Math.min(Math.max(obstructionLeft, 0), viewportWidth);
  return (viewportWidth - visibleRight) / 2;
}

/**
 * Focal-point zoom: the orbit target that keeps `anchor` (a point on the plane
 * through `target` perpendicular to the view axis) at the same screen position
 * when the orbit distance changes from `distOld` to `distNew`.
 *
 * Screen offset of a point on that plane is proportional to
 * |point − target| / dist, so the new target must satisfy
 * (anchor − target') = (distNew / distOld) × (anchor − target).
 */
export function anchorShift(
  anchor: Vec3Like,
  target: Vec3Like,
  distOld: number,
  distNew: number
): Vec3Like {
  if (distOld <= 0) return { x: target.x, y: target.y, z: target.z };
  const k = 1 - distNew / distOld;
  return {
    x: target.x + (anchor.x - target.x) * k,
    y: target.y + (anchor.y - target.y) * k,
    z: target.z + (anchor.z - target.z) * k,
  };
}
