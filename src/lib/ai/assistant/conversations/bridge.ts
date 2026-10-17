/**
 * Canonical ownership bridge (tasks 1.8/1.9).
 *
 * The single decision point every Assistant surface uses to choose its
 * durable owner:
 *
 *  - flag on  → the canonical repository + projection store own history and
 *    drafts (one writer; legacy storage becomes read-only).
 *  - flag off → legacy storage keeps working exactly as before, and the
 *    canonical history reader/export stays available so post-cutover data is
 *    never stranded.
 *
 * Keeping the decision in one module means no surface can quietly become a
 * second writable history: either it uses this bridge, or it is the legacy
 * path that the bridge already replaces.
 */

import { useSettingsStore } from "../../../../stores/settingsStore";
import { getConversationRepository } from "./adapters";
import {
  useConversationProjection,
  selectConversationRecord,
  selectSummaries,
} from "./projectionStore";
import type { ConversationRepository } from "./repository";
import type { ConversationRecord } from "./types";

export function canonicalConversationsEnabled(): boolean {
  return useSettingsStore.getState().settings.features.assistantCanonicalConversations === true;
}

/** The repository for this platform (native SQLite or device-local IndexedDB). */
export function canonicalRepository(): ConversationRepository {
  return getConversationRepository();
}

/**
 * Bind a surface to the canonical projection. Call from a component effect
 * keyed on the owner profile id; the projection detaches the previous
 * subscription on every rebind and on unmount (`clear`).
 */
export function bindCanonicalProjection(ownerProfileId: string | null): void {
  useConversationProjection.getState().bindOwner(ownerProfileId, canonicalRepository());
}

export function unbindCanonicalProjection(): void {
  useConversationProjection.getState().clear();
}

/** Open a record through the projection (deduped cache + change events). */
export async function openCanonicalConversation(
  conversationId: string,
): Promise<ConversationRecord | null> {
  return useConversationProjection.getState().openConversation(conversationId);
}

/** Refresh the projection after a repository mutation. */
export async function refreshCanonicalList(): Promise<void> {
  await useConversationProjection.getState().refreshList();
}

export { selectConversationRecord, selectSummaries };

/**
 * A draft flush helper: debounce-aware callers pass the *acknowledged*
 * revision they last wrote; a revision conflict re-reads instead of
 * overwriting (design: one writer, optimistic revisions).
 */
export async function commitCanonicalDraft(input: {
  ownerProfileId: string;
  conversationId: string;
  deviceId: string;
  expectedRevision: number;
  draft: {
    deviceId: string;
    revision: number;
    text: string;
    attachments: import("./types").SourceAttachment[];
    mentionTokens: import("./types").MentionToken[];
    selection?: import("./types").SelectionSnapshot;
    updatedAt: number;
  };
  /** Test/host injection seam; defaults to the platform repository. */
  repository?: ConversationRepository;
}): Promise<{ ok: boolean; code?: string; message?: string }> {
  const repository = input.repository ?? canonicalRepository();
  const result = await repository.commitDraft(
    input.conversationId,
    {
      conversationId: input.conversationId,
      draft: {
        deviceId: input.draft.deviceId,
        revision: input.draft.revision,
        text: input.draft.text,
        attachments: input.draft.attachments,
        mentionTokens: input.draft.mentionTokens,
        selection: input.draft.selection,
        updatedAt: input.draft.updatedAt,
      },
    },
    {
      ownerProfileId: input.ownerProfileId,
      expectedRevision: input.expectedRevision,
    },
  );
  if (result.ok) return { ok: true };
  return {
    ok: false,
    code: result.error?.code,
    message: result.error?.message,
  };
}

/**
 * Navigation guard used before leaving a surface with unsaved work.
 *
 * Returns `true` when the transition may proceed. With canonical ownership a
 * failed flush defers the transition (the caller shows retry/export) instead
 * of silently discarding the draft; without it, legacy behavior is unchanged.
 */
export async function shouldDeferNavigation(input: {
  ownerProfileId: string;
  conversationId: string;
  deviceId: string;
  expectedRevision: number;
  draft: {
    deviceId: string;
    revision: number;
    text: string;
    attachments: import("./types").SourceAttachment[];
    mentionTokens: import("./types").MentionToken[];
    selection?: import("./types").SelectionSnapshot;
    updatedAt: number;
  };
  hasUnsavedText: boolean;
  repository?: ConversationRepository;
}): Promise<{ defer: boolean; reason?: string }> {
  if (!canonicalConversationsEnabled() || !input.hasUnsavedText) {
    return { defer: false };
  }
  const flushed = await commitCanonicalDraft(input);
  if (flushed.ok) return { defer: false };
  return {
    defer: true,
    reason: flushed.message ?? "draft could not be saved; retry or export before leaving",
  };
}
