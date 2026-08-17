/**
 * Companion perch discovery + flight math.
 *
 * The bird treats stable horizontal edges in the app chrome as perch spots:
 * explicit `[data-companion-perch]` opt-ins, the toolbar rail, and panel/card
 * top edges (size/visibility filtered). Everything here is either a pure
 * function over rects (unit-tested) or a cheap on-demand DOM scan — never a
 * polling loop.
 */

export interface PerchSpot {
  id: string;
  /** Center point the bird's feet rest on. */
  x: number;
  y: number;
  kind: "optin" | "toolbar" | "panel" | "floor";
  /** Element the spot belongs to (used to skip stale/hidden perches). */
  element?: HTMLElement;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

/** Horizontal positions along a perchable edge (fraction of its width). */
const EDGE_FRACTIONS = [0.18, 0.5, 0.82];

/** Minimum edge width to be worth perching on. */
const MIN_EDGE_WIDTH = 90;

/**
 * Perch spots along a horizontal edge. `edgeY` is the Y the bird's feet
 * rest on; the bird is drawn centered above it.
 */
export function spotsAlongEdge(
  rect: RectLike,
  edgeY: number,
  viewport: ViewportLike,
  kind: PerchSpot["kind"],
  id: string,
  element?: HTMLElement
): PerchSpot[] {
  if (rect.width < MIN_EDGE_WIDTH) return [];
  const spots: PerchSpot[] = [];
  for (let i = 0; i < EDGE_FRACTIONS.length; i++) {
    const x = rect.left + rect.width * EDGE_FRACTIONS[i];
    if (x < 8 || x > viewport.width - 8) continue;
    if (edgeY < 8 || edgeY > viewport.height - 8) continue;
    spots.push({ id: `${id}:${i}`, x: Math.round(x), y: Math.round(edgeY), kind, element });
  }
  return spots;
}

/** The floor perch: bottom of the safe viewport. */
export function floorSpot(viewport: ViewportLike, bottomInset = 16): PerchSpot {
  return {
    id: "floor",
    x: Math.round(viewport.width / 2),
    y: Math.round(viewport.height - bottomInset),
    kind: "floor",
  };
}

/** Candidate surfaces we scan for (order = preference). */
const PERCH_SELECTORS: { selector: string; kind: PerchSpot["kind"] }[] = [
  { selector: "[data-companion-perch]", kind: "optin" },
  { selector: ".toolbar-rail", kind: "toolbar" },
  { selector: ".glass-panel, section.bg-card, .bg-card", kind: "panel" },
];

/** Never perch inside dialogs or explicitly excluded regions. */
function excluded(el: HTMLElement): boolean {
  if (el.closest('[role="dialog"], [data-companion-exclude]')) return true;
  if (el.getAttribute("data-companion-perch") === "off") return true;
  return false;
}

/** On-demand scan of the live DOM for perch spots (bounded, ~dozens). */
export function discoverPerchSpots(viewport: ViewportLike): PerchSpot[] {
  const spots: PerchSpot[] = [];
  const seen = new Set<Element>();
  let index = 0;
  for (const { selector, kind } of PERCH_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (seen.has(el) || excluded(el)) continue;
      seen.add(el);
      // Hidden or zero-sized elements have no surface to stand on.
      if (!el.offsetParent && el.tagName !== "BODY") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      if (kind === "toolbar") {
        // A top-positioned rail perches on its bottom edge; side rails on
        // their top edge.
        const position = el.getAttribute("data-toolbar-position") ?? "left";
        const edgeY = position === "top" ? rect.bottom : rect.top;
        spots.push(...spotsAlongEdge(rect, edgeY, viewport, kind, `tb${index}`));
      } else {
        // Panels/cards: stand on the top edge (only when it is visibly below
        // the very top of the viewport — a flush-to-top edge has no surface).
        if (rect.top >= 24) {
          spots.push(...spotsAlongEdge(rect, rect.top, viewport, kind, `p${index}`));
        }
      }
      index += 1;
    }
  }
  spots.push(floorSpot(viewport));
  return spots;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Nearest perch within `maxDistance` of a point, if any. */
export function nearestPerchSpot(
  spots: PerchSpot[],
  point: { x: number; y: number },
  maxDistance: number
): PerchSpot | null {
  let best: PerchSpot | null = null;
  let bestDist = maxDistance;
  for (const spot of spots) {
    const d = distance(spot, point);
    if (d <= bestDist) {
      best = spot;
      bestDist = d;
    }
  }
  return best;
}

/** Random spot differing from `avoid`, for ambient wandering. */
export function randomOtherSpot(spots: PerchSpot[], avoidId: string | null): PerchSpot | null {
  const candidates = spots.filter((s) => s.id !== avoidId && s.kind !== "floor");
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Parabolic flight path between two points. `t` in [0, 1]; the arc rises by
 * ~18% of the travel distance (bounded) so short hops stay subtle and long
 * flights crest visibly.
 */
export function arcPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const lift = Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) * 0.18);
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped - Math.sin(clamped * Math.PI) * lift,
  };
}

/** Flight duration proportional to distance (ms), clamped for feel. */
export function flightDurationMs(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(Math.max(500, Math.min(1600, 350 + d * 1.1)));
}

export type DropOutcome =
  | { kind: "snap"; spot: PerchSpot }
  | { kind: "fall"; floorY: number; thenFlyTo: PerchSpot | null };

/** Radius around a perch where a drop snaps to it. */
export const SNAP_RADIUS = 90;

/**
 * What happens when the user lets go of the bird:
 *  - dropped near a perch → snap onto it;
 *  - dropped in open space → fall to the floor with flapping, then (if some
 *    perch exists) fly from there to the nearest one.
 */
export function chooseDropOutcome(
  dropPoint: { x: number; y: number },
  spots: PerchSpot[],
  viewport: ViewportLike
): DropOutcome {
  const snap = nearestPerchSpot(spots, dropPoint, SNAP_RADIUS);
  if (snap) return { kind: "snap", spot: snap };
  const floorY = viewport.height - 16;
  const floorTarget = nearestPerchSpot(
    spots.filter((s) => s.kind !== "floor"),
    { x: dropPoint.x, y: floorY },
    Number.POSITIVE_INFINITY
  );
  return { kind: "fall", floorY, thenFlyTo: floorTarget };
}
