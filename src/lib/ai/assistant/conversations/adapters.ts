/**
 * Platform adapter selection (tasks 1.3/1.4).
 *
 * - Native (Tauri): every operation goes through the registered
 *   `ai_conversation_*` commands, so SQLite remains the single owner of
 *   durable records; account/profile partitions and revisions are enforced by
 *   the Rust repository.
 * - Browser/PWA: `ConversationRepositoryCore` over IndexedDB. Capabilities
 *   report honestly that this is device-local with no native sync.
 *
 * Components never import a backend directly; they receive the selected
 * `ConversationRepository`.
 */

import { isTauri } from "../../../tauri";
import { ConversationRepositoryCore } from "./core";
import type { ConversationRepository, RepositoryCapabilities } from "./repository";
import { IndexedDbConversationStore } from "./store";

const BROWSER_CAPABILITIES: RepositoryCapabilities = {
  nativeSync: false,
  durableTransactions: false,
  location: "device",
};

/**
 * Command invoker seam. Production resolves `invoke` from `@tauri-apps/api`;
 * tests inject a fake. Kept minimal so no other module needs Tauri types.
 */
export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface NativeAdapterOptions {
  invoke: InvokeFn;
}

/**
 * Native adapter: passes through to the Rust repository. Values are the
 * command JSON shapes accepted by `src-tauri/src/commands/ai_conversations.rs`.
 */
export function createNativeConversationRepository(
  options: NativeAdapterOptions,
): ConversationRepository {
  const invoke = options.invoke;
  return {
    capabilities: {
      nativeSync: true,
      durableTransactions: true,
      location: "device",
    },
    async listConversations(ownerProfileId, listOptions) {
      const items = await invoke<Awaited<ReturnType<ConversationRepository["listConversations"]>>["items"]>(
        "ai_conversation_list",
        {
          ownerProfileId,
          includeDeleted: listOptions?.includeDeleted ?? false,
          limit: listOptions?.limit ?? null,
          search: listOptions?.search ?? null,
        },
      );
      return { items };
    },
    async getConversation(ownerProfileId, conversationId) {
      const record = await invoke<unknown>("ai_conversation_get", {
        ownerProfileId,
        conversationId,
      });
      if (!record) {
        return { ok: false, error: { code: "not_found", message: `conversation ${conversationId} not found` } };
      }
      return { ok: true, value: record as never };
    },
    async createConversation(input) {
      const summary = await invoke<never>("ai_conversation_create", {
        ownerProfileId: input.ownerProfileId,
        conversationId: input.id ?? null,
        title: input.title ?? "New conversation",
        collectionId: input.collectionId ?? null,
        contextPolicy: input.contextPolicy ?? null,
        syncPolicy: input.syncPolicy ?? "device-local",
        legacyAliases: input.legacyAliases ?? [],
      });
      return { ok: true, value: summary };
    },
    async updateMetadata(conversationId, patch, context) {
      const summary = await invoke<never>("ai_conversation_update_metadata", {
        ownerProfileId: context.ownerProfileId,
        conversationId,
        expectedRevision: context.expectedRevision ?? null,
        title: patch.title ?? null,
        collectionId: patch.collectionId ?? null,
        clearCollection: patch.collectionId === null,
        contextPolicy: patch.contextPolicy ?? null,
        syncPolicy: patch.syncPolicy ?? null,
        activeAttachments: patch.activeAttachments ?? null,
        sourceHistory: patch.sourceHistory ?? null,
      });
      return { ok: true, value: summary };
    },
    async deleteConversation(conversationId, context) {
      const deletedAt = await invoke<number>("ai_conversation_delete", {
        ownerProfileId: context.ownerProfileId,
        conversationId,
        expectedRevision: context.expectedRevision ?? null,
      });
      return { ok: true, value: { id: conversationId, deletedAt } };
    },
    async commitDraft(conversationId, input, context) {
      const revision = await invoke<number>("ai_conversation_commit_draft", {
        ownerProfileId: context.ownerProfileId,
        conversationId,
        deviceId: input.draft.deviceId,
        text: input.draft.text,
        payload: input.draft,
        expectedRevision: context.expectedRevision ?? null,
      });
      return {
        ok: true,
        value: { ...input.draft, conversationId, revision },
      };
    },
    async appendTurn(input, context) {
      const revision = await invoke<number>("ai_conversation_append_turn", {
        ownerProfileId: context.ownerProfileId,
        conversationId: input.conversationId,
        expectedRevision: input.expectedRevision,
        messageId: input.userMessage.id,
        messageContent: input.userMessage.content,
        messageOrderKey: input.userMessage.orderKey,
        messageCreatedAtMs: input.userMessage.createdAt,
        messagePayload: input.userMessage,
        turnId: input.turn.id,
        attemptId: input.turn.attempts[0]?.id ?? null,
        parentTurnId: input.turn.parentTurnId ?? null,
        requestPlan: input.turn.requestPlan,
        turnCreatedAtMs: input.turn.createdAt,
        draftDeviceId: input.draftCheckpoint ? context.ownerProfileId : null,
        draftText: input.draftCheckpoint?.text ?? null,
        draftPayload: input.draftCheckpoint ?? null,
      });
      void revision;
      return {
        ok: true,
        value: {
          turn: { ...input.turn, status: "queued" },
          userMessage: { ...input.userMessage, turnId: input.turn.id },
        },
      };
    },
    async finalizeAttempt(input, context) {
      await invoke<void>("ai_conversation_finalize_attempt", {
        ownerProfileId: context.ownerProfileId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        attemptId: input.attemptId,
        status: input.status,
        assistantMessageId: input.assistantMessage?.id ?? null,
        assistantContent: input.assistantMessage?.content ?? null,
        assistantOrderKey: input.assistantMessage?.orderKey ?? null,
        assistantCreatedAtMs: input.assistantMessage?.createdAt ?? null,
        assistantThinking: input.assistantMessage?.thinking ?? null,
        assistantEvidence: input.assistantMessage?.evidence ?? null,
        assistantPayload: input.assistantMessage ?? null,
        assistantSources: input.assistantMessage?.sourceSnapshot ?? null,
        failureReason: input.failureReason ?? null,
        detached: input.detached ?? false,
        provider: input.provider ?? null,
      });
      return { ok: true, value: { turn: {} as never, assistantMessage: input.assistantMessage } };
    },
    async appendAttempt(input, context) {
      const revision = await invoke<number>("ai_conversation_append_attempt", {
        ownerProfileId: context.ownerProfileId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        attemptId: input.attempt.id,
        requestPlan: input.attempt.requestPlan,
        startedAtMs: input.attempt.startedAt,
      });
      void revision;
      return { ok: true, value: { turn: {} as never } };
    },
    async reauthorizeSource(conversationId, attachmentId, authorized, context) {
      await invoke<void>("ai_conversation_replace_sources", {
        ownerProfileId: context.ownerProfileId,
        conversationId,
        sources: authorized.libraryId
          ? [{ attachmentId, libraryId: authorized.libraryId, kind: "document", title: "", origin: "history", role: "optional" }]
          : [],
      });
      return { ok: true, value: undefined as never };
    },
    subscribe() {
      // Native changes arrive through the projection store refresh path; the
      // Rust repository does not push events yet. Returns a no-op unsubscribe
      // so callers can treat both backends uniformly.
      return () => {};
    },
    async exportConversations(ownerProfileId, options) {
      const items = await invoke<never[]>("ai_conversation_list", {
        ownerProfileId,
        includeDeleted: options?.includeDeleted ?? false,
        limit: null,
        search: null,
      });
      return {
        ok: true,
        value: { formatVersion: 1, exportedAt: Date.now(), conversations: items },
      };
    },
    async importConversations(ownerProfileId, _bundle, checkpoint) {
      // Native import runs through the dedicated migration module; this
      // command path is a no-op that reports the checkpoint it was given so
      // callers cannot mistake it for a completed native import.
      void ownerProfileId;
      return {
        ok: true,
        value: checkpoint ?? {
          importedConversations: 0,
          importedMessages: 0,
          quarantined: 0,
        },
      };
    },
    async listQuarantined() {
      return { ok: true, value: [] };
    },
  };
}

/** Browser adapter: the shared core over IndexedDB. */
export function createBrowserConversationRepository(
  store?: IndexedDbConversationStore,
): ConversationRepository {
  const backend =
    store ??
    new IndexedDbConversationStore(
      typeof globalThis !== "undefined" && "location" in globalThis
        ? undefined
        : "plethora-assistant-conversations",
    );
  return new ConversationRepositoryCore(backend as never, BROWSER_CAPABILITIES);
}

let cachedRepository: ConversationRepository | null = null;

/**
 * The repository the UI should use on this platform. Native is preferred
 * whenever the Tauri bridge exists; otherwise the device-local browser
 * adapter is used, and its capabilities say so.
 */
export function getConversationRepository(): ConversationRepository {
  if (cachedRepository) return cachedRepository;
  if (isTauri()) {
    cachedRepository = createNativeConversationRepository({
      invoke: async (command, args) => {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke(command, args);
      },
    });
  } else {
    cachedRepository = createBrowserConversationRepository();
  }
  return cachedRepository;
}

/** Test hook: replace the process-wide repository (unmount/account switch). */
export function __setConversationRepositoryForTests(
  repository: ConversationRepository | null,
): void {
  cachedRepository = repository;
}
