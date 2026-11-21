/**
 * Smart Feeds Store
 *
 * Manages Smart Feed definitions, live evaluation progress, capabilities,
 * Tauri backend event subscriptions, and viewport-stable optimistic feedback
 * state so correcting an article never yanks the list out from under the user.
 */

import { create } from "zustand";
import { isTauri } from "../lib/tauri";
import {
  cancelSmartFeedEvaluation,
  createSmartFeed,
  deleteSmartFeed,
  evaluateSmartFeed,
  exportSmartFeeds,
  getSmartFeedCapabilities,
  getSmartFeeds,
  importSmartFeeds,
  submitSmartFeedFeedback,
  updateSmartFeed,
  type CreateSmartFeedInput,
  type SmartFeedCapabilities,
  type SmartFeedFeedbackResult,
  type SmartFeedFeedbackType,
  type SmartFeedProgress,
  type SmartFeedRunMetrics,
  type SmartFeedsExportPayload,
  type SmartFeedsImportResult,
  type SmartFeedWithStats,
  type UpdateSmartFeedInput,
} from "../api/rss-smart-feeds";

interface SmartFeedsState {
  smartFeeds: SmartFeedWithStats[];
  progressByFeedId: Record<string, SmartFeedProgress>;
  capabilities: SmartFeedCapabilities | null;
  loading: boolean;
  error: string | null;
  /** Viewport-stable feedback badges keyed by `feedId -> articleId -> feedback`. */
  pendingFeedbackByFeed: Record<string, Record<string, SmartFeedFeedbackType | null>>;
  eventsBound: boolean;

  loadSmartFeeds: () => Promise<void>;
  loadCapabilities: () => Promise<SmartFeedCapabilities | null>;
  bindTauriEvents: () => Promise<void>;
  createSmartFeed: (input: CreateSmartFeedInput) => Promise<SmartFeedWithStats>;
  updateSmartFeed: (
    id: string,
    input: UpdateSmartFeedInput,
    reevaluateNow?: boolean,
  ) => Promise<SmartFeedWithStats>;
  deleteSmartFeed: (id: string) => Promise<void>;
  evaluateSmartFeed: (
    smartFeedId: string,
    options?: { forceReevaluate?: boolean; waitForCompletion?: boolean },
  ) => Promise<SmartFeedRunMetrics>;
  cancelEvaluation: (smartFeedId: string) => Promise<boolean>;
  submitFeedback: (
    smartFeedId: string,
    articleId: string,
    feedbackType: SmartFeedFeedbackType,
    note?: string,
  ) => Promise<SmartFeedFeedbackResult>;
  clearPendingFeedbackForFeed: (smartFeedId: string) => void;
  exportAll: () => Promise<SmartFeedsExportPayload>;
  importPayload: (payload: SmartFeedsExportPayload) => Promise<SmartFeedsImportResult>;
}

let eventsBindingPromise: Promise<void> | null = null;

export const useSmartFeedsStore = create<SmartFeedsState>((set, get) => ({
  smartFeeds: [],
  progressByFeedId: {},
  capabilities: null,
  loading: false,
  error: null,
  pendingFeedbackByFeed: {},
  eventsBound: false,

  loadSmartFeeds: async () => {
    set({ loading: true, error: null });
    try {
      const smartFeeds = await getSmartFeeds();
      set({ smartFeeds: Array.isArray(smartFeeds) ? smartFeeds : [], loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadCapabilities: async () => {
    try {
      const capabilities = await getSmartFeedCapabilities();
      set({ capabilities });
      return capabilities;
    } catch {
      return null;
    }
  },

  bindTauriEvents: async () => {
    if (!isTauri() || get().eventsBound) return;
    if (eventsBindingPromise) return eventsBindingPromise;
    eventsBindingPromise = (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        await listen<SmartFeedProgress>("rss:smart-feed:progress", (event) => {
          const p = event.payload;
          if (!p?.smart_feed_id) return;
          set((state) => ({
            progressByFeedId: {
              ...state.progressByFeedId,
              [p.smart_feed_id]: p,
            },
          }));
          if (p.phase === "completed" || p.phase === "cancelled") {
            void get().loadSmartFeeds();
          }
        });
        await listen<string>("rss:smart-feed:updated", () => {
          void get().loadSmartFeeds();
        });
        set({ eventsBound: true });
      } catch {
        // Non-Tauri or test environment.
      }
    })();
    return eventsBindingPromise;
  },

  createSmartFeed: async (input) => {
    const created = await createSmartFeed(input, true);
    await get().loadSmartFeeds();
    return created;
  },

  updateSmartFeed: async (id, input, reevaluateNow) => {
    const updated = await updateSmartFeed(id, input, reevaluateNow);
    await get().loadSmartFeeds();
    return updated;
  },

  deleteSmartFeed: async (id) => {
    await deleteSmartFeed(id);
    set((state) => {
      const nextProg = { ...state.progressByFeedId };
      delete nextProg[id];
      const nextPending = { ...state.pendingFeedbackByFeed };
      delete nextPending[id];
      return {
        smartFeeds: state.smartFeeds.filter((f) => f.id !== id),
        progressByFeedId: nextProg,
        pendingFeedbackByFeed: nextPending,
      };
    });
  },

  evaluateSmartFeed: async (smartFeedId, options) => {
    const metrics = await evaluateSmartFeed(smartFeedId, options);
    await get().loadSmartFeeds();
    return metrics;
  },

  cancelEvaluation: async (smartFeedId) => {
    const cancelled = await cancelSmartFeedEvaluation(smartFeedId);
    await get().loadSmartFeeds();
    return cancelled;
  },

  submitFeedback: async (smartFeedId, articleId, feedbackType, note) => {
    const result = await submitSmartFeedFeedback(smartFeedId, articleId, feedbackType, note);
    // Record local badge state without mutating the rendered list order
    // (viewport stability on feedback).
    set((state) => ({
      pendingFeedbackByFeed: {
        ...state.pendingFeedbackByFeed,
        [smartFeedId]: {
          ...(state.pendingFeedbackByFeed[smartFeedId] ?? {}),
          [articleId]: result.active_feedback ?? null,
        },
      },
    }));
    await get().loadSmartFeeds();
    return result;
  },

  clearPendingFeedbackForFeed: (smartFeedId) => {
    set((state) => {
      const next = { ...state.pendingFeedbackByFeed };
      delete next[smartFeedId];
      return { pendingFeedbackByFeed: next };
    });
  },

  exportAll: () => exportSmartFeeds(),

  importPayload: async (payload) => {
    const res = await importSmartFeeds(payload);
    await get().loadSmartFeeds();
    return res;
  },
}));
