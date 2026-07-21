/**
 * Guided onboarding tour — anchor catalogue.
 *
 * Single source of truth for every `data-tour="<id>"` attribute the tour can
 * target. Step definitions (`./steps.ts`) may only reference IDs from
 * `TOUR_ANCHORS`, so the reference side is compile-checked. The presence side
 * is enforced by `__tests__/anchors.test.tsx`, which renders the shell and
 * asserts that every non-optional anchor resolves.
 *
 * Why a frozen catalogue instead of free-form CSS selectors: the previous
 * `data-tutorial` attribute demonstrates the failure mode — one anchor was
 * added, the tutorial referenced five, and nothing complained. See design D3
 * in `openspec/changes/add-guided-onboarding-tour/design.md`.
 */

/**
 * Authoritative map of anchor key → `data-tour` attribute value.
 *
 * The key is the symbol used in step definitions; the value is the literal
 * string that appears in the DOM. Keeping them parallel but distinct means a
 * rename in code never silently desyncs from a typo in markup.
 */
export const TOUR_ANCHORS = {
  // Shell + navigation (desktop)
  shellRoot: "shell-root",
  navDashboard: "nav-dashboard",
  navDocuments: "nav-documents",
  navQueue: "nav-queue",
  navReview: "nav-review",
  navAnalytics: "nav-analytics",
  navKnowledgeSphere: "nav-knowledge-sphere",
  navSettings: "nav-settings",
  navImportFile: "nav-import-file",
  navImportUrl: "nav-import-url",
  workspaceSwitcher: "workspace-switcher",
  themeControl: "theme-control",
  commandPalette: "command-palette",

  // Mobile-shell navigation. Steps declare `[desktop, mobile]` candidates so
  // one definition resolves on both viewports.
  mobileNavDashboard: "mobile-nav-dashboard",
  mobileNavDocuments: "mobile-nav-documents",
  mobileNavQueue: "mobile-nav-queue",
  mobileNavReview: "mobile-nav-review",
  mobileNavSettings: "mobile-nav-settings",
  mobileWorkspaceSwitcher: "mobile-workspace-switcher",
  mobileCommandPalette: "mobile-command-palette",

  // Documents / import
  documentsImportButton: "documents-import-button",
  documentsGrid: "documents-grid",
  documentsImportUrl: "documents-import-url",

  // Reader / extracts
  readerRoot: "reader-root",
  readerExtractAction: "reader-extract-action",
  readerExtractsPanel: "reader-extracts-panel",

  // Queue
  queueControls: "queue-controls",
  queueStartSession: "queue-start-session",

  // Review
  reviewGradingControls: "review-grading-controls",
  reviewAlgorithmSetting: "review-algorithm-setting",

  // Settings
  settingsHelpReplayTour: "settings-help-replay-tour",
  settingsHelpResetOnboarding: "settings-help-reset-onboarding",
} as const;

/** Union of all anchor keys. */
export type TourAnchorKey = keyof typeof TOUR_ANCHORS;

/** Literal anchor ID string used in the DOM (`data-tour` value). */
export type TourAnchorId = (typeof TOUR_ANCHORS)[TourAnchorKey];

/**
 * Spread onto an element to mark it as a tour anchor.
 *
 *   <button {...tourAnchor("nav-queue")}>…</button>
 *
 * Prefer the typed `TourAnchorKey` overload so renames flow through the
 * compiler. The string overload exists for the rare case where the value is
 * computed (and is still checked against the catalogue at runtime in dev).
 */
export function tourAnchor(key: TourAnchorKey): { "data-tour": TourAnchorId };
export function tourAnchor(id: TourAnchorId): { "data-tour": TourAnchorId };
export function tourAnchor(key: TourAnchorKey | TourAnchorId): { "data-tour": TourAnchorId } {
  const id = (TOUR_ANCHORS as Record<string, TourAnchorId>)[key as string] ?? (key as TourAnchorId);
  return { "data-tour": id };
}

/**
 * Normalise a step's anchor declaration to a flat candidate list. Steps may
 * declare one ID or an ordered list; this returns the candidates in the
 * order the tour should try them.
 */
export function candidatesFromAnchor(anchor: TourAnchorId | TourAnchorId[]): TourAnchorId[] {
  return Array.isArray(anchor) ? anchor : [anchor];
}

/**
 * Resolve a step's candidate anchors to the element to spotlight.
 *
 * Resolution rule (spec: "Adaptive and resilient anchor resolution"):
 * the first candidate whose element is present in the DOM, has a non-zero
 * bounding box, and is not `visibility: hidden`. A collapsed sidebar item
 * is in the DOM with zero width and must not resolve.
 *
 * Returns the matched element, or `null` when no candidate resolves. The
 * caller (centred-card fallback) decides what to do with `null`.
 */
export function resolveAnchor(candidates: TourAnchorId[]): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const candidate of candidates) {
    const node = document.querySelector<HTMLElement>(`[data-tour="${cssEscape(candidate)}"]`);
    if (!node) continue;
    if (!isVisuallyPresent(node)) continue;
    return node;
  }
  return null;
}

/**
 * True when an element occupies any pixels on screen right now: present in
 * the DOM, has a non-zero bounding box, and is not hidden via `visibility`.
 * `display: none` and ancestor `display: none` both produce a zero box, so
 * the rect check subsumes them.
 */
export function isVisuallyPresent(el: HTMLElement): boolean {
  if (typeof window === "undefined") return false;
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // `visibility: hidden` leaves layout intact but the element is not seen.
  // Walking ancestors catches a hidden parent (e.g. a collapsed pane).
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const style = window.getComputedStyle(n);
    if (style.visibility === "hidden") return false;
    if (style.display === "none") return false;
  }
  return true;
}

// CSS.escape is available in all target webviews but is unavailable in some
// test environments without a layout engine; fall back to a conservative
// escaping that handles the characters we actually use (hyphens, alphanumerics).
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
