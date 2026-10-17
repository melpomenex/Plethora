/**
 * Projection store (design D1, tasks 1.4/1.7).
 *
 * A narrow selector-based read model in front of `ConversationRepository`.
 * Responsibilities:
 *  - cache conversation summaries + the open conversation record;
 *  - refresh only the affected conversation on repository change events;
 *  - expose *selector* accessors so components subscribe to one id and never
 *    re-render the whole list on unrelated changes;
 *  - never own draft text or provider invocation (that is the turn
 *    controller's / components' working state).
 *
 * The store holds no durable authority: a failed refresh leaves the previous
 * projection in place and surfaces a load error; the repository remains the
 * source of truth.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Conversation,
  ConversationRecord,
} from "./types";
import type {
  ConversationRepository,
  RepositoryChange,
  Unsubscribe,
} from "./repository";

export interface ProjectionState {
  ownerProfileId: string | null;
  summaries: Conversation[];
  /** Full records keyed by conversation id (only what has been opened). */
  records: Record<string, ConversationRecord>;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError?: string;
  recordStatus: Record<string, "loading" | "ready" | "error">;
  recordError: Record<string, string | undefined>;
}

export interface ProjectionActions {
  /** Switch partition; detaches the previous subscription. */
  bindOwner(ownerProfileId: string | null, repository: ConversationRepository): void;
  refreshList(): Promise<void>;
  openConversation(conversationId: string): Promise<ConversationRecord | null>;
  /** Apply a repository change event without refetching the whole list. */
  applyChange(change: RepositoryChange): Promise<void>;
  clear(): void;
}

const initialState: ProjectionState = {
  ownerProfileId: null,
  summaries: [],
  records: {},
  listStatus: "idle",
  recordStatus: {},
  recordError: {},
};

let activeRepository: ConversationRepository | null = null;
let activeUnsubscribe: Unsubscribe | null = null;

export const useConversationProjection = create<ProjectionState & ProjectionActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    bindOwner(ownerProfileId, repository) {
      activeUnsubscribe?.();
      activeUnsubscribe = null;
      activeRepository = repository;
      if (!ownerProfileId) {
        set({ ...initialState });
        return;
      }
      set({
        ownerProfileId,
        summaries: [],
        records: {},
        listStatus: "loading",
        listError: undefined,
        recordStatus: {},
        recordError: {},
      });
      activeUnsubscribe = repository.subscribe(ownerProfileId, (change) => {
        // Account partition guard: a change for another profile must never
        // land in this projection (cancelled requests included).
        if (get().ownerProfileId !== ownerProfileId) return;
        void get().applyChange(change);
      });
      void get().refreshList();
    },

    async refreshList() {
      const { ownerProfileId } = get();
      if (!ownerProfileId || !activeRepository) return;
      set({ listStatus: "loading" });
      try {
        const page = await activeRepository.listConversations(ownerProfileId, {
          limit: 200,
        });
        if (get().ownerProfileId !== ownerProfileId) return; // partition switched mid-flight
        set({ summaries: page.items, listStatus: "ready", listError: undefined });
      } catch (error) {
        if (get().ownerProfileId !== ownerProfileId) return;
        set({
          listStatus: "error",
          listError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async openConversation(conversationId) {
      const { ownerProfileId } = get();
      if (!ownerProfileId || !activeRepository) return null;
      set((state) => ({
        recordStatus: { ...state.recordStatus, [conversationId]: "loading" },
        recordError: { ...state.recordError, [conversationId]: undefined },
      }));
      const result = await activeRepository.getConversation(ownerProfileId, conversationId);
      if (get().ownerProfileId !== ownerProfileId) return null;
      if (!result.ok || !result.value) {
        const message = result.error?.message ?? "conversation not found";
        set((state) => ({
          recordStatus: { ...state.recordStatus, [conversationId]: "error" },
          recordError: { ...state.recordError, [conversationId]: message },
        }));
        return null;
      }
      set((state) => ({
        records: { ...state.records, [conversationId]: result.value! },
        recordStatus: { ...state.recordStatus, [conversationId]: "ready" },
      }));
      return result.value;
    },

    async applyChange(change) {
      const { ownerProfileId } = get();
      if (!ownerProfileId || !activeRepository) return;
      if (change.deleted) {
        set((state) => {
          const records = { ...state.records };
          delete records[change.conversationId];
          return {
            records,
            summaries: state.summaries.filter((summary) => summary.id !== change.conversationId),
          };
        });
        return;
      }
      // Refresh the affected summary + open record only.
      const page = await activeRepository.listConversations(ownerProfileId, { limit: 200 });
      if (get().ownerProfileId !== ownerProfileId) return;
      set({ summaries: page.items });
      if (get().records[change.conversationId]) {
        const result = await activeRepository.getConversation(ownerProfileId, change.conversationId);
        if (get().ownerProfileId !== ownerProfileId) return;
        if (result.ok) {
          set((state) => ({
            records: { ...state.records, [change.conversationId]: result.value },
          }));
        }
      }
    },

    clear() {
      activeUnsubscribe?.();
      activeUnsubscribe = null;
      activeRepository = null;
      set({ ...initialState });
    },
  })),
);

/* ------------------------------------------------------------------ */
/* Selectors (components use these, not the whole store)              */
/* ------------------------------------------------------------------ */

export const selectSummaries = (state: ProjectionState): Conversation[] => state.summaries;
export const selectListStatus = (state: ProjectionState): ProjectionState["listStatus"] =>
  state.listStatus;
export const selectListError = (state: ProjectionState): string | undefined => state.listError;
export const selectConversationRecord = (
  conversationId: string,
): ((state: ProjectionState) => ConversationRecord | undefined) => {
  return (state) => state.records[conversationId];
};
export const selectConversationSummary = (
  conversationId: string,
): ((state: ProjectionState) => Conversation | undefined) => {
  return (state) => state.summaries.find((summary) => summary.id === conversationId);
};
export const selectRecordStatus = (
  conversationId: string,
): ((state: ProjectionState) => ProjectionState["recordStatus"][string] | undefined) => {
  return (state) => state.recordStatus[conversationId];
};
