import type { TourAnchorId } from "./anchors";
import type { TourPlacement } from "./placement";

/**
 * Which of the three motion tiers a step uses for its micro-animation.
 * `none` keeps the card static. See design D10.
 */
export type TourAnimationKind = "none" | "card" | "lift" | "pulse";

/**
 * A single tour step. Steps live inside chapters (see {@link TourChapter}).
 *
 * Anchor handling (spec: "Adaptive and resilient anchor resolution"):
 * - `anchor?: TourAnchorId | TourAnchorId[]` — one ID or an ordered candidate
 *   list. The first candidate that resolves (present, visible, non-zero box)
 *   wins.
 * - `requiresAnchor?: boolean` — when true and no candidate resolves, the
 *   step is excluded entirely from navigation and from the displayed total.
 *   When false (the default), the step degrades to a centred card.
 *
 * The step's title and body are i18n keys, not literal strings, so the tour
 * ships in every supported locale.
 */
export interface TourStep {
  /** Stable id, also used as the resume position token. */
  id: string;
  /** i18n key for the step title (rendered as the dialog accessible name). */
  titleKey: string;
  /** i18n key for the step body. May be a paragraph or two. */
  bodyKey: string;
  /** Candidate anchor(s). Omit for an intentionally centred-card step. */
  anchor?: TourAnchorId | TourAnchorId[];
  /**
   * True when the step is meaningless without its anchor and should be
   * skipped rather than rendered as a centred card. Defaults to false.
   */
  requiresAnchor?: boolean;
  /** Preferred coach-mark placement. Defaults to `auto`. */
  placement?: TourPlacement;
  /** Optional CSS-driven micro-animation kind. Defaults to `none`. */
  animation?: TourAnimationKind;
  /**
   * Optional view target the tour should navigate to before resolving the
   * anchor. The engine records the prior view/tab and restores it on close
   * (spec: "Navigation during the tour is non-destructive").
   */
  navigateToView?: TourViewTarget;
}

/**
 * A logical group of steps shown as a single entry in the chapter rail.
 */
export interface TourChapter {
  /** Stable id. */
  id: string;
  /** i18n key for the short chapter label in the rail. */
  labelKey: string;
  /** The steps in this chapter, in order. */
  steps: TourStep[];
}

/**
 * View target used by steps that need to navigate the app to their subject
 * before resolving the anchor. The engine dispatches the matching event or
 * calls the matching setter; how it actually opens the view is the host's
 * concern, not the tour's. Kept here so step definitions stay declarative.
 */
export type TourViewTarget =
  | { kind: "tab"; tabType: string }
  | { kind: "event"; eventName: string };

/** Flatten chapters into an ordered step list. */
export function flattenSteps(chapters: TourChapter[]): TourStep[] {
  return chapters.flatMap((c) => c.steps);
}

/** Find the chapter that contains a given step id. */
export function chapterForStep(
  chapters: TourChapter[],
  stepId: string,
): TourChapter | null {
  for (const chapter of chapters) {
    if (chapter.steps.some((s) => s.id === stepId)) return chapter;
  }
  return null;
}
