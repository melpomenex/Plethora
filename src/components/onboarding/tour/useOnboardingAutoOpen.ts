import { useEffect, useRef } from "react";
import {
  incrementLaunchCount,
  readOnboardingTourState,
  shouldAutoDisplay,
} from "../../../lib/onboardingTour";
import { resolveAnchor } from "./anchors";
import { TOUR_ANCHORS } from "./anchors";

/**
 * Auto-open the tour at the startup moment, gated on all six conditions
 * from design D8 / spec "Auto-display only at a safe startup moment":
 *
 * 1. Shell rendered and tour anchors mounted (one rAF after first paint,
 *    plus a check that the shell-root anchor resolves).
 * 2. No pending startup notice. The caller passes `startupNoticePending`
 *    which is true until the existing `consume_startup_notice` polling
 *    settles; this hook deliberately reuses that channel rather than
 *    adding a second poller.
 * 3. Route is the catch-all `*` (not `/auth/callback`, not
 *    `/screenshot-overlay`). Caller supplies `isCatchAllRoute`.
 * 4. No document/review deep link in the initial hash. Caller supplies
 *    `isDeepLinkedLaunch`.
 * 5. Budget available and not disabled (`!autoDisplayDisabled && launchCount < 3`).
 * 6. `!alreadyAutoOpenedThisSession` — a module-level flag, deliberately
 *    not persisted, so navigation/reload within a session doesn't re-trigger.
 *
 * Only when all six hold does this hook increment `launchCount` and call
 * `openTour()`. Ineligible sessions are a no-op against the budget.
 */
export function useOnboardingAutoOpen(opts: {
  openTour: () => void;
  startupNoticePending: boolean;
  startupNoticeSettled: boolean;
  isCatchAllRoute: boolean;
  isDeepLinkedLaunch: boolean;
  enabled?: boolean;
}): void {
  const { openTour, startupNoticePending, startupNoticeSettled, isCatchAllRoute, isDeepLinkedLaunch } = opts;
  const enabled = opts.enabled ?? true;

  // Module-level once-per-session flag. Deliberately not persisted.
  const openedThisSessionRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (openedThisSessionRef.current) return;

    // Gate 2: wait for the startup-notice channel to settle. If a notice
    // is pending, or we haven't heard back yet, this session is a no-op.
    if (!startupNoticeSettled) return;
    if (startupNoticePending) {
      // Don't consume budget; don't open. The next clean launch will try again.
      return;
    }

    // Gate 3 + 4: route conditions.
    if (!isCatchAllRoute) return;
    if (isDeepLinkedLaunch) return;

    // Gate 5: budget.
    const state = readOnboardingTourState();
    if (!shouldAutoDisplay(state)) {
      // Already exhausted or terminal — record nothing, open nothing.
      return;
    }

    // Gate 1: wait one rAF so the shell has painted and anchors are mounted,
    // then verify the shell-root anchor actually resolves.
    const raf = window.requestAnimationFrame(() => {
      if (openedThisSessionRef.current) return;
      const shellRoot = resolveAnchor([TOUR_ANCHORS.shellRoot]);
      if (!shellRoot) return;

      openedThisSessionRef.current = true;
      // Gate 6 is satisfied by the ref check above.

      // Increment at the decision point (design D6) so ineligible sessions
      // never consume budget. This call writes the incremented counter.
      incrementLaunchCount();

      openTour();
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    enabled,
    openTour,
    startupNoticePending,
    startupNoticeSettled,
    isCatchAllRoute,
    isDeepLinkedLaunch,
  ]);
}
