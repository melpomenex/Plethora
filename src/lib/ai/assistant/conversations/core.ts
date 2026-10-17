/**
 * Store-agnostic conversation repository core (tasks 1.3/1.4).
 *
 * Holds the entire durable contract in one place so the IndexedDB adapter and
 * the in-memory test adapter cannot drift. The native (Tauri/SQLite) path uses
 * `nativeAdapter.ts`, which delegates isolation/revision/atomicity to the Rust
 * repository; the conformance suite in `__tests__/conformance.ts` is written
 * against this core so both platform paths agree on observable behavior.
 *
 * Design rules implemented here:
 *  - every read/write is partitioned by `ownerProfileId`;
 *  - `expectedRevision` guards every mutation;
 *  - `appendTurn` is all-or-nothing (message + turn + attempt + draft
 *    checkpoint in one write unit);
 *  - tombstones beat late writes and imports;
 *  - import is digest-idempotent and resumable via checkpoint.
 */

import { encodeConversationRecord, decodeConversationRecord } from "./serialize";
import type {
  AppendAttemptInput,
  AppendTurnInput,
  Attempt,
  Conversation,
  ConversationRecord,
  Draft,
  FinalizeAttemptInput,
  Message,
  RepositoryPage,
  SourceReference,
  Turn,
} from "./types";
import {
  repositoryError,
  repositoryOk,
  type ConversationMetadataPatch,
  type ConversationRepository,
  type CreateConversationInput,
  type CommitDraftInput,
  type ExportBundle,
  type ImportCheckpoint,
  type QuarantinedRecord,
  type RepositoryCapabilities,
  type RepositoryChange,
  type RepositoryErrorCode,
  type RepositoryListener,
  type RepositoryListOptions,
  type RepositoryMutationContext,
  type RepositoryResult,
  type Unsubscribe,
} from "./repository";

/**
 * The byte store the core persists through. Implementations: IndexedDB
 * (`browserAdapter`) and memory (`memoryAdapter` for tests). All methods may
 * throw; the core maps storage failures to typed repository errors.
 */
export interface ConversationKeyValueStore {
  get(key: string): Promise<string | undefined>;
  /** Must reject on quota/disk failure. */
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys matching a prefix, in ascending order. */
  list(prefix: string): Promise<string[]>;
  /** Best-effort secondary index write; failure is not fatal. */
  indexAdd(index: string, key: string): Promise<void>;
  indexRemove(index: string, key: string): Promise<void>;
  indexList(index: string): Promise<string[]>;
}

const RECORD_PREFIX = "conv:v2:";
const QUARANTINE_PREFIX = "quarantine:";
const JOURNAL_PREFIX = "journal:";

function recordKey(ownerProfileId: string, conversationId: string): string {
  return `${RECORD_PREFIX}${ownerProfileId}:${conversationId}`;
}

function quarantineKey(ownerProfileId: string, digest: string): string {
  return `${QUARANTINE_PREFIX}${ownerProfileId}:${digest}`;
}

function journalKey(ownerProfileId: string, digest: string): string {
  return `${JOURNAL_PREFIX}${ownerProfileId}:${digest}`;
}

function stableDigest(input: string): string {
  // FNV-1a 32-bit, hex — enough to deduplicate records deterministically
  // without pulling a crypto dependency into the browser path.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Serialize any import candidate (including corrupt primitives) without throwing. */
function safeEncode(value: unknown): string {
  try {
    if (value && typeof value === "object" && (value as { version?: unknown }).version === 2) {
      return encodeConversationRecord(value as ConversationRecord);
    }
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

interface PersistedEnvelope {
  ownerProfileId: string;
  record: ConversationRecord;
}

export interface ImportJournalRecord {
  ownerProfileId: string;
  origin: string;
  recordKey: string;
  digest: string;
  status: "imported" | "quarantined" | "skipped";
  reason?: string;
  assignedConversationId?: string;
  importedAt: number;
}

function toConversationError(error: unknown): {
  code: RepositoryErrorCode;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/quota|QuotaExceeded/i.test(message)) {
    return { code: "quota_exceeded", message };
  }
  return { code: "storage_unavailable", message };
}

export class ConversationRepositoryCore implements ConversationRepository {
  readonly capabilities: RepositoryCapabilities;
  private listeners = new Map<
    string,
    Set<RepositoryListener>
  >();

  constructor(
    private store: ConversationKeyValueStore,
    capabilities: RepositoryCapabilities,
  ) {
    this.capabilities = capabilities;
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                              */
  /* ------------------------------------------------------------------ */

  async listConversations(
    ownerProfileId: string,
    options?: RepositoryListOptions,
  ): Promise<RepositoryPage<Conversation>> {
    const keys = await this.store.list(`${RECORD_PREFIX}${ownerProfileId}:`);
    const records: Conversation[] = [];
    for (const key of keys) {
      const record = await this.readRecord(ownerProfileId, key);
      if (!record) continue;
      if (!options?.includeDeleted && record.deletedAt !== undefined) continue;
      if (options?.search && !record.title.toLowerCase().includes(options.search.toLowerCase())) {
        continue;
      }
      records.push(record);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    const limit = options?.limit ?? 200;
    const slice = records.slice(0, limit);
    return {
      items: slice,
      nextCursor: records.length > limit ? String(limit) : undefined,
    };
  }

  async getConversation(
    ownerProfileId: string,
    conversationId: string,
  ): Promise<RepositoryResult<ConversationRecord>> {
    const record = await this.readRecordByConversation(ownerProfileId, conversationId);
    if (!record) {
      return repositoryError("not_found", `conversation ${conversationId} not found`);
    }
    return repositoryOk(record);
  }

  /* ------------------------------------------------------------------ */
  /* Mutations                                                          */
  /* ------------------------------------------------------------------ */

  async createConversation(
    input: CreateConversationInput,
  ): Promise<RepositoryResult<Conversation>> {
    if (!input.ownerProfileId?.trim()) {
      return repositoryError("invalid_input", "ownerProfileId is required");
    }
    const existing = input.id
      ? await this.readRecordByConversation(input.ownerProfileId, input.id)
      : null;
    if (existing) {
      // Idempotent create for the same partition; refuses cross-partition
      // id reuse like the native repository.
      return repositoryOk(existing);
    }
    if (input.id) {
      const otherKey = await this.findRecordKeyAcrossPartitions(input.id, input.ownerProfileId);
      if (otherKey) {
        return repositoryError(
          "invalid_input",
          `conversation id ${input.id} belongs to another profile partition`,
        );
      }
    }

    const now = Date.now();
    const id = input.id?.trim() || cryptoRandomId();
    const record: ConversationRecord = {
      version: 2,
      id,
      ownerProfileId: input.ownerProfileId,
      collectionId: input.collectionId,
      title: input.title?.trim() || "New conversation",
      createdAt: now,
      updatedAt: now,
      revision: 0,
      contextPolicy: input.contextPolicy ?? { mode: "auto", origin: "explicit" },
      activeAttachments: [],
      sourceHistory: [],
      syncPolicy: input.syncPolicy ?? "device-local",
      legacyAliases: input.legacyAliases ?? [],
      messages: [],
      turns: [],
    };
    const written = await this.writeRecord({ ownerProfileId: input.ownerProfileId, record });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId: id, revision: 0, deleted: false });
    return repositoryOk(record);
  }

  async updateMetadata(
    conversationId: string,
    patch: ConversationMetadataPatch,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<Conversation>> {
    const loaded = await this.readEnvelope<Conversation>(context.ownerProfileId, conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined && !context.allowDeleted) {
      return repositoryError("invalid_input", "conversation is deleted; restore before editing");
    }
    const conflict = this.checkRevision(envelope.record, context.expectedRevision);
    if (conflict) return conflict;

    const updated: ConversationRecord = {
      ...envelope.record,
      title: patch.title ?? envelope.record.title,
      collectionId:
        patch.collectionId === null
          ? undefined
          : patch.collectionId ?? envelope.record.collectionId,
      contextPolicy: patch.contextPolicy ?? envelope.record.contextPolicy,
      activeAttachments: patch.activeAttachments ?? envelope.record.activeAttachments,
      sourceHistory: patch.sourceHistory ?? envelope.record.sourceHistory,
      syncPolicy: patch.syncPolicy ?? envelope.record.syncPolicy,
      revision: envelope.record.revision + 1,
      updatedAt: Date.now(),
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId, revision: updated.revision, deleted: false });
    return repositoryOk(updated);
  }

  async deleteConversation(
    conversationId: string,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ id: string; deletedAt: number }>> {
    const loaded = await this.readEnvelope<Conversation>(context.ownerProfileId, conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined) {
      return repositoryOk({ id: conversationId, deletedAt: envelope.record.deletedAt });
    }
    const conflict = this.checkRevision(envelope.record, context.expectedRevision);
    if (conflict) return conflict;
    const deletedAt = Date.now();
    const updated: ConversationRecord = {
      ...envelope.record,
      deletedAt,
      revision: envelope.record.revision + 1,
      updatedAt: deletedAt,
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId, revision: updated.revision, deleted: true });
    return repositoryOk({ id: conversationId, deletedAt });
  }

  async commitDraft(
    conversationId: string,
    input: CommitDraftInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<Draft>> {
    const loaded = await this.readEnvelope<Conversation>(context.ownerProfileId, conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined) {
      return repositoryError("invalid_input", "conversation is deleted; tombstones beat late writes");
    }
    const conflict = this.checkRevision(envelope.record, context.expectedRevision);
    if (conflict) return conflict;
    const draft: Draft = {
      ...input.draft,
      conversationId,
      revision: (envelope.record.draft?.revision ?? 0) + 1,
      updatedAt: Date.now(),
    };
    const updated: ConversationRecord = {
      ...envelope.record,
      draft,
      revision: envelope.record.revision + 1,
      updatedAt: draft.updatedAt,
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId, revision: updated.revision, deleted: false });
    return repositoryOk(draft);
  }

  async appendTurn(
    input: AppendTurnInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn; userMessage: Message }>> {
    const loaded = await this.readEnvelope(context.ownerProfileId, input.conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${input.conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined) {
      return repositoryError("invalid_input", "conversation is deleted; tombstones beat late writes");
    }
    const conflict = this.checkRevision(envelope.record, context.expectedRevision);
    if (conflict) return conflict;

    const attempt = input.turn.attempts[0];
    const turn: Turn = {
      ...input.turn,
      conversationId: input.conversationId,
      status: "queued",
      updatedAt: Date.now(),
      createdAt: input.turn.createdAt || Date.now(),
      attempts: attempt ? [{ ...attempt, status: "queued" }] : [],
    };
    const userMessage: Message = {
      ...input.userMessage,
      conversationId: input.conversationId,
      turnId: turn.id,
    };
    const draftCheckpoint = input.draftCheckpoint;
    const updated: ConversationRecord = {
      ...envelope.record,
      messages: [...envelope.record.messages, userMessage],
      turns: [...envelope.record.turns, turn],
      draft: draftCheckpoint
        ? {
            conversationId: input.conversationId,
            deviceId: envelope.record.draft?.deviceId ?? "device",
            revision: (envelope.record.draft?.revision ?? 0) + 1,
            text: draftCheckpoint.text,
            attachments: draftCheckpoint.attachments,
            mentionTokens: draftCheckpoint.mentionTokens,
            selection: draftCheckpoint.selection,
            updatedAt: Date.now(),
          }
        : envelope.record.draft,
      revision: envelope.record.revision + 1,
      updatedAt: Date.now(),
    };
    // Single write unit: the acknowledgment returned here is the only basis
    // for dispatching the request.
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId: input.conversationId, revision: updated.revision, deleted: false });
    return repositoryOk({ turn, userMessage });
  }

  async finalizeAttempt(
    input: FinalizeAttemptInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn; assistantMessage?: Message }>> {
    const loaded = await this.readEnvelope(context.ownerProfileId, input.conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${input.conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined) {
      return repositoryError("invalid_input", "conversation is deleted; tombstones beat late writes");
    }
    const turn = envelope.record.turns.find((candidate) => candidate.id === input.turnId);
    if (!turn) {
      return repositoryError("not_found", `turn ${input.turnId} not found`);
    }
    // Once an attempt is accepted the result is immutable: neither a
    // re-finalization of the accepted attempt nor a late sibling attempt may
    // change it (design D5, "late detached completion cannot overwrite
    // accepted output").
    if (turn.acceptedAttemptId) {
      return repositoryError(
        "invalid_input",
        "attempt superseded: another attempt is already accepted",
      );
    }
    const attempt = turn.attempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      return repositoryError("not_found", `attempt ${input.attemptId} not found`);
    }

    const finishedAt = Date.now();
    const finalStatus = input.assistantMessage
      ? "complete"
      : input.failureReason === "cancelled"
        ? "cancelled"
        : input.failureReason === "timeout"
          ? "failed"
          : "failed";
    const updatedAttempt: Attempt = {
      ...attempt,
      status: finalStatus,
      failureReason: input.failureReason,
      detached: input.detached || undefined,
      provider: input.provider ?? attempt.provider,
      finishedAt,
    };
    const assistantMessage: Message | undefined = input.assistantMessage
      ? {
          ...input.assistantMessage,
          conversationId: input.conversationId,
          turnId: input.turnId,
        }
      : undefined;
    const updatedTurn: Turn = {
      ...turn,
      status: finalStatus,
      attempts: turn.attempts.map((candidate) =>
        candidate.id === input.attemptId ? updatedAttempt : candidate,
      ),
      acceptedAttemptId: assistantMessage ? input.attemptId : turn.acceptedAttemptId,
      updatedAt: finishedAt,
    };
    const updated: ConversationRecord = {
      ...envelope.record,
      messages: assistantMessage
        ? [...envelope.record.messages, assistantMessage]
        : envelope.record.messages,
      turns: envelope.record.turns.map((candidate) =>
        candidate.id === input.turnId ? updatedTurn : candidate,
      ),
      revision: envelope.record.revision + 1,
      updatedAt: finishedAt,
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId: input.conversationId, revision: updated.revision, deleted: false });
    return repositoryOk({ turn: updatedTurn, assistantMessage });
  }

  async appendAttempt(
    input: AppendAttemptInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn }>> {
    const loaded = await this.readEnvelope(context.ownerProfileId, input.conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${input.conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    if (envelope.record.deletedAt !== undefined) {
      return repositoryError("invalid_input", "conversation is deleted; tombstones beat late writes");
    }
    const turn = envelope.record.turns.find((candidate) => candidate.id === input.turnId);
    if (!turn) {
      return repositoryError("not_found", `turn ${input.turnId} not found`);
    }
    if (turn.acceptedAttemptId) {
      return repositoryError(
        "invalid_input",
        "turn already has an accepted result; start a new turn instead",
      );
    }
    const attempt: Attempt = { ...input.attempt, turnId: input.turnId, status: "queued" };
    const updatedTurn: Turn = {
      ...turn,
      status: "queued",
      attempts: [...turn.attempts.filter((candidate) => candidate.id !== attempt.id), attempt],
      updatedAt: Date.now(),
    };
    const updated: ConversationRecord = {
      ...envelope.record,
      turns: envelope.record.turns.map((candidate) =>
        candidate.id === input.turnId ? updatedTurn : candidate,
      ),
      revision: envelope.record.revision + 1,
      updatedAt: updatedTurn.updatedAt,
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    this.emit({ conversationId: input.conversationId, revision: updated.revision, deleted: false });
    return repositoryOk({ turn: updatedTurn });
  }

  async reauthorizeSource(
    conversationId: string,
    attachmentId: string,
    authorized: { libraryId?: string; removed?: boolean },
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<SourceReference>> {
    const loaded = await this.readEnvelope<Conversation>(context.ownerProfileId, conversationId);
    if (loaded.kind === "missing") {
      return repositoryError("not_found", `conversation ${conversationId} not found`);
    }
    if (loaded.kind === "error") return loaded.result as RepositoryResult<never>;
    const { envelope } = loaded;
    const source = envelope.record.sourceHistory.find(
      (candidate) => candidate.attachmentId === attachmentId,
    );
    if (!source) {
      return repositoryError("not_found", `source ${attachmentId} not found`);
    }
    const updatedSource: SourceReference = {
      ...source,
      libraryId: authorized.libraryId ?? (authorized.removed ? undefined : source.libraryId),
      removedAt: authorized.removed ? Date.now() : source.removedAt,
    };
    const updated: ConversationRecord = {
      ...envelope.record,
      sourceHistory: envelope.record.sourceHistory.map((candidate) =>
        candidate.attachmentId === attachmentId ? updatedSource : candidate,
      ),
      revision: envelope.record.revision + 1,
      updatedAt: Date.now(),
    };
    const written = await this.writeRecord({ ownerProfileId: context.ownerProfileId, record: updated });
    if (!written.ok) return written as RepositoryResult<never>;
    return repositoryOk(updatedSource);
  }

  /* ------------------------------------------------------------------ */
  /* Subscription                                                       */
  /* ------------------------------------------------------------------ */

  subscribe(ownerProfileId: string, listener: RepositoryListener): Unsubscribe {
    const set = this.listeners.get(ownerProfileId) ?? new Set<RepositoryListener>();
    set.add(listener);
    this.listeners.set(ownerProfileId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(ownerProfileId);
    };
  }

  private emit(change: RepositoryChange): void {
    for (const [ownerProfileId, listeners] of this.listeners) {
      void ownerProfileId;
      for (const listener of listeners) {
        try {
          listener(change);
        } catch {
          // A listener must never break persistence.
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Export / import                                                    */
  /* ------------------------------------------------------------------ */

  async exportConversations(
    ownerProfileId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<RepositoryResult<ExportBundle>> {
    const keys = await this.store.list(`${RECORD_PREFIX}${ownerProfileId}:`);
    const conversations: ConversationRecord[] = [];
    for (const key of keys) {
      const record = await this.readRecord(ownerProfileId, key);
      if (!record) continue;
      if (!options?.includeDeleted && record.deletedAt !== undefined) continue;
      conversations.push(record);
    }
    return repositoryOk({
      formatVersion: 1,
      exportedAt: Date.now(),
      conversations,
    });
  }

  async importConversations(
    ownerProfileId: string,
    bundle: ExportBundle,
    checkpoint?: ImportCheckpoint,
  ): Promise<RepositoryResult<ImportCheckpoint>> {
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
    let importedConversations = checkpoint?.importedConversations ?? 0;
    let importedMessages = checkpoint?.importedMessages ?? 0;
    let quarantined = checkpoint?.quarantined ?? 0;

    for (let index = start; index < bundle.conversations.length; index++) {
      const record = bundle.conversations[index];
      // Identity + revision, not content alone: two distinct legacy threads
      // may carry byte-identical text and must stay distinct (spec:
      // "distinct legacy keys are distinct imported threads"). Non-object
      // records (corrupt primitives) digest on their serialized bytes alone.
      const identity =
        record && typeof record === "object" && typeof (record as { id?: unknown }).id === "string"
          ? (record as { id: string }).id
          : "unidentifiable";
      const digest = stableDigest(
        `${identity}\u0000${safeEncode(record)}`,
      );
      const journaled = await this.store.get(journalKey(ownerProfileId, digest));
      if (journaled) {
        // Already imported (or quarantined) in an earlier run: resumable and
        // exactly-once even across crashes.
        continue;
      }
      const decoded = decodeConversationRecord(record);
      if (!decoded.ok) {
        quarantined += 1;
        await this.store.set(
          quarantineKey(ownerProfileId, digest),
          JSON.stringify({
            ownerProfileId,
            origin: "bundle",
            digest,
            reason: decoded.reason ?? "unusable record",
            raw: record,
          } satisfies QuarantinedRecord & { ownerProfileId: string }),
        );
        await this.store.set(
          journalKey(ownerProfileId, digest),
          JSON.stringify({
            ownerProfileId,
            origin: "bundle",
            recordKey: "bundle",
            digest,
            status: "quarantined",
            reason: decoded.reason,
            importedAt: Date.now(),
          } satisfies ImportJournalRecord),
        );
        continue;
      }
      const value = decoded.value!;
      // Tombstones beat imports: an importing record must not resurrect a
      // locally deleted conversation.
      const existing = await this.readRecordByConversation(ownerProfileId, value.id);
      if (existing?.deletedAt !== undefined) {
        await this.store.set(
          journalKey(ownerProfileId, digest),
          JSON.stringify({
            ownerProfileId,
            origin: "bundle",
            recordKey: value.id,
            digest,
            status: "skipped",
            reason: "local tombstone wins",
            importedAt: Date.now(),
          } satisfies ImportJournalRecord),
        );
        continue;
      }
      const merged: ConversationRecord = existing
        ? {
            ...existing,
            messages: mergeMessages(existing.messages, value.messages),
            turns: mergeTurns(existing.turns, value.turns),
            revision: existing.revision + 1,
            updatedAt: Date.now(),
          }
        : { ...value, ownerProfileId, revision: value.revision + 1 };
      const written = await this.writeRecord({ ownerProfileId, record: merged });
      if (!written.ok) return written as RepositoryResult<never>;
      importedConversations += 1;
      importedMessages += value.messages.length;
      await this.store.set(
        journalKey(ownerProfileId, digest),
        JSON.stringify({
          ownerProfileId,
          origin: "bundle",
          recordKey: value.id,
          digest,
          status: "imported",
          assignedConversationId: value.id,
          importedAt: Date.now(),
        } satisfies ImportJournalRecord),
      );
    }

    return repositoryOk({
      cursor: String(bundle.conversations.length),
      importedConversations,
      importedMessages,
      quarantined,
    });
  }

  async listQuarantined(ownerProfileId: string): Promise<RepositoryResult<QuarantinedRecord[]>> {
    const keys = await this.store.list(`${QUARANTINE_PREFIX}${ownerProfileId}:`);
    const records: QuarantinedRecord[] = [];
    for (const key of keys) {
      const raw = await this.store.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          origin: string;
          digest: string;
          reason: string;
          raw: unknown;
        };
        records.push({
          origin: parsed.origin,
          digest: parsed.digest,
          reason: parsed.reason,
          raw: parsed.raw,
        });
      } catch {
        // Corrupt quarantine entry: keep the key itself as evidence.
        records.push({ origin: "unknown", digest: key, reason: "unreadable", raw: raw });
      }
    }
    return repositoryOk(records);
  }

  /** Import journal, for import reports and tests. */
  async listImportJournal(ownerProfileId: string): Promise<ImportJournalRecord[]> {
    const keys = await this.store.list(`${JOURNAL_PREFIX}${ownerProfileId}:`);
    const records: ImportJournalRecord[] = [];
    for (const key of keys) {
      const raw = await this.store.get(key);
      if (!raw) continue;
      try {
        records.push(JSON.parse(raw) as ImportJournalRecord);
      } catch {
        // unreadable journal entry: skip, never crash import reporting
      }
    }
    return records;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private checkRevision(
    record: ConversationRecord,
    expectedRevision: number | undefined,
  ): RepositoryResult<never> | null {
    if (expectedRevision === undefined) return null;
    if (record.revision !== expectedRevision) {
      return repositoryError(
        "revision_conflict",
        `revision conflict: expected ${expectedRevision}, current ${record.revision}`,
        record.revision,
      );
    }
    return null;
  }

  private async readRecord(
    ownerProfileId: string,
    key: string,
  ): Promise<ConversationRecord | null> {
    const raw = await this.store.get(key);
    if (!raw) return null;
    try {
      const envelope = JSON.parse(raw) as PersistedEnvelope;
      if (envelope.ownerProfileId !== ownerProfileId) return null;
      const decoded = decodeConversationRecord(envelope.record);
      return decoded.ok ? decoded.value : null;
    } catch {
      return null;
    }
  }

  private async readRecordByConversation(
    ownerProfileId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    return this.readRecord(ownerProfileId, recordKey(ownerProfileId, conversationId));
  }

  private async readEnvelope<T>(
    ownerProfileId: string,
    conversationId: string,
  ): Promise<
    | { kind: "ok"; envelope: PersistedEnvelope }
    | { kind: "missing" }
    | { kind: "error"; result: RepositoryResult<T> }
  > {
    const key = recordKey(ownerProfileId, conversationId);
    let raw: string | undefined;
    try {
      raw = await this.store.get(key);
    } catch (error) {
      const { code, message } = toConversationError(error);
      return { kind: "error", result: repositoryError(code, message) };
    }
    if (!raw) return { kind: "missing" };
    try {
      const envelope = JSON.parse(raw) as PersistedEnvelope;
      if (envelope.ownerProfileId !== ownerProfileId) return { kind: "missing" };
      const decoded = decodeConversationRecord(envelope.record);
      if (!decoded.ok) return { kind: "missing" };
      return { kind: "ok", envelope: { ...envelope, record: decoded.value! } };
    } catch {
      return { kind: "missing" };
    }
  }

  /**
   * Persist one record. Generic in `T` only so the caller's success type is
   * preserved through a failure branch; no value is fabricated here.
   */
  private async writeRecord(
    envelope: PersistedEnvelope,
  ): Promise<RepositoryResult<void>> {
    try {
      await this.store.set(
        recordKey(envelope.ownerProfileId, envelope.record.id),
        JSON.stringify(envelope),
      );
      await this.store.indexAdd("conversations", envelope.record.id);
      return repositoryOk(undefined);
    } catch (error) {
      const { code, message } = toConversationError(error);
      return repositoryError<void>(code, message);
    }
  }

  private async findRecordKeyAcrossPartitions(
    conversationId: string,
    ownerProfileId: string,
  ): Promise<string | null> {
    const keys = await this.store.list(RECORD_PREFIX);
    for (const key of keys) {
      if (key.startsWith(`${RECORD_PREFIX}${ownerProfileId}:`)) continue;
      if (key.endsWith(`:${conversationId}`)) return key;
    }
    return null;
  }
}

export function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
}

function mergeTurns(existing: Turn[], incoming: Turn[]): Turn[] {
  const byId = new Map(existing.map((turn) => [turn.id, turn]));
  for (const turn of incoming) {
    if (!byId.has(turn.id)) byId.set(turn.id, turn);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}
