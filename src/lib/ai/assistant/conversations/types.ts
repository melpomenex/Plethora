/**
 * Canonical conversation contracts (design D2 of `unify-assistant-experience`).
 *
 * Version-2 records that every Assistant presentation reads and writes
 * through one repository. This module is deliberately the *only* place the
 * durable shapes are declared; adapters (SQLite, IndexedDB) and the turn
 * controller depend on it, never on each other.
 *
 * Invariants held here and enforced by `serialize.ts`:
 *  - Unknown persisted payloads are preserved verbatim (`legacyPayload` /
 *    `unknownFields`) rather than dropped.
 *  - No fabricated evidence: `citation`/`evidenceStatus` values are only ever
 *    constructed from validated data; hydration never invents them.
 *  - Identity is source-independent; changing a document never changes a
 *    conversation ID.
 */

import type { AssistantScope } from "../scopes";

export const CONVERSATION_RECORD_VERSION = 2 as const;

/* ------------------------------------------------------------------ */
/* Provenance and source references                                    */
/* ------------------------------------------------------------------ */

/** Where a persisted piece of source material came from. */
export type EvidenceOrigin =
  | "library"
  | "active-source"
  | "selection"
  | "web"
  | "model"
  | "mixed";

/** Honest evidence strength; never derived from an excerpt's presence alone. */
export type EvidenceLevel =
  | "supported"
  | "weak"
  | "conflicting"
  | "none"
  | "unverified";

export type RetrievalMode = "semantic" | "lexicalOnly" | "none";

export interface EvidenceCoverage {
  /** Documents/chunks supplied to the model for this turn. */
  suppliedCount: number;
  /** Sources actually cited by the validated answer. */
  citedCount: number;
  /** Documents examinable under the frozen plan but not retrieved. */
  eligibleCount?: number;
  /** Index freshness at the time of the turn (ISO timestamp if known). */
  indexFreshness?: string;
  /** True when the plan knowingly examined only part of the eligible set. */
  partialCoverage?: boolean;
  /** Human-visible limitations, e.g. "transcript is partial". */
  limitations?: string[];
}

export interface EvidenceStatus {
  origin: EvidenceOrigin;
  level: EvidenceLevel;
  retrievalMode: RetrievalMode;
  coverage?: EvidenceCoverage;
  /** True when the answer was produced with no source material at all. */
  sourceFree?: boolean;
}

/**
 * One source as it existed when a turn was frozen. `libraryId` is present
 * only for real library documents; ephemeral viewer content carries an
 * `ephemeral` capability reference instead and must never be looked up as a
 * library document.
 */
export interface SourceReference {
  /** Stable attachment identity within the conversation. */
  attachmentId: string;
  kind: "document" | "video" | "web" | "selection" | "library";
  /** Real library document id when this is an authorized library source. */
  libraryId?: string;
  /** Device-local ephemeral identity (unsaved RSS/web/viewer content). */
  ephemeral?: EphemeralSourceToken;
  title: string;
  sourceType?: string;
  /** Content revision/hash the attachment was frozen against. */
  contentVersion?: string;
  /** Source-appropriate position, e.g. page, CFI/section, timestamp. */
  locator?: SourceLocator;
  origin: "active-view" | "selection" | "mention" | "picker" | "history" | "entry";
  role: "optional" | "required" | "strict";
  /** Set when the user removed the attachment; suppresses reattachment. */
  removedAt?: number;
}

/**
 * Live viewer capability for unsaved content. `ownerToken` is validated
 * process-local; it is never a substitute for library metadata and never
 * appears in sync payloads.
 */
export interface EphemeralSourceToken {
  ownerToken: string;
  sourceType: string;
  /** Local-only by construction: ephemeral content never syncs. */
  localOnly: true;
}

/** Source-appropriate location. Never interchanged between source types. */
export interface SourceLocator {
  /** PDF page (1-based). */
  page?: number;
  /** EPUB CFI or stable section id. */
  cfi?: string;
  sectionId?: string;
  /** Media timestamp in seconds. */
  timeSeconds?: number;
  /** Character range for HTML/Markdown/text sources. */
  textRange?: { start: number; end: number };
  /** HTML/Markdown stable anchor. */
  anchor?: string;
  /** Optional PDF highlight rectangles. */
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Bounded context text shipped with the location when applicable. */
  quote?: string;
}

/** A frozen selection snapshot, original and edited form kept separately. */
export interface SelectionSnapshot {
  /** The exact captured passage, verbatim. */
  originalText: string;
  /** Present when the user edited the attached passage. */
  editedText?: string;
  documentId?: string;
  title?: string;
  locator?: SourceLocator;
  /** Live-source kind for ephemeral selections. */
  ephemeral?: EphemeralSourceToken;
}

/* ------------------------------------------------------------------ */
/* Context policy and attachments                                      */
/* ------------------------------------------------------------------ */

export type ContextPolicyMode = "auto" | "chat" | "document" | "library";
export type ContextPolicyOrigin = "explicit" | "entry" | "inferred";

/** Restriction expressed by the user; `undefined` means "no restriction". */
export interface ContextPolicy {
  mode: ContextPolicyMode;
  origin: ContextPolicyOrigin;
  /** Strict restrictions: only these library documents may be retrieved. */
  allowedDocumentIds?: string[];
  /** Optional collection restriction. */
  collectionId?: string;
  /** Optional source-type restriction. */
  sourceTypes?: string[];
  /** Whether the user has authorized web lookup for this conversation. */
  webAllowed?: boolean;
}

/** A visible, removable attachment shown in the composer. */
export interface SourceAttachment extends SourceReference {
  /** True while this attachment contributes to the *next* turn's plan. */
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Citations and tool artifacts                                        */
/* ------------------------------------------------------------------ */

export type CitationValidationStatus =
  | "verified"
  | "invalid"
  | "unresolved"
  /** Legacy answer text with no structural evidence (never promoted). */
  | "legacy";

export interface Citation {
  /** Stable citation identity within the conversation. */
  id: string;
  /** The `[N]` number the prompt assigned; never recomputed after filtering. */
  displayNumber: number;
  /** Retrieval chunk id or selection ref id the model cited. */
  refId?: string;
  chunkId?: string;
  /** Question segment/claim bindings within the answer text. */
  claimBindings?: string[];
  /** Verbatim quote validated against the supplied source text. */
  quote?: string;
  documentId?: string;
  title?: string;
  sourceType?: string;
  contentVersion?: string;
  headingPath?: string[];
  locator?: SourceLocator;
  origin: "library" | "selection" | "web";
  /** Real retrieved URL for web citations (never guessed). */
  url?: string;
  validation: CitationValidationStatus;
}

export interface ToolResultReference {
  /** Tool the model requested. */
  name: string;
  status: "pending" | "success" | "error";
  /** Idempotency key recorded before execution; retries never replay. */
  idempotencyKey?: string;
  /** Real created artifact ids; only user-promoted artifacts are indexed. */
  artifactIds?: string[];
  resultSummary?: string;
  executedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Messages, turns and drafts                                          */
/* ------------------------------------------------------------------ */

export interface ProviderProvenance {
  /** Stable configuration id, e.g. the key of the configured provider. */
  configurationId: string;
  /** Resolved provider kind at dispatch, e.g. "cloud" / "on-device". */
  kind: string;
  model: string;
  /** Capabilities actually used for this attempt. */
  capabilities?: {
    streaming?: boolean;
    structured?: boolean;
    vision?: boolean;
  };
  /** Actual fallback applied, when generation did not use the primary path. */
  fallbackUsed?: string;
  /** Whether the destination was on-device or remote. */
  locality: "on-device" | "remote";
}

export interface Message {
  id: string;
  conversationId: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
  /** Sortable order key; stable for imported records (see migration). */
  orderKey: string;
  content: string;
  /** Separated model thinking; never replayed as context. */
  thinking?: string;
  /** Sources supplied to the model for this turn (validated subset). */
  sourceSnapshot?: SourceReference[];
  citations?: Citation[];
  evidence?: EvidenceStatus;
  provider?: ProviderProvenance;
  toolResults?: ToolResultReference[];
  artifactIds?: string[];
  /**
   * Raw record exactly as it existed in legacy storage. Preserved so unknown
   * fields survive migration and rollback reads; never rendered or indexed.
   */
  legacyPayload?: unknown;
}

export type TurnStatus =
  | "queued"
  | "resolving"
  | "retrieving"
  | "preparing"
  | "generating"
  | "validating"
  | "complete"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TurnFailureReason =
  | "provider_error"
  | "validation_failure"
  | "timeout"
  | "cancelled"
  | "source_unavailable"
  | "privacy_denied"
  | "process_interrupted";

export interface Attempt {
  id: string;
  turnId: string;
  /** The frozen plan actually dispatched for this attempt. */
  requestPlan: FrozenTurnPlan;
  status: TurnStatus;
  startedAt: number;
  finishedAt?: number;
  failureReason?: TurnFailureReason;
  /** Set when the transport could not be aborted: output detached. */
  detached?: boolean;
  provider?: ProviderProvenance;
}

/**
 * The immutable, authorized snapshot a turn is reproducible from. Everything
 * needed to explain what was sent where lives here.
 */
export interface FrozenTurnPlan {
  conversationId: string;
  turnId: string;
  /** The user's raw question text. */
  question: string;
  /** Raw `@` mention tokens as typed, preserved for replay/audit. */
  mentionTokens: Array<{ token: string; kind: "document" | "section"; id?: string }>;
  /** Effective policy for this turn (not "whatever the switches say now"). */
  policy: ContextPolicy;
  /** Sources frozen for this turn. */
  sources: SourceReference[];
  /** The selected passage, original + edited, when present. */
  selection?: SelectionSnapshot;
  /** Provider plan: configuration, resolved destination and fallbacks. */
  provider: {
    configurationId: string;
    kind: string;
    model: string;
    locality: "on-device" | "remote";
    /** Planned fallback chain in evaluation order. */
    fallback?: string[];
  };
  /** History source edges used to resolve references in this turn. */
  historySourceIds?: string[];
  /** Bounded context accounting for the plan. */
  budget?: {
    contextTokens?: number;
    suppliedChars?: number;
    truncated?: boolean;
  };
  /** Monotonic epoch guarding against stale attempt application. */
  requestEpoch: number;
}

export interface Turn {
  id: string;
  conversationId: string;
  /** Parent turn for follow-ups; a branch is a new turn with a parent. */
  parentTurnId?: string;
  userMessageId: string;
  requestPlan: FrozenTurnPlan;
  status: TurnStatus;
  attempts: Attempt[];
  /** The attempt whose output was accepted; late attempts never overwrite. */
  acceptedAttemptId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MentionToken {
  token: string;
  kind: "document" | "section";
  id?: string;
  label?: string;
}

export interface Draft {
  conversationId: string;
  /** Drafts are per device; remote snapshots are separate alternatives. */
  deviceId: string;
  revision: number;
  text: string;
  attachments: SourceAttachment[];
  mentionTokens: MentionToken[];
  selection?: SelectionSnapshot;
  updatedAt: number;
}

/** A received remote draft snapshot; never overwrites a dirty local draft. */
export interface DraftAlternative {
  conversationId: string;
  deviceId: string;
  text: string;
  attachments: SourceAttachment[];
  receivedAt: number;
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export type SyncPolicy = "eligible" | "device-local";

export interface Conversation {
  version: typeof CONVERSATION_RECORD_VERSION;
  id: string;
  /** Account or local-profile partition; all reads/writes are scoped to it. */
  ownerProfileId: string;
  collectionId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Optimistic concurrency revision; every mutation bumps it. */
  revision: number;
  contextPolicy: ContextPolicy;
  activeAttachments: SourceAttachment[];
  sourceHistory: SourceReference[];
  syncPolicy: SyncPolicy;
  deletedAt?: number;
  /** Original identity keys this conversation was imported from. */
  legacyAliases: string[];
  /** Unknown fields preserved from a legacy record, never interpreted. */
  unknownFields?: Record<string, unknown>;
}

/** Ordered conversation view used by every presentation. */
export interface ConversationRecord extends Conversation {
  messages: Message[];
  turns: Turn[];
  draft?: Draft;
  /** Remote draft alternatives, offered separately, never auto-applied. */
  draftAlternatives?: DraftAlternative[];
}

/* ------------------------------------------------------------------ */
/* Entry intents                                                       */
/* ------------------------------------------------------------------ */

/**
 * A typed request to open or prefill a conversation. Palette, selection Ask,
 * mobile add-menu and reader entries all funnel through this shape.
 */
export interface EntryIntent {
  /** Stable id so exactly-once acknowledgment can be verified. */
  intentId: string;
  kind: "open" | "prefill";
  /** Existing conversation to target, when the entry names one. */
  conversationId?: string;
  /** Question text to prefill; never auto-submitted. */
  question?: string;
  sourceAttachments?: SourceReference[];
  restriction?: ContextPolicy;
  selectionSnapshot?: SelectionSnapshot;
  /** Where the entry came from; used for the return record. */
  origin?: {
    surface: string;
    conversationId?: string;
    readerLocator?: SourceLocator;
  };
}

/* ------------------------------------------------------------------ */
/* Repository results                                                  */
/* ------------------------------------------------------------------ */

export interface RepositoryPage<T> {
  items: T[];
  /** Opaque cursor for the next page; absent when exhausted. */
  nextCursor?: string;
}

export interface AppendTurnInput {
  conversationId: string;
  expectedRevision: number;
  userMessage: Message;
  turn: Turn;
  /** Draft checkpoint committed atomically with the turn, when provided. */
  draftCheckpoint?: Pick<Draft, "text" | "attachments" | "mentionTokens" | "selection">;
}

export interface FinalizeAttemptInput {
  conversationId: string;
  turnId: string;
  attemptId: string;
  status: TurnStatus;
  assistantMessage?: Message;
  failureReason?: TurnFailureReason;
  detached?: boolean;
  provider?: ProviderProvenance;
}

export interface AppendAttemptInput {
  conversationId: string;
  turnId: string;
  /** The revalidated plan for the retry attempt. */
  attempt: Attempt;
}

/* ------------------------------------------------------------------ */
/* Defaults and guards                                                 */
/* ------------------------------------------------------------------ */

export function defaultContextPolicy(mode: ContextPolicyMode = "auto"): ContextPolicy {
  return { mode, origin: "explicit" };
}

const TURN_STATUSES: readonly TurnStatus[] = [
  "queued", "resolving", "retrieving", "preparing", "generating",
  "validating", "complete", "failed", "cancelled", "interrupted",
];

export function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === "string" && (TURN_STATUSES as readonly string[]).includes(value);
}

const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  "supported", "weak", "conflicting", "none", "unverified",
];

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === "string" && (EVIDENCE_LEVELS as readonly string[]).includes(value);
}

const EVIDENCE_ORIGINS: readonly EvidenceOrigin[] = [
  "library", "active-source", "selection", "web", "model", "mixed",
];

export function isEvidenceOrigin(value: unknown): value is EvidenceOrigin {
  return typeof value === "string" && (EVIDENCE_ORIGINS as readonly string[]).includes(value);
}

const CONTEXT_MODES: readonly ContextPolicyMode[] = ["auto", "chat", "document", "library"];

export function isContextPolicyMode(value: unknown): value is ContextPolicyMode {
  return typeof value === "string" && (CONTEXT_MODES as readonly string[]).includes(value);
}

/** True when the policy is a strict restriction rather than optional context. */
export function isStrictPolicy(policy: ContextPolicy): boolean {
  return policy.mode === "document" || policy.mode === "library";
}

/** The scope the engine should apply for an effective policy. */
export function toAssistantScope(policy: ContextPolicy): AssistantScope {
  return policy.mode === "library" ? "library" : policy.mode === "document" ? "document" : "chat";
}

/**
 * A no-evidence status for a model-knowledge answer. Exists so callers never
 * need to invent `supported` merely because some excerpt was attached.
 */
export function modelKnowledgeEvidence(): EvidenceStatus {
  return { origin: "model", level: "none", retrievalMode: "none", sourceFree: true };
}

/**
 * Map legacy/stored evidence-bearing content into `unverified` unless a
 * validator has explicitly confirmed support. Used by import/hydration.
 */
export function unverifiedEvidence(origin: EvidenceOrigin = "mixed"): EvidenceStatus {
  return { origin, level: "unverified", retrievalMode: "none" };
}
