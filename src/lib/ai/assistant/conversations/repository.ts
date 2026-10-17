/**
 * `ConversationRepository` — the single durable owner contract (design D1).
 *
 * Every mutation is partitioned by `ownerProfileId` and guarded by an
 * expected revision. Adapters implement this interface exactly; no surface
 * may keep a competing writable store. A repository acknowledgment is the
 * only basis for a "Saved" indicator.
 */

import type {
  AppendAttemptInput,
  AppendTurnInput,
  Conversation,
  ConversationRecord,
  Draft,
  FinalizeAttemptInput,
  Message,
  RepositoryPage,
  SourceReference,
  Turn,
} from "./types";

/** Typed repository failures; callers must handle all of them. */
export type RepositoryErrorCode =
  | "not_found"
  | "revision_conflict"
  | "quota_exceeded"
  | "storage_unavailable"
  | "invalid_input"
  | "partition_mismatch"
  | "unsupported";

export interface RepositoryError {
  code: RepositoryErrorCode;
  /** Human-readable, localizable reason key/message. */
  message: string;
  /** Current revision when the failure was a conflict. */
  currentRevision?: number;
}

/**
 * Result of a repository call. An interface (not a union) on purpose: the
 * value/error pair is mutually exclusive by convention, and interfaces narrow
 * predictably under every TypeScript version the app supports.
 */
export interface RepositoryResult<T> {
  ok: boolean;
  /** Present iff `ok`. */
  value?: T;
  /** Present iff `!ok`. */
  error?: RepositoryError;
}

export const repositoryOk = <T>(value: T): RepositoryResult<T> => ({ ok: true, value });
export const repositoryError = <T = never>(
  code: RepositoryErrorCode,
  message: string,
  currentRevision?: number,
): RepositoryResult<T> => ({ ok: false, error: { code, message, currentRevision } });

/** Optional guards applied at the repository boundary. */
export interface RepositoryMutationContext {
  ownerProfileId: string;
  /** Optimistic concurrency token; mismatch fails with `revision_conflict`. */
  expectedRevision?: number;
  /** Guards a mutation whose target must not be a tombstoned conversation. */
  allowDeleted?: boolean;
}

export interface RepositoryListOptions {
  /** Include tombstones (deleted conversations) when true. */
  includeDeleted?: boolean;
  /** Include conversations with no completed turns (fresh drafts). */
  includeEmpty?: boolean;
  limit?: number;
  cursor?: string;
  /** Full-text prefilter applied by the adapter when cheap; never authoritative. */
  search?: string;
}

export interface CreateConversationInput {
  id?: string;
  ownerProfileId: string;
  title?: string;
  collectionId?: string;
  contextPolicy?: Conversation["contextPolicy"];
  syncPolicy?: Conversation["syncPolicy"];
  legacyAliases?: string[];
}

export interface ConversationMetadataPatch {
  title?: string;
  collectionId?: string | null;
  contextPolicy?: Conversation["contextPolicy"];
  activeAttachments?: Conversation["activeAttachments"];
  sourceHistory?: Conversation["sourceHistory"];
  syncPolicy?: Conversation["syncPolicy"];
}

export interface CommitDraftInput {
  conversationId: string;
  draft: Omit<Draft, "conversationId">;
}

export interface ImportCheckpoint {
  /** Opaque adapter cursor: re-importing resumes from the last acknowledged record. */
  cursor?: string;
  importedConversations: number;
  importedMessages: number;
  quarantined: number;
}

export interface QuarantinedRecord {
  /** Origin label, e.g. "sidebar", "qa-sessions", "sqlite". */
  origin: string;
  /** Stable digest so repeated imports do not double-count the same bytes. */
  digest: string;
  reason: string;
  /** Raw bytes preserved for user-visible recovery/export. */
  raw: unknown;
}

export interface ExportBundle {
  formatVersion: 1;
  exportedAt: number;
  conversations: ConversationRecord[];
}

export interface RepositoryChange {
  conversationId: string;
  revision: number;
  /** True when the record was removed (tombstoned) by this change. */
  deleted: boolean;
}

export type RepositoryListener = (change: RepositoryChange) => void;

export interface Unsubscribe {
  (): void;
}

/**
 * Adapter capabilities, reported honestly so the UI never claims sync or
 * durability it does not have (browser adapters are device-local).
 */
export interface RepositoryCapabilities {
  /** Cross-device sync availability; false in browsers. */
  nativeSync: boolean;
  /** True when transactions are durable across process death. */
  durableTransactions: boolean;
  /** Storage location label for user-facing copy. */
  location: "device" | "account";
}

export interface ConversationRepository {
  readonly capabilities: RepositoryCapabilities;

  /** Ordered conversation summaries, most recently updated first. */
  listConversations(
    ownerProfileId: string,
    options?: RepositoryListOptions,
  ): Promise<RepositoryPage<Conversation>>;

  /** One full record including messages, turns and draft. */
  getConversation(
    ownerProfileId: string,
    conversationId: string,
  ): Promise<RepositoryResult<ConversationRecord>>;

  createConversation(
    input: CreateConversationInput,
  ): Promise<RepositoryResult<Conversation>>;

  updateMetadata(
    conversationId: string,
    patch: ConversationMetadataPatch,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<Conversation>>;

  /** Soft-delete; tombstones defeat late retries/imports. */
  deleteConversation(
    conversationId: string,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ id: string; deletedAt: number }>>;

  /** Commit the working draft without touching messages/turns. */
  commitDraft(
    conversationId: string,
    input: CommitDraftInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<Draft>>;

  /**
   * Atomically append the user message + pending turn and update the draft
   * checkpoint. Implementations MUST NOT dispatch a request before this
   * returns `ok`.
   */
  appendTurn(
    input: AppendTurnInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn; userMessage: Message }>>;

  /**
   * Finalize an attempt: mark its terminal status and, on success, append the
   * validated assistant message in the same transaction. Late attempts cannot
   * overwrite an accepted attempt id.
   */
  finalizeAttempt(
    input: FinalizeAttemptInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn; assistantMessage?: Message }>>;

  /**
   * Append a retry attempt to an existing turn (same user message, new
   * attempt identity). Refused once the turn has an accepted result.
   */
  appendAttempt(
    input: AppendAttemptInput,
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<{ turn: Turn }>>;

  /** Re-authorize a source edge against current permissions (task 2.6). */
  reauthorizeSource(
    conversationId: string,
    attachmentId: string,
    authorized: { libraryId?: string; removed?: boolean },
    context: RepositoryMutationContext,
  ): Promise<RepositoryResult<SourceReference>>;

  subscribe(ownerProfileId: string, listener: RepositoryListener): Unsubscribe;

  exportConversations(
    ownerProfileId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<RepositoryResult<ExportBundle>>;

  /** Idempotent, resumable import used by migration (task 1.5). */
  importConversations(
    ownerProfileId: string,
    bundle: ExportBundle,
    checkpoint?: ImportCheckpoint,
  ): Promise<RepositoryResult<ImportCheckpoint>>;

  listQuarantined(ownerProfileId: string): Promise<RepositoryResult<QuarantinedRecord[]>>;
}

/**
 * The profile id used as the repository partition. Accounts use their account
 * id; anonymous users use a stable local profile id. Kept as a plain function
 * so the repository contract stays free of store imports.
 */
export function localProfileId(stableDeviceId: string): string {
  return `local:${stableDeviceId}`;
}

export function accountProfileId(accountId: string): string {
  return `account:${accountId}`;
}
