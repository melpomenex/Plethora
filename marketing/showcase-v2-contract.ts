export const MARKETING_FIXTURE_ID = "marketing-fixture-v2" as const;
export const MARKETING_FIXTURE_VERSION = "2.0.0" as const;
export const MARKETING_LOGICAL_TIME = "2026-08-23T12:00:00.000Z" as const;

export type ShowcaseLayout = "desktop" | "mobile";
export type ShowcaseMode = "narrative" | "guided" | "explore" | "complete";
export type ShowcaseTransition = "crossfade" | "focus" | "immediate";

export type ShowcaseSceneId =
  | "library.ready"
  | "reader.open"
  | "reader.selected"
  | "explain.grounded"
  | "remember.preview"
  | "review.question"
  | "review.answer"
  | "review.scheduled"
  | "connections.context";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A hotspot is emitted only after Playwright measures its stable selector in
 * the rendered product scene. Source catalogs intentionally contain no rects.
 */
export interface MeasuredShowcaseHotspot {
  id: string;
  actionLabel: string;
  nextSceneId: ShowcaseSceneId;
  selector: string;
  rect: NormalizedRect;
}

export interface MeasuredShowcaseSceneLayout {
  sceneId: ShowcaseSceneId;
  layout: ShowcaseLayout;
  viewport: { width: number; height: number; dpr: number };
  hotspots: MeasuredShowcaseHotspot[];
}

export const SHOWCASE_LAYOUTS: readonly ShowcaseLayout[] = ["desktop", "mobile"];

/**
 * Launch-approved guided path. `explain.grounded` remains an optional catalog
 * branch until the real explanation UI gains deterministic result injection.
 */
export const SHOWCASE_GUIDED_PATH: readonly ShowcaseSceneId[] = [
  "library.ready",
  "reader.open",
  "reader.selected",
  "remember.preview",
  "review.question",
  "review.answer",
  "review.scheduled",
  "connections.context",
];

export const SHOWCASE_CAPTURE_THEME = "plethora-purple" as const;
export const SHOWCASE_BUILD_ID_FORMAT = "<package-version>+<short-git-sha>" as const;

export function isNormalizedRect(rect: NormalizedRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  ) && rect.x + rect.width <= 1 && rect.y + rect.height <= 1;
}
