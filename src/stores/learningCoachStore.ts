/**
 * Persisted Zustand store for the Personal Learning Coach (`plethora.learningCoach.v1`).
 *
 * Manages coaching preferences (`proactivity`, `enabledCategories`, `quietHours`,
 * `aiExplanationsEnabled`), per-signal and per-category `dismissals` (with snooze
 * support), and cached `recommendations`.
 *
 * Strictly non-mutating: never writes to canonical learning domain stores.
 */

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  DEFAULT_COACH_ENABLED_CATEGORIES,
  DEFAULT_COACH_PREFERENCES,
  detectCoachingOpportunities,
  type CoachDismissal,
  type CoachPreferences,
  type CoachProactivityLevel,
  type CoachQuietHours,
  type CoachSnapshot,
  type CoachingRecommendation,
  type CoachingSignalType,
} from "../lib/learning-coach/coachEngine";

export const LEARNING_COACH_STORAGE_KEY = "plethora.learningCoach.v1" as const;

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

export interface LearningCoachStoreState {
  proactivity: CoachProactivityLevel;
  enabledCategories: Record<CoachingSignalType, boolean>;
  aiExplanationsEnabled: boolean;
  quietHours: CoachQuietHours;
  dismissals: CoachDismissal[];
  recommendations: CoachingRecommendation[];
  lastEvaluatedAt: string | null;

  setProactivity: (level: CoachProactivityLevel) => void;
  setCategoryEnabled: (category: CoachingSignalType, enabled: boolean) => void;
  setAiExplanationsEnabled: (enabled: boolean) => void;
  setQuietHours: (quietHours: Partial<CoachQuietHours>) => void;

  /** Evaluates opportunities deterministically and caches the resulting recommendations. */
  evaluateOpportunities: (
    snapshot: CoachSnapshot,
    nowIso?: string,
  ) => CoachingRecommendation[];

  dismissSignal: (signalId: string, reason?: string, nowIso?: string) => void;
  snoozeSignal: (
    signalId: string,
    snoozeUntilIso: string,
    reason?: string,
    nowIso?: string,
  ) => void;
  dismissCategory: (
    signalType: CoachingSignalType,
    reason?: string,
    nowIso?: string,
  ) => void;
  snoozeCategory: (
    signalType: CoachingSignalType,
    snoozeUntilIso: string,
    reason?: string,
    nowIso?: string,
  ) => void;
  pruneExpiredDismissals: (nowIso?: string) => void;
  clearDismissals: () => void;
  clearRecommendations: () => void;
  reset: () => void;
}

function buildPreferences(state: LearningCoachStoreState): CoachPreferences {
  return {
    proactivity: state.proactivity,
    enabledCategories: state.enabledCategories,
    aiExplanationsEnabled: state.aiExplanationsEnabled,
    quietHours: state.quietHours,
  };
}

function upsertDismissal(
  dismissals: readonly CoachDismissal[],
  incoming: CoachDismissal,
): CoachDismissal[] {
  const filtered = dismissals.filter((existing) => {
    if (incoming.signalId !== undefined) {
      return existing.signalId !== incoming.signalId;
    }
    return !(existing.signalId === undefined && existing.signalType === incoming.signalType);
  });
  return [...filtered, incoming];
}

export const useLearningCoachStore = create<LearningCoachStoreState>()(
  persist(
    (set, get) => ({
      proactivity: DEFAULT_COACH_PREFERENCES.proactivity,
      enabledCategories: { ...DEFAULT_COACH_ENABLED_CATEGORIES },
      aiExplanationsEnabled: false,
      quietHours: {
        enabled: false,
        start: "22:00",
        end: "07:00",
      },
      dismissals: [],
      recommendations: [],
      lastEvaluatedAt: null,

      setProactivity: (level) => {
        set((state) => ({
          proactivity: level,
          recommendations: level === "disabled" ? [] : state.recommendations,
        }));
      },

      setCategoryEnabled: (category, enabled) => {
        set((state) => ({
          enabledCategories: {
            ...state.enabledCategories,
            [category]: enabled,
          },
          recommendations: enabled
            ? state.recommendations
            : state.recommendations.filter((rec) => rec.signalType !== category),
        }));
      },

      setAiExplanationsEnabled: (enabled) => {
        set({ aiExplanationsEnabled: enabled });
      },

      setQuietHours: (patch) => {
        set((state) => ({
          quietHours: {
            ...state.quietHours,
            ...patch,
          },
        }));
      },

      evaluateOpportunities: (snapshot, nowIso = new Date().toISOString()) => {
        const state = get();
        if (state.proactivity === "disabled") {
          set({ recommendations: [], lastEvaluatedAt: nowIso });
          return [];
        }
        const recs = detectCoachingOpportunities(
          snapshot,
          buildPreferences(state),
          state.dismissals,
          nowIso,
        );
        set({
          recommendations: recs,
          lastEvaluatedAt: nowIso,
        });
        return recs;
      },

      dismissSignal: (signalId, reason, nowIso = new Date().toISOString()) => {
        set((state) => ({
          dismissals: upsertDismissal(state.dismissals, {
            signalId,
            dismissedAt: nowIso,
            snoozeUntil: null,
            reason,
          }),
          recommendations: state.recommendations.filter(
            (rec) => rec.id !== signalId && rec.dedupeKey !== signalId,
          ),
        }));
      },

      snoozeSignal: (signalId, snoozeUntilIso, reason, nowIso = new Date().toISOString()) => {
        set((state) => ({
          dismissals: upsertDismissal(state.dismissals, {
            signalId,
            dismissedAt: nowIso,
            snoozeUntil: snoozeUntilIso,
            reason,
          }),
          recommendations: state.recommendations.filter(
            (rec) => rec.id !== signalId && rec.dedupeKey !== signalId,
          ),
        }));
      },

      dismissCategory: (signalType, reason, nowIso = new Date().toISOString()) => {
        set((state) => ({
          dismissals: upsertDismissal(state.dismissals, {
            signalType,
            dismissedAt: nowIso,
            snoozeUntil: null,
            reason,
          }),
          recommendations: state.recommendations.filter((rec) => rec.signalType !== signalType),
        }));
      },

      snoozeCategory: (
        signalType,
        snoozeUntilIso,
        reason,
        nowIso = new Date().toISOString(),
      ) => {
        set((state) => ({
          dismissals: upsertDismissal(state.dismissals, {
            signalType,
            dismissedAt: nowIso,
            snoozeUntil: snoozeUntilIso,
            reason,
          }),
          recommendations: state.recommendations.filter((rec) => rec.signalType !== signalType),
        }));
      },

      pruneExpiredDismissals: (nowIso = new Date().toISOString()) => {
        const nowMs = Date.parse(nowIso);
        set((state) => ({
          dismissals: state.dismissals.filter((d) => {
            if (!d.snoozeUntil) return true;
            const untilMs = Date.parse(d.snoozeUntil);
            return Number.isFinite(untilMs) && nowMs < untilMs;
          }),
        }));
      },

      clearDismissals: () => {
        set({ dismissals: [] });
      },

      clearRecommendations: () => {
        set({ recommendations: [] });
      },

      reset: () => {
        set({
          proactivity: DEFAULT_COACH_PREFERENCES.proactivity,
          enabledCategories: { ...DEFAULT_COACH_ENABLED_CATEGORIES },
          aiExplanationsEnabled: false,
          quietHours: {
            enabled: false,
            start: "22:00",
            end: "07:00",
          },
          dismissals: [],
          recommendations: [],
          lastEvaluatedAt: null,
        });
      },
    }),
    {
      name: LEARNING_COACH_STORAGE_KEY,
      storage: createJSONStorage(createSafeLocalStorage),
      partialize: (state) => ({
        proactivity: state.proactivity,
        enabledCategories: state.enabledCategories,
        aiExplanationsEnabled: state.aiExplanationsEnabled,
        quietHours: state.quietHours,
        dismissals: state.dismissals,
        recommendations: state.recommendations,
        lastEvaluatedAt: state.lastEvaluatedAt,
      }),
    },
  ),
);
