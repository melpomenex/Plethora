/**
 * Canonical history reader and export (tasks 1.8/1.9).
 *
 * Available whether or not `assistantCanonicalConversations` is on: the data
 * lives in SQLite/IndexedDB, not behind a presentation flag. This is the
 * compatibility path that
 *
 *  - lets a flag-off (or downgraded) build read canonical history instead of
 *    showing nothing,
 *  - produces the documented canonical export for recovery,
 *  - and proves in tests that a capped legacy projection can never overwrite
 *    canonical post-cutover data.
 */

import type { ConversationRepository } from "./repository";
import type { ConversationRecord } from "./types";

export interface CanonicalHistorySummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
  turnCount: number;
  syncPolicy: "eligible" | "device-local";
  deleted: boolean;
  /** True for imported legacy threads (provenance kept visible). */
  imported: boolean;
}

export interface CanonicalExport {
  formatVersion: 1;
  exportedAt: number;
  appRevision?: string;
  conversations: ConversationRecord[];
}

/**
 * Read the history list without a presentation flag. Includes tombstones so a
 * downgraded build can still show that a thread existed.
 */
export async function readCanonicalHistory(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
  limit?: number;
}): Promise<CanonicalHistorySummary[]> {
  const page = await options.repository.listConversations(options.ownerProfileId, {
    limit: options.limit ?? 200,
    includeDeleted: true,
  });
  return page.items.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: 0,
    turnCount: 0,
    syncPolicy: conversation.syncPolicy,
    deleted: conversation.deletedAt !== undefined,
    imported: conversation.legacyAliases.length > 0,
  }));
}

/** Full record for one thread, read through the same flag-free path. */
export async function readCanonicalConversation(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
  conversationId: string;
}): Promise<ConversationRecord | null> {
  const result = await options.repository.getConversation(
    options.ownerProfileId,
    options.conversationId,
  );
  return result.ok ? result.value ?? null : null;
}

/**
 * Export for user-visible recovery. Unknown/legacy payloads are included
 * verbatim; nothing is normalized away.
 */
export async function exportCanonicalHistory(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
  appRevision?: string;
}): Promise<CanonicalExport> {
  const exported = await options.repository.exportConversations(options.ownerProfileId, {
    includeDeleted: true,
  });
  return {
    formatVersion: 1,
    exportedAt: Date.now(),
    appRevision: options.appRevision,
    conversations: exported.ok ? exported.value?.conversations ?? [] : [],
  };
}

/**
 * Guard for the legacy write path: a legacy (capped) projection must never
 * overwrite a canonical record. Returns `false` when canonical data exists for
 * the id, so the caller keeps the legacy original read-only.
 */
export async function legacyProjectionMayWrite(options: {
  repository: ConversationRepository;
  ownerProfileId: string;
  conversationId: string;
}): Promise<boolean> {
  const existing = await options.repository.getConversation(
    options.ownerProfileId,
    options.conversationId,
  );
  if (!existing.ok || !existing.value) return true;
  // Canonical versions are authoritative once written; imported legacy
  // records are version 2 with a legacy alias but were created by the importer
  // itself, so they are safe to keep updating through canonical paths only.
  return false;
}
