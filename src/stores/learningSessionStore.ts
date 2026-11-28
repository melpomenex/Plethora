/**
 * Persisted Zustand store for the active/paused unified LearningSession.
 *
 * Persists to `localStorage` under `plethora.learningSession.v1` so interrupted
 * sessions recover cleanly after restart without duplicating completed activities,
 * and stays subscribed to `learningEventBus` for cross-surface completion sync.
 */

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type {
  LearningActivity,
  LearningSession,
  LearningSessionSummary,
  RuntimeCapabilities,
} from "../types/learningActivity";
import type { LearningEvent } from "../types/learningEvent";
import { DEFAULT_RUNTIME_CAPABILITIES } from "../lib/learning-runtime/activityRegistry";
import {
  adjustSessionBudget,
  attachSessionEventReconciler,
  completeActivity,
  completeSession,
  createLearningSession,
  pauseSession,
  postponeActivity,
  reconcileExternalLearningEvent,
  reorderActivities,
  replaceActivity,
  resumeSession,
  revisitActivity,
  skipActivity,
  startActivity,
  summarizeSession,
  type CompleteActivityOptions,
  type CreateLearningSessionOptions,
  type PauseSessionOptions,
} from "../lib/learning-runtime/sessionRuntime";

export const LEARNING_SESSION_STORAGE_KEY = "plethora.learningSession.v1" as const;

const MAX_HISTORY_SUMMARIES = 50;

function createSafeLocalStorage(): StateStorage {
  const memoryFallback = new Map<string, string>();
  return {
    getItem(name: string): string | null {
      try {
        if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
          return globalThis.localStorage.getItem(name);
        }
      } catch {
        // Fall through to in-memory storage
      }
      return memoryFallback.get(name) ?? null;
    },
    setItem(name: string, value: string): void {
      try {
        if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
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
        if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
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

export interface LearningSessionStoreState {
  activeSession: LearningSession | null;
  sessionHistory: LearningSessionSummary[];
  runtimeCapabilities: RuntimeCapabilities;

  startNewSession: (options: CreateLearningSessionOptions) => LearningSession;
  startActivity: (activityId: string) => LearningSession | null;
  completeActivity: (
    activityId: string,
    options?: CompleteActivityOptions,
  ) => LearningSession | null;
  skipActivity: (activityId: string, reason?: string) => LearningSession | null;
  postponeActivity: (activityId: string, reason?: string) => LearningSession | null;
  revisitActivity: (activityId: string) => LearningSession | null;
  reorderActivities: (orderedActivityIds: readonly string[]) => LearningSession | null;
  replaceActivity: (
    targetActivityId: string,
    replacement: LearningActivity,
  ) => LearningSession | null;
  adjustBudget: (timeBudgetMinutes: number | null) => LearningSession | null;
  pauseSession: (options?: PauseSessionOptions) => LearningSession | null;
  resumeSession: () => LearningSession | null;
  completeSession: () => LearningSessionSummary | null;
  abandonSession: () => void;
  setRuntimeCapabilities: (caps: Partial<RuntimeCapabilities>) => void;
  reconcileEvent: (event: LearningEvent) => string[];
  clearSession: () => void;
}

export const useLearningSessionStore = create<LearningSessionStoreState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      sessionHistory: [],
      runtimeCapabilities: { ...DEFAULT_RUNTIME_CAPABILITIES },

      startNewSession: (options) => {
        const session = createLearningSession({
          runtimeCapabilities: get().runtimeCapabilities,
          ...options,
        });
        set({ activeSession: session });
        return session;
      },

      startActivity: (activityId) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = startActivity(current, activityId);
        set({ activeSession: next });
        return next;
      },

      completeActivity: (activityId, options) => {
        const current = get().activeSession;
        if (!current) return null;
        const { session: next } = completeActivity(current, activityId, options);
        set({ activeSession: next });
        return next;
      },

      skipActivity: (activityId, reason) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = skipActivity(current, activityId, reason);
        set({ activeSession: next });
        return next;
      },

      postponeActivity: (activityId, reason) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = postponeActivity(current, activityId, reason);
        set({ activeSession: next });
        return next;
      },

      revisitActivity: (activityId) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = revisitActivity(current, activityId);
        set({ activeSession: next });
        return next;
      },

      reorderActivities: (orderedActivityIds) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = reorderActivities(current, orderedActivityIds);
        set({ activeSession: next });
        return next;
      },

      replaceActivity: (targetActivityId, replacement) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = replaceActivity(current, targetActivityId, replacement);
        set({ activeSession: next });
        return next;
      },

      adjustBudget: (timeBudgetMinutes) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = adjustSessionBudget(current, timeBudgetMinutes);
        set({ activeSession: next });
        return next;
      },

      pauseSession: (options) => {
        const current = get().activeSession;
        if (!current) return null;
        const next = pauseSession(current, options);
        set({ activeSession: next });
        return next;
      },

      resumeSession: () => {
        const current = get().activeSession;
        if (!current) return null;
        const next = resumeSession(current);
        set({ activeSession: next });
        return next;
      },

      completeSession: () => {
        const current = get().activeSession;
        if (!current) return null;
        const completed = completeSession(current);
        const summary = summarizeSession(completed);
        set((state) => ({
          activeSession: null,
          sessionHistory: [summary, ...state.sessionHistory].slice(0, MAX_HISTORY_SUMMARIES),
        }));
        return summary;
      },

      abandonSession: () => {
        const current = get().activeSession;
        if (!current) return;
        const abandoned: LearningSession = {
          ...current,
          status: "abandoned",
          updatedAt: new Date().toISOString(),
        };
        const summary = summarizeSession(abandoned);
        set((state) => ({
          activeSession: null,
          sessionHistory: [summary, ...state.sessionHistory].slice(0, MAX_HISTORY_SUMMARIES),
        }));
      },

      setRuntimeCapabilities: (caps) => {
        set((state) => ({
          runtimeCapabilities: {
            ...state.runtimeCapabilities,
            ...caps,
          },
        }));
      },

      reconcileEvent: (event) => {
        const current = get().activeSession;
        if (!current) return [];
        const { session: next, matchedActivityIds } = reconcileExternalLearningEvent(
          current,
          event,
        );
        if (matchedActivityIds.length > 0) {
          set({ activeSession: next });
        }
        return matchedActivityIds;
      },

      clearSession: () => {
        set({ activeSession: null });
      },
    }),
    {
      name: LEARNING_SESSION_STORAGE_KEY,
      storage: createJSONStorage(createSafeLocalStorage),
      partialize: (state) => ({
        activeSession: state.activeSession,
        sessionHistory: state.sessionHistory,
      }),
    },
  ),
);

let unsubscribeEventSync: (() => void) | null = null;

/**
 * Ensures the persisted session store is subscribed to `learningEventBus` for
 * automatic cross-surface completion reconciliation.
 */
export function ensureLearningSessionEventSync(): () => void {
  if (!unsubscribeEventSync) {
    unsubscribeEventSync = attachSessionEventReconciler(
      () => useLearningSessionStore.getState().activeSession,
      (session) => useLearningSessionStore.setState({ activeSession: session }),
    );
  }
  return unsubscribeEventSync;
}

/** Test-only helper to detach and re-attach the event bus listener after a bus reset. */
export function _resetLearningSessionEventSyncForTests(): void {
  if (unsubscribeEventSync) {
    unsubscribeEventSync();
    unsubscribeEventSync = null;
  }
  ensureLearningSessionEventSync();
}

// Auto-wire on module load so cross-surface events immediately reconcile.
ensureLearningSessionEventSync();
