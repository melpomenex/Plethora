/**
 * Persisted Zustand store for Optional Motivational Systems (`plethora.motivation.v1`).
 *
 * Manages independently disableable `preferences`, the idempotent `xpLedger`,
 * personal `milestones`, activity metrics, and `recordLearningActivityForMotivation`
 * which can subscribe to `learningEventBus`.
 *
 * Strictly non-coercive and never modifies or inflates mastery/competency state.
 */

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { subscribeLearningEvents } from "../lib/learning-events/learningEventBus";
import type { LearningEvent } from "../types/learningEvent";
import {
  DEFAULT_MOTIVATION_PREFERENCES,
  EMPTY_ACTIVITY_METRICS,
  EMPTY_XP_LEDGER,
  awardXpIdempotent,
  computeRestDaySafeStreak,
  evaluateMilestonesAndTargets,
  mapLearningEventToXpInput,
  type ActivityMetricsSummary,
  type AwardXpInput,
  type AwardXpResult,
  type MotivationEvaluationResult,
  type MotivationMilestone,
  type MotivationPreferences,
  type OutcomeMetricsSummary,
  type StreakComputationResult,
  type XpLedgerState,
} from "../lib/motivation/motivationEngine";

export const MOTIVATION_STORAGE_KEY = "plethora.motivation.v1" as const;

function createSafeLocalStorage(): StateStorage {
  const memoryFallback = new Map<string, string>();
  return {
    getItem(name: string): string | null {
      try {
        if (
          typeof globalThis !== "undefined" &&
          "localStorage" in globalThis &&
          globalThis.localStorage
        ) {
          return globalThis.localStorage.getItem(name);
        }
      } catch {
        // Fall through to in-memory storage
      }
      return memoryFallback.get(name) ?? null;
    },
    setItem(name: string, value: string): void {
      try {
        if (
          typeof globalThis !== "undefined" &&
          "localStorage" in globalThis &&
          globalThis.localStorage
        ) {
          globalThis.localStorage.setItem(name, value);
          return;
        }
      } catch {
        // Fall through to in-memory storage
      }
      memoryFallback.set(name, value);
    },
    removeItem(name: string): void {
      try {
        if (
          typeof globalThis !== "undefined" &&
          "localStorage" in globalThis &&
          globalThis.localStorage
        ) {
          globalThis.localStorage.removeItem(name);
          return;
        }
      } catch {
        // Fall through to in-memory storage
      }
      memoryFallback.delete(name);
    },
  };
}

export interface MotivationStoreState {
  preferences: MotivationPreferences;
  xpLedger: XpLedgerState;
  milestones: MotivationMilestone[];
  activeDates: string[];
  activitySummary: ActivityMetricsSummary;
  /** Event IDs already processed into activity counters for idempotency. */
  processedEventIds: Record<string, true>;
  isSubscribed: boolean;

  updatePreferences: (patch: Partial<MotivationPreferences>) => void;
  setEnabled: (enabled: boolean) => void;
  setXpEnabled: (enabled: boolean) => void;
  setStreaksEnabled: (enabled: boolean) => void;
  setMilestonesEnabled: (enabled: boolean) => void;
  setTargetsEnabled: (enabled: boolean) => void;
  setCelebrationsEnabled: (enabled: boolean) => void;

  awardXp: (input: AwardXpInput) => AwardXpResult;
  recordLearningActivityForMotivation: (event: LearningEvent) => void;
  getStreak: (todayIso?: string) => StreakComputationResult | null;
  evaluateProgress: (
    outcomeSummary: OutcomeMetricsSummary,
    options?: {
      dailyMinutesCurrent?: number;
      weeklyMinutesCurrent?: number;
      nowIso?: string;
    },
  ) => MotivationEvaluationResult;

  connectLearningEventBus: () => () => void;
  reset: () => void;
}

let activeBusUnsubscribe: (() => void) | null = null;

function extractDateKey(iso: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  if (match) return match[1];
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

export const useMotivationStore = create<MotivationStoreState>()(
  persist(
    (set, get) => ({
      preferences: { ...DEFAULT_MOTIVATION_PREFERENCES },
      xpLedger: { ...EMPTY_XP_LEDGER, entries: [], byKey: {} },
      milestones: [],
      activeDates: [],
      activitySummary: { ...EMPTY_ACTIVITY_METRICS },
      processedEventIds: {},
      isSubscribed: false,

      updatePreferences: (patch) => {
        set((state) => ({
          preferences: {
            ...state.preferences,
            ...patch,
          },
        }));
      },

      setEnabled: (enabled) => {
        set((state) => ({
          preferences: { ...state.preferences, enabled },
        }));
      },

      setXpEnabled: (xpEnabled) => {
        set((state) => ({
          preferences: { ...state.preferences, xpEnabled },
        }));
      },

      setStreaksEnabled: (streaksEnabled) => {
        set((state) => ({
          preferences: { ...state.preferences, streaksEnabled },
        }));
      },

      setMilestonesEnabled: (milestonesEnabled) => {
        set((state) => ({
          preferences: { ...state.preferences, milestonesEnabled },
        }));
      },

      setTargetsEnabled: (targetsEnabled) => {
        set((state) => ({
          preferences: { ...state.preferences, targetsEnabled },
        }));
      },

      setCelebrationsEnabled: (celebrationsEnabled) => {
        set((state) => ({
          preferences: { ...state.preferences, celebrationsEnabled },
        }));
      },

      awardXp: (input) => {
        const state = get();
        if (!state.preferences.enabled || !state.preferences.xpEnabled) {
          return {
            ledger: state.xpLedger,
            entry: null,
            awarded: false,
            xpDelta: 0,
            reason: "zero_effort_or_spam",
          };
        }
        const result = awardXpIdempotent(state.xpLedger, input);
        if (result.awarded) {
          set((prev) => ({
            xpLedger: result.ledger,
            activitySummary: {
              ...prev.activitySummary,
              xpEarned: result.ledger.totalXp,
            },
          }));
        }
        return result;
      },

      recordLearningActivityForMotivation: (event) => {
        const state = get();
        // Zero-cost no-op when motivation is globally disabled
        if (!state.preferences.enabled) {
          return;
        }
        if (event.retractedByEventId !== null) {
          return;
        }
        if (state.processedEventIds[event.id]) {
          return;
        }

        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const isSpam = Boolean(payload.isSpam);
        const completed = payload.completed === undefined ? true : Boolean(payload.completed);
        if (isSpam || !completed) {
          return;
        }

        // Update XP idempotently if xpEnabled
        let nextLedger = state.xpLedger;
        if (state.preferences.xpEnabled) {
          const xpInput = mapLearningEventToXpInput(event);
          if (xpInput) {
            const xpResult = awardXpIdempotent(state.xpLedger, xpInput);
            nextLedger = xpResult.ledger;
          }
        }

        // Update Activity Metrics (strictly effort/activity, never mastery outcomes)
        const nextActivity: ActivityMetricsSummary = {
          ...state.activitySummary,
          xpEarned: nextLedger.totalXp,
        };

        const durationMs =
          typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
            ? Math.max(0, payload.durationMs)
            : 0;
        if (durationMs > 0) {
          nextActivity.minutesStudied += durationMs / 60_000;
        }

        const pagesDelta =
          typeof payload.pagesRead === "number" && Number.isFinite(payload.pagesRead)
            ? Math.max(0, payload.pagesRead)
            : 0;
        if (pagesDelta > 0) {
          nextActivity.pagesRead += pagesDelta;
        }

        switch (event.eventType) {
          case "review_committed":
            nextActivity.reviewsCompleted += 1;
            break;
          case "practice_attempted":
          case "guided_check_completed":
          case "remediation_completed":
            nextActivity.exercisesCompleted += 1;
            break;
          case "assessment_submitted":
            nextActivity.examsTaken += 1;
            break;
          default:
            break;
        }

        // Record active date for rest-day-safe streak computation
        const dateKey = extractDateKey(event.occurredAt);
        const nextActiveDates =
          dateKey && !state.activeDates.includes(dateKey)
            ? [...state.activeDates, dateKey].sort()
            : state.activeDates;

        set((prev) => ({
          xpLedger: nextLedger,
          activitySummary: nextActivity,
          activeDates: nextActiveDates,
          processedEventIds: {
            ...prev.processedEventIds,
            [event.id]: true,
          },
        }));
      },

      getStreak: (todayIso = new Date().toISOString()) => {
        const state = get();
        if (!state.preferences.enabled || !state.preferences.streaksEnabled) {
          return null;
        }
        return computeRestDaySafeStreak(
          state.activeDates,
          state.preferences.restDaysMask,
          state.preferences.streakGraceDaysPerWeek,
          todayIso,
        );
      },

      evaluateProgress: (outcomeSummary, options) => {
        const state = get();
        const evaluation = evaluateMilestonesAndTargets(
          state.preferences,
          state.activitySummary,
          outcomeSummary,
          state.milestones,
          options,
        );
        if (
          state.preferences.enabled &&
          state.preferences.milestonesEnabled &&
          (evaluation.newlyAchievedMilestones.length > 0 ||
            evaluation.revokedMilestoneKeys.length > 0)
        ) {
          set({ milestones: evaluation.milestones });
        }
        return evaluation;
      },

      connectLearningEventBus: () => {
        if (activeBusUnsubscribe) {
          return activeBusUnsubscribe;
        }
        const unsubscribe = subscribeLearningEvents(null, (event) => {
          get().recordLearningActivityForMotivation(event);
        });
        activeBusUnsubscribe = () => {
          unsubscribe();
          activeBusUnsubscribe = null;
          set({ isSubscribed: false });
        };
        set({ isSubscribed: true });
        return activeBusUnsubscribe;
      },

      reset: () => {
        if (activeBusUnsubscribe) {
          activeBusUnsubscribe();
        }
        set({
          preferences: { ...DEFAULT_MOTIVATION_PREFERENCES },
          xpLedger: { entries: [], byKey: {}, totalXp: 0 },
          milestones: [],
          activeDates: [],
          activitySummary: { ...EMPTY_ACTIVITY_METRICS },
          processedEventIds: {},
          isSubscribed: false,
        });
      },
    }),
    {
      name: MOTIVATION_STORAGE_KEY,
      storage: createJSONStorage(createSafeLocalStorage),
      partialize: (state) => ({
        preferences: state.preferences,
        xpLedger: state.xpLedger,
        milestones: state.milestones,
        activeDates: state.activeDates,
        activitySummary: state.activitySummary,
        processedEventIds: state.processedEventIds,
      }),
    },
  ),
);
