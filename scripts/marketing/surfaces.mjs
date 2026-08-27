/**
 * Surfaces required for indexed launch (design: library, reader+extract, explain,
 * card, review, desktop collage, iOS frame, Android frame). E-ink may stay
 * placeholder without blocking.
 */
export const REQUIRED_ASSET_IDS = [
  "screenshot-library",
  "screenshot-reader",
  "screenshot-explain",
  "screenshot-card",
  "screenshot-review",
  "screenshot-desktop-collage",
  "screenshot-ios-frame",
  "screenshot-android-frame",
];

export const OPTIONAL_ASSET_IDS = ["screenshot-eink"];

export const STORY_ID = "memory-sleep-cognition";

export const PLACEHOLDER_BUILD_ID = "placeholder-unreleased";

/** @typedef {{ id: string, kind: string, surface: string, platform: string, viewport: string, theme: 'light'|'dark'|'eink', width: number, height: number, alt: string, required: boolean }} CaptureSpec */

/**
 * Capture-request note (refine-useplethora-visual-product-storytelling D11):
 * the website hero renders the mobile capture up to ~20rem (320 CSS px), so
 * at DPR 2 the 390-wide source upscales ~1.64x and reads soft. The next
 * capture run SHOULD raise the five iphone specs to a 480x1039 CSS viewport
 * (sourceType: playwright-css-viewport) and regenerate the manifest;
 * encode-product-images.mjs already emits both 390 and 480 variants for
 * such a set without changing the current one.
 */
/** @type {CaptureSpec[]} */
export const CAPTURE_SPECS = [
  {
    id: "screenshot-library",
    kind: "screenshot",
    surface: "library",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "light",
    width: 390,
    height: 844,
    alt: "Plethora library showing the memory, sleep, and learning demo shelf: document, lecture, methods PDF, and James excerpt.",
    required: true,
  },
  {
    id: "screenshot-reader",
    kind: "screenshot",
    surface: "reader",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "light",
    width: 390,
    height: 844,
    alt: "Reader open on the highlighting document with a passage extract queued for encoding.",
    required: true,
  },
  {
    id: "screenshot-explain",
    kind: "screenshot",
    surface: "explain",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "light",
    width: 390,
    height: 844,
    alt: "Grounded explanation of encoding versus recognition, citing the open demo passage.",
    required: true,
  },
  {
    id: "screenshot-card",
    kind: "screenshot",
    surface: "card",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "light",
    width: 390,
    height: 844,
    alt: "Flashcard from the demo deck: why highlighting fails as encoding.",
    required: true,
  },
  {
    id: "screenshot-review",
    kind: "screenshot",
    surface: "review",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "light",
    width: 390,
    height: 844,
    alt: "Review session rating a sleep-and-memory card after a spaced gap.",
    required: true,
  },
  {
    id: "screenshot-desktop-collage",
    kind: "device-frame",
    surface: "desktop-collage",
    platform: "desktop",
    viewport: "desktop-1440x900",
    theme: "light",
    width: 1440,
    height: 900,
    alt: "Desktop Plethora window with the demo library and reader side by side.",
    required: true,
  },
  {
    id: "screenshot-ios-frame",
    kind: "device-frame",
    surface: "ios-frame",
    platform: "iphone",
    viewport: "iphone-14-pro-430x932",
    theme: "light",
    width: 430,
    height: 932,
    alt: "iPhone frame of Plethora showing the memory-and-sleep library.",
    required: true,
  },
  {
    id: "screenshot-android-frame",
    kind: "device-frame",
    surface: "android-frame",
    platform: "android",
    viewport: "android-412x915",
    theme: "light",
    width: 412,
    height: 915,
    alt: "Android frame of Plethora showing the same demo library.",
    required: true,
  },
  {
    id: "screenshot-eink",
    kind: "screenshot",
    surface: "eink-reader",
    platform: "iphone",
    viewport: "iphone-14-390x844",
    theme: "eink",
    width: 390,
    height: 844,
    alt: "E-ink display mode reading the James public-domain excerpt.",
    required: false,
  },
  {
    id: "og-default",
    kind: "og",
    surface: "og",
    platform: "web",
    viewport: "og-1200x630",
    theme: "light",
    width: 1200,
    height: 630,
    alt: "Open Graph card: Everything you read. Remembered. Memory, sleep, and learning story.",
    required: false,
  },
];

export function captureBuildId() {
  return process.env.MARKETING_BUILD_ID || PLACEHOLDER_BUILD_ID;
}

export function sourcePngName(spec, buildId = captureBuildId()) {
  return `${spec.surface}_${spec.platform}_${spec.viewport}_${spec.theme}_${buildId}.png`;
}

export function publicStem(spec) {
  return spec.id;
}
