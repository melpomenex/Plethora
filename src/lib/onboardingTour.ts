/**
 * Guided onboarding tour — display-policy state.
 *
 * One versioned record in localStorage encodes how aggressive the tour is
 * allowed to be at startup. See
 * `openspec/changes/add-guided-onboarding-tour/specs/onboarding-display-policy/spec.md`
 * for the full policy. The invariant is: a single record, read once at
 * startup, written whole on every transition. Never partial field writes.
 *
 * Storage key: `incrementum-onboarding-tour`, registered in
 * `src/lib/localStorageSync.ts` so the record travels with the user's
 * synced settings.
 */

/** Current schema version. Bump when the record shape changes. */
export const ONBOARDING_TOUR_VERSION = 1 as const;

/** localStorage key under which the record is persisted. */
export const ONBOARDING_TOUR_STORAGE_KEY = "incrementum-onboarding-tour";

/**
 * Maximum number of *eligible* startup sessions in which the tour may
 * auto-open. Eligibility is computed by the caller (see
 * `useOnboardingAutoOpen`): a session deep-linked into a document or
 * blocked by a startup notice is a no-op against the budget.
 */
export const ONBOARDING_TOUR_LAUNCH_BUDGET = 3;

/**
 * Versioned record persisted under {@link ONBOARDING_TOUR_STORAGE_KEY}.
 *
 * `version` is typed `number` rather than the literal `ONBOARDING_TOUR_VERSION`
 * because the reader must be able to hold a record written by a *future* app
 * version (it suppresses auto-display rather than resetting it). The fresh
 * record and the writer still stamp the current literal.
 */
export type OnboardingTourState = {
  /** Schema version. Used for forward-compat suppression, not migration. */
  version: number;
  /**
   * Number of eligible startup sessions that have run the auto-open
   * decision. Incremented once per eligible launch, never on no-op
   * sessions.
   */
  launchCount: number;
  /**
   * Terminal flag: completing, explicitly skipping, or opting out all
   * set this to `true`. Once set, auto-display is permanently disabled
   * regardless of the remaining budget.
   */
  autoDisplayDisabled: boolean;
  /**
   * The step ID the user furthest reached, so a later reopening resumes
   * there rather than restarting. `null` before any progress.
   */
  furthestStepId: string | null;
  /** ISO timestamp of completion, or `null` if not completed. */
  completedAt: string | null;
};

/** Fresh-install defaults. */
export const FRESH_ONBOARDING_TOUR_STATE: OnboardingTourState = {
  version: ONBOARDING_TOUR_VERSION,
  launchCount: 0,
  autoDisplayDisabled: false,
  furthestStepId: null,
  completedAt: null,
};

/**
 * Read and harden the onboarding tour state.
 *
 * Hardening rules (spec: "Corrupt or unparseable state" + "Unknown future
 * state version"):
 * - Missing key → fresh install.
 * - Unparseable JSON → fresh install.
 * - Wrong shape or partial record → fresh install.
 * - `version` *newer* than the running app understands → keep the record
 *   intact and set `autoDisplayDisabled = true` so a downgraded client
 *   never re-onboards an existing user. Other fields are preserved as-is.
 *
 * No error is surfaced to the user on any recovery path.
 */
export function readOnboardingTourState(): OnboardingTourState {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  const raw = window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY);
  if (raw === null) {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  if (!isRecordLike(parsed)) {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  const version = parsed.version;
  if (typeof version !== "number") {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  // Unknown future version: suppress auto-display rather than reset.
  // The record's other fields are preserved untouched so re-upgrading
  // picks them back up.
  if (version > ONBOARDING_TOUR_VERSION) {
    return {
      version,
      launchCount: typeof parsed.launchCount === "number" ? parsed.launchCount : 0,
      autoDisplayDisabled: true,
      furthestStepId:
        typeof parsed.furthestStepId === "string" ? parsed.furthestStepId : null,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
    };
  }

  // Current or older version: every core field must validate, or the
  // record is corrupt, not merely stale → fresh install. A version older
  // than current is not by itself corruption — it migrates forward,
  // carrying its fields into the current shape (spec: "Older state
  // versions migrate forward without resetting the budget"). Every
  // version shipped so far shares this field set, so migration today is
  // just the version stamp; if a future bump adds a field, default it
  // here for records coming from a version that predates it.
  if (!hasValidCoreFields(parsed)) {
    return { ...FRESH_ONBOARDING_TOUR_STATE };
  }

  return {
    version: ONBOARDING_TOUR_VERSION,
    launchCount: parsed.launchCount,
    autoDisplayDisabled: parsed.autoDisplayDisabled,
    furthestStepId: parsed.furthestStepId,
    completedAt: parsed.completedAt,
  };
}

/**
 * True when `parsed` carries every core field with the right type.
 * Shared by the same-version and older-version paths in
 * {@link readOnboardingTourState}: an older version is trusted to migrate
 * only if it is otherwise well-formed, and a record failing this check is
 * corrupt regardless of its version number.
 */
function hasValidCoreFields(parsed: Record<string, unknown>): parsed is Record<string, unknown> & {
  launchCount: number;
  autoDisplayDisabled: boolean;
  furthestStepId: string | null;
  completedAt: string | null;
} {
  return (
    typeof parsed.launchCount === "number" &&
    typeof parsed.autoDisplayDisabled === "boolean" &&
    (parsed.furthestStepId === null || typeof parsed.furthestStepId === "string") &&
    (parsed.completedAt === null || typeof parsed.completedAt === "string")
  );
}

/**
 * Persist the whole record. Never write partial fields — callers build
 * the next full state and pass it here. No-ops outside the browser.
 */
export function writeOnboardingTourState(state: OnboardingTourState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  // Defence in depth: ensure the version stamp is always current when
  // the running app writes. A future version stamp is preserved on read
  // but a write always normalises to this app's version.
  const next: OnboardingTourState = { ...state, version: ONBOARDING_TOUR_VERSION };
  window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, JSON.stringify(next));
}

/**
 * Transition: increment the launch counter at the auto-open decision
 * point. Returns the new state and persists it. Idempotent within a
 * session only by convention (the auto-open hook is once-per-session);
 * this function itself just adds one.
 */
export function incrementLaunchCount(): OnboardingTourState {
  const current = readOnboardingTourState();
  // Future-version-suppressed records keep auto-display off; don't
  // touch the counter on those, the budget is moot.
  if (current.autoDisplayDisabled) {
    return current;
  }
  const next: OnboardingTourState = { ...current, launchCount: current.launchCount + 1 };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Transition: terminal — the user reached the final step and clicked
 * Done. Sets `autoDisplayDisabled` and stamps `completedAt`. Resume
 * position is cleared so a later on-demand replay starts fresh
 * (replay logic also clears this, but keep the record honest).
 */
export function markCompleted(): OnboardingTourState {
  const next: OnboardingTourState = {
    ...readOnboardingTourState(),
    autoDisplayDisabled: true,
    completedAt: new Date().toISOString(),
    furthestStepId: null,
  };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Transition: terminal — explicit "Skip tour" / "Don't show again".
 * Disables auto-display permanently without recording completion.
 * Does not clear resume position (irrelevant but harmless).
 */
export function markSkipped(): OnboardingTourState {
  const next: OnboardingTourState = {
    ...readOnboardingTourState(),
    autoDisplayDisabled: true,
  };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Transition: terminal — "Don't show this again" affordance. Functionally
 * identical to {@link markSkipped}; the separate name documents intent.
 */
export function markOptedOut(): OnboardingTourState {
  return markSkipped();
}

/**
 * Transition: soft — `Esc` or overlay click. Saves the resume position
 * so the next eligible launch continues there, but leaves the budget
 * (consumed at the auto-open gate, not here) and the terminal flag
 * untouched. Spec: "Soft dismissal keeps the remaining budget".
 */
export function markDismissed(stepId?: string | null): OnboardingTourState {
  const current = readOnboardingTourState();
  const next: OnboardingTourState = {
    ...current,
    furthestStepId: stepId ?? current.furthestStepId,
  };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Transition: persist the furthest step reached. Called as the user
 * advances through steps so the resume position tracks progress even
 * if the tab is closed without an explicit dismissal path.
 */
export function recordResumePosition(stepId: string): OnboardingTourState {
  const current = readOnboardingTourState();
  // Never advance the resume pointer past a terminal state.
  if (current.autoDisplayDisabled) return current;
  const next: OnboardingTourState = { ...current, furthestStepId: stepId };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Transition: clear all onboarding state. Used by the "Reset
 * onboarding" affordance in Settings and by tests. After reset, the
 * next eligible launch behaves like a fresh install.
 */
export function resetOnboardingState(): OnboardingTourState {
  const next: OnboardingTourState = { ...FRESH_ONBOARDING_TOUR_STATE };
  writeOnboardingTourState(next);
  return next;
}

/**
 * Convenience predicate: should the tour auto-open at startup, given
 * the current state? Excludes the once-per-session flag, which is the
 * caller's responsibility (it's deliberately not persisted).
 */
export function shouldAutoDisplay(state: OnboardingTourState): boolean {
  if (state.autoDisplayDisabled) return false;
  return state.launchCount < ONBOARDING_TOUR_LAUNCH_BUDGET;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
