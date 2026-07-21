import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  candidatesFromAnchor,
  resolveAnchor,
  type TourAnchorId,
} from "./anchors";
import {
  flattenSteps,
  type TourChapter,
  type TourStep,
  type TourViewTarget,
} from "./types";
import {
  markCompleted,
  markDismissed,
  markSkipped,
  readOnboardingTourState,
  recordResumePosition,
  writeOnboardingTourState,
} from "../../../lib/onboardingTour";

export type TourCloseReason = "done" | "skip" | "dismiss" | "manual";

/**
 * Navigation adapter — the host (MainLayout) wires this so the tour engine
 * stays free of any direct dependency on the tabs store or view-write APIs.
 *
 * The engine calls `captureView()` once at open, `navigateTo(target)` when a
 * step declares a view target, and `restoreView(snapshot)` on close. The
 * snapshot is opaque to the engine.
 *
 * This is the seam that lets task 4.8 ("no data mutation") hold: the tour
 * module itself imports no document, extract, queue, scheduling, or tab-store
 * write API. The adapter is the host's contract.
 */
export interface TourNavigationAdapter {
  captureView?: () => unknown;
  restoreView?: (snapshot: unknown) => void;
  navigateTo?: (target: TourViewTarget) => void;
}

/**
 * Return value of {@link useOnboardingTour}. The host component owns the
 * rendering; this hook owns all state and transitions.
 */
export interface OnboardingTourApi {
  /** True when the overlay should be mounted. */
  open: boolean;
  /** The active step definition, or null when closed. */
  currentStep: TourStep | null;
  /** Zero-based index into the resolved step list. */
  currentIndex: number;
  /** Total number of resolvable steps in the active definition. */
  totalSteps: number;
  /** Chapters (for the rail). */
  chapters: TourChapter[];
  /** Index of the chapter the current step belongs to. */
  currentChapterIndex: number;
  /** Whether the current step is the first resolvable one. */
  isFirstStep: boolean;
  /** Whether the current step is the last resolvable one. */
  isLastStep: boolean;
  /** Candidate anchor IDs for the current step (empty array for centred cards). */
  currentCandidates: TourAnchorId[];
  /** The furthest step index the user has reached in this open session. */
  furthestIndex: number;

  /** Open the tour. `reset` restarts at step 1 and clears saved progress. */
  openTour: (opts?: { reset?: boolean }) => void;
  /** Advance to the next resolvable step. No-op on the last step. */
  next: () => void;
  /** Return to the previous resolvable step. No-op on the first step. */
  back: () => void;
  /** Jump to the first step of a chapter. */
  jumpToChapter: (chapterIndex: number) => void;
  /** Close the tour. */
  close: (reason: TourCloseReason) => void;
}

/**
 * Tour engine hook.
 *
 * Responsibilities (spec: onboarding-tour):
 * - Hold open state and the current step.
 * - Resolve the step list: steps whose `requiresAnchor` is true and whose
 *   candidates do not resolve are excluded from navigation and from the
 *   displayed total (spec: "Optional step is skipped").
 * - Navigation: Next/Back plus keyboard (`→`/`Enter`/`←`), Back disabled on
 *   the first step, Done on the last step marking complete.
 * - Close paths: Esc/overlay-click are soft (dismissal); "Skip tour" and
 *   "Don't show again" are terminal; Done is terminal+completed. No
 *   confirmation prompts.
 * - Resume: persist the furthest step reached on close; reopening resumes
 *   there. A completed tour restarts at step 1. A stored step id absent
 *   from the current definition falls back to step 1.
 * - Non-destructive view navigation: record the active tab/view before a
 *   step navigates, restore on close.
 */
export function useOnboardingTour(
  chapters: TourChapter[],
  adapter: TourNavigationAdapter = {},
): OnboardingTourApi {
  // The full step list, in order, before anchor-resolution filtering.
  const allSteps = useMemo(() => flattenSteps(chapters), [chapters]);

  // The resolvable step list: drop `requiresAnchor` steps whose anchors are
  // absent on the current viewport. Recomputed on every render so a viewport
  // change between sessions re-evaluates; the open-time copy is captured
  // below so a single open uses a stable list.
  const resolvableSteps = useMemo(() => {
    return allSteps.filter((step) => {
      if (!step.requiresAnchor) return true;
      const candidates = step.anchor ? candidatesFromAnchor(step.anchor) : [];
      return resolveAnchor(candidates) !== null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSteps]);

  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [furthestIndex, setFurthestIndex] = useState(0);

  // Snapshot of resolvable steps captured at open time so navigation during
  // a single session is against a stable list.
  const sessionStepsRef = useRef<TourStep[]>([]);
  // Recorded view state so we can restore it when the tour closes. Opaque to
  // this hook — the host wires the actual capture/restore via the adapter.
  const savedViewStateRef = useRef<unknown>(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const sessionSteps = open ? sessionStepsRef.current : resolvableSteps;
  const currentStep = open ? sessionSteps[currentIndex] ?? null : null;
  const totalSteps = sessionSteps.length;

  const currentChapterIndex = useMemo(() => {
    if (!currentStep) return -1;
    return chapters.findIndex((c) => c.steps.some((s) => s.id === currentStep.id));
  }, [chapters, currentStep]);

  const currentCandidates: TourAnchorId[] = useMemo(() => {
    if (!currentStep?.anchor) return [];
    return candidatesFromAnchor(currentStep.anchor);
  }, [currentStep]);

  // Persist the resume position as the user advances (spec: "Resume from
  // last position"). Soft-save only — never sets the terminal flag.
  useEffect(() => {
    if (!open || !currentStep) return;
    recordResumePosition(currentStep.id);
    setFurthestIndex((prev) => Math.max(prev, currentIndex));
  }, [open, currentStep, currentIndex]);

  // Non-destructive view navigation: when a step declares a view target,
  // dispatch it through the adapter. The "before" state was captured at open
  // time; restoration happens on close.
  useEffect(() => {
    if (!open || !currentStep?.navigateToView) return;
    adapterRef.current.navigateTo?.(currentStep.navigateToView);
    // Re-run only when the step id changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStep?.id]);

  const openTour = useCallback(
    (opts?: { reset?: boolean }) => {
      // Snapshot the resolvable list at open time so the session navigates
      // against a stable set even if the viewport changes mid-tour.
      sessionStepsRef.current = resolvableSteps;

      if (opts?.reset) {
        // Manual replay: clear saved progress so we start from step 1, but
        // deliberately leave launchCount/autoDisplayDisabled untouched
        // (spec: "On-demand opening does not change auto-display state").
        const state = readOnboardingTourState();
        writeOnboardingTourState({ ...state, furthestStepId: null });
      }

      // Compute the starting index from the stored resume position.
      let startIndex = 0;
      if (!opts?.reset) {
        const state = readOnboardingTourState();
        if (state.completedAt) {
          // Completed tour restarts from the beginning (spec).
          startIndex = 0;
        } else if (state.furthestStepId) {
          const idx = resolvableSteps.findIndex((s) => s.id === state.furthestStepId);
          // Stored step absent from the current definition → fall back to 0.
          startIndex = idx >= 0 ? idx : 0;
        }
      }

      // Record pre-tour view state so we can restore on close.
      savedViewStateRef.current = adapterRef.current.captureView?.() ?? null;

      setCurrentIndex(startIndex);
      setFurthestIndex(startIndex);
      setOpen(true);
    },
    [resolvableSteps],
  );

  const next = useCallback(() => {
    setCurrentIndex((idx) => {
      if (idx >= sessionStepsRef.current.length - 1) return idx;
      return idx + 1;
    });
  }, []);

  const back = useCallback(() => {
    setCurrentIndex((idx) => {
      if (idx <= 0) return 0;
      return idx - 1;
    });
  }, []);

  const jumpToChapter = useCallback(
    (chapterIndex: number) => {
      const chapter = chapters[chapterIndex];
      if (!chapter) return;
      // Find the first step in this chapter that survived anchor resolution
      // and is therefore in the session list. A chapter whose first step
      // was filtered out must still land on a real step.
      for (const step of chapter.steps) {
        const idx = sessionStepsRef.current.findIndex((s) => s.id === step.id);
        if (idx >= 0) {
          setCurrentIndex(idx);
          return;
        }
      }
    },
    [chapters],
  );

  const close = useCallback(
    (reason: TourCloseReason) => {
      if (!open) return;
      const step = sessionStepsRef.current[currentIndex] ?? null;
      switch (reason) {
        case "done":
          markCompleted();
          break;
        case "skip":
          markSkipped();
          break;
        case "dismiss":
          // Soft dismissal — saves resume position, keeps the budget intact.
          markDismissed(step?.id ?? null);
          break;
        case "manual":
          // Host-initiated close without changing policy. Used by the auto-open
          // gate when it needs to bail out (e.g. user navigated away mid-open).
          break;
      }
      // Restore the view state captured at open, if any.
      adapterRef.current.restoreView?.(savedViewStateRef.current);
      savedViewStateRef.current = null;

      setOpen(false);
    },
    [open, currentIndex],
  );

  // Keyboard navigation: →/Enter = next, ← = back. Escape is handled by the
  // overlay (it routes to close("dismiss")). Capture so we beat app shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        // Don't hijack Enter when focus is on a button we don't own (e.g.
        // the Back/Next buttons themselves — let their click fire normally).
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === "BUTTON" && !target.dataset.tourKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (currentIndex >= sessionStepsRef.current.length - 1) {
          close("done");
        } else {
          next();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, currentIndex, next, back, close]);

  return {
    open,
    currentStep,
    currentIndex,
    totalSteps,
    chapters,
    currentChapterIndex,
    isFirstStep: currentIndex <= 0,
    isLastStep: currentIndex >= totalSteps - 1,
    currentCandidates,
    furthestIndex,
    openTour,
    next,
    back,
    jumpToChapter,
    close,
  };
}
