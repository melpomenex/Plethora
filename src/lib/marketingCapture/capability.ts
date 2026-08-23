export const MARKETING_CAPTURE_SCENES = [
  "library.ready",
  "reader.open",
  "reader.selected",
  "explain.grounded",
  "remember.preview",
  "review.question",
  "review.answer",
  "review.scheduled",
  "connections.context",
] as const;

export const MARKETING_CAPTURE_LAYOUTS = ["desktop", "mobile"] as const;

export type MarketingCaptureSceneId = (typeof MARKETING_CAPTURE_SCENES)[number];
export type MarketingCaptureLayout = (typeof MARKETING_CAPTURE_LAYOUTS)[number];

export interface MarketingCaptureRequest {
  fixtureId: "marketing-fixture-v2";
  sceneId: MarketingCaptureSceneId;
  layout: MarketingCaptureLayout;
  theme: "plethora-purple";
  locale: "en-US";
}

interface LocationLike {
  search: string;
  hash: string;
}

export function marketingCaptureParams(location: LocationLike): URLSearchParams {
  const params = new URLSearchParams(location.search);
  const hashQuery = location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "";
  for (const [key, value] of new URLSearchParams(hashQuery)) params.set(key, value);
  return params;
}

export function isMarketingCaptureBuildEnabled(
  environment: { DEV?: boolean; VITE_MARKETING_CAPTURE_ENABLED?: string } = import.meta.env,
): boolean {
  return environment.DEV === true || environment.VITE_MARKETING_CAPTURE_ENABLED === "1";
}

export function resolveMarketingCaptureRequest(
  location: LocationLike = window.location,
  environment: { DEV?: boolean; VITE_MARKETING_CAPTURE_ENABLED?: string } = import.meta.env,
): MarketingCaptureRequest | null {
  if (!isMarketingCaptureBuildEnabled(environment)) return null;
  const params = marketingCaptureParams(location);
  const fixtureId = params.get("fixture");
  const sceneId = params.get("scene");
  const layout = params.get("layout");
  const hasIntent = fixtureId !== null || sceneId !== null || layout !== null;
  if (!hasIntent) return null;
  if (fixtureId !== "marketing-fixture-v2") throw new Error(`Unknown marketing fixture: ${fixtureId ?? "<missing>"}`);
  if (!MARKETING_CAPTURE_SCENES.includes(sceneId as MarketingCaptureSceneId)) {
    throw new Error(`Unknown marketing scene: ${sceneId ?? "<missing>"}`);
  }
  if (!MARKETING_CAPTURE_LAYOUTS.includes(layout as MarketingCaptureLayout)) {
    throw new Error(`Unknown marketing layout: ${layout ?? "<missing>"}`);
  }
  return {
    fixtureId,
    sceneId: sceneId as MarketingCaptureSceneId,
    layout: layout as MarketingCaptureLayout,
    theme: "plethora-purple",
    locale: "en-US",
  };
}
