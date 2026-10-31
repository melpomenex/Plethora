/**
 * Constrained-agent tool layer types (design D25, tasks 8.1 + complete-agent
 * 3.1).
 *
 * Every tool is a typed record with:
 *  - a `name` + model-facing `description`;
 *  - a hand-written `validate(input)` (schemas/common style) that rejects
 *    unknown parameters, wrong types, and out-of-range limits — BEFORE any
 *    API is touched;
 *  - an `execute(input, ctx)` returning a typed `AgentToolResult`.
 *
 * Tool results are DATA: the loop wraps every `result` block in an
 * `<untrusted_source>` fence before it re-enters a prompt (D9), and tools
 * never execute writes — proposal tools only accumulate candidates in the
 * session for the user-approval UIs.
 *
 * Source binding (task 3.1): the application owns source identity. Read tools
 * register the records they returned in the run's `AgentEvidenceMap` and hand
 * back opaque `sourceHandles`; proposal tools resolve only those handles (or
 * exact text from those records). `proposalId` is assigned by the session, not
 * by the model.
 */

import type { ValidationOutcome } from "../../schemas/common";
import type { AgentEvidenceMap } from "../evidence";

/** Tool categories the loop tracks (retrieval tools consume hop budget). */
export type AgentToolCategory = "read" | "retrieval" | "propose";

/** Typed outcome categories recorded in the trace (never content). */
export type AgentToolOutcome =
  | "ok"
  | "invalid-input"
  | "not-found"
  | "not-available"
  | "rejected"
  | "error";

/** A navigable reference a read-only tool returned (final-answer citations). */
export interface AgentSourceRef {
  /** Stable id of the referenced object (chunk/card/document/extract). */
  refId: string;
  kind: "chunk" | "card" | "document" | "extract";
  documentId?: string;
  title?: string;
  /** Human-readable locator (heading path, page, question side, …). */
  locator?: string;
  /** Source revision at freeze time when known. */
  contentVersion?: string;
}

/**
 * A source a proposal is grounded in. `handle` is the application-assigned
 * evidence handle the model cited; `text` is the exact source text captured
 * for validation and persistence (never model-authored).
 */
export interface AgentProposalSourceRef extends AgentSourceRef {
  handle: string;
  /** Frozen source revision/hash for stale-source checks. */
  sourceRevision?: string;
  /** Exact supporting source text (bounded by the tool that produced it). */
  text: string;
}

export interface AgentToolResult {
  /** False for every typed non-success outcome (not-found, invalid, …). */
  ok: boolean;
  outcome: AgentToolOutcome;
  /**
   * Machine-readable payload re-entering the model as an untrusted block.
   * Structured JSON-friendly data — never free-form system text.
   */
  result: unknown;
  /** One-line human digest for the run-progress stream. */
  displayDigest: string;
  /** Navigable refs surfaced beside the final answer in the sheet. */
  sources?: AgentSourceRef[];
}

export interface AgentToolProposalBase {
  /** Proposal kind discriminator for the review UI hand-off. */
  kind: "extract" | "flashcard" | "cloze" | "occlusion" | "tag";
  /** Where the proposal came from (current selection / recent context). */
  sourceText: string;
  /** Application-assigned identity (`<runId>:p<n>`), never model input. */
  proposalId: string;
  /** Sources resolved from the run evidence map (at least one). */
  sourceRefs: AgentProposalSourceRef[];
  /** Revision of the frozen sources this proposal was generated from. */
  sourceRevision?: string;
  /** Verbatim quote supporting the proposal (bounded, ≤300 chars used). */
  evidenceQuote?: string;
  createdAt: number;
}

export interface AgentExtractProposal extends AgentToolProposalBase {
  kind: "extract";
  documentId: string;
  text: string;
  note?: string;
}

export interface AgentCardProposal extends AgentToolProposalBase {
  kind: "flashcard" | "cloze";
  question: string;
  answer: string;
  cardType: string;
  documentId?: string;
  /** Optional concept label used for the 2-per-concept preview cap. */
  concept?: string;
  /** Application-derived concept keys (never a raw model id). */
  conceptKeys?: string[];
  tags?: string[];
}

export interface AgentOcclusionProposal extends AgentToolProposalBase {
  kind: "occlusion";
  imageAssetId: string;
  documentId?: string;
}

export interface AgentTagProposal extends AgentToolProposalBase {
  kind: "tag";
  itemId: string;
  itemQuestion: string;
  existingTags: string[];
  tag: string;
}

export type AgentProposal =
  | AgentExtractProposal
  | AgentCardProposal
  | AgentOcclusionProposal
  | AgentTagProposal;

/** What a proposal tool submits; the session assigns identity/timestamp. */
export type AgentProposalInput =
  | Omit<AgentExtractProposal, "proposalId" | "createdAt">
  | Omit<AgentCardProposal, "proposalId" | "createdAt">
  | Omit<AgentOcclusionProposal, "proposalId" | "createdAt">
  | Omit<AgentTagProposal, "proposalId" | "createdAt">;

/** Per-run mutable session state proposal tools accumulate into. */
export interface AgentSessionRuntime {
  /** Stable run identity used for proposal ids/target ids. */
  runId: string;
  /** Accumulated proposals, capped by bounds (≤ 20) regardless of output. */
  proposals: AgentProposal[];
  /** True once the proposal cap rejected an attempt (loop explains it). */
  proposalCapHit: boolean;
  /** Per-run source evidence (handles → exact records). */
  evidence: AgentEvidenceMap;
  /** Frozen source revision for proposals. */
  sourceRevision?: string;
  /** Set when the run ended/cancelled: late tools cannot add proposals. */
  closed: boolean;
  /** Assigns identity; returns null when the cap/closed state rejects it. */
  addProposal(proposal: AgentProposalInput): AgentProposal | null;
  /** Close the session so late async proposals are discarded. */
  close(): void;
}

/** Injected environment: every external API the tools touch. */
export interface AgentDocumentSummary {
  id: string;
  title: string;
  fileType: string;
  currentPage?: number;
  totalPages?: number;
  progressPercent?: number;
}

export interface AgentSelectionSummary {
  text: string;
  documentId?: string;
}

export interface AgentSectionContext {
  documentId: string;
  title?: string;
  /** Bounded section text resolved at submit. */
  text: string;
  locator?: string;
  sourceRevision?: string;
}

export interface AgentCardQuery {
  /** Server-side text filter over question/answer/cloze/tags. */
  text?: string;
  /** Restrict to the run's frozen documents. */
  documentIds?: string[];
  /** Hard row cap (tools clamp further). */
  limit?: number;
}

export interface AgentEnvironment {
  /**
   * "frozen": tools must only cite evidence registered during this run and
   *           document reads are restricted to the frozen source set.
   * "global": legacy/injected test environment (document tools read the
   *           current global context). Production runs always use "frozen".
   */
  sourceScope?: "global" | "frozen";
  /** Frozen source-set revision stamped onto proposals/evidence. */
  sourceRevision?: string;
  /** Semantic retrieval (FTS5 lexical fallback inside the Rust command). */
  retrieve(
    query: string,
    options: { k?: number; filters?: { documentIds?: string[]; sourceTypes?: string[] } }
  ): Promise<{
    results: Array<{
      chunkId: string;
      documentId: string;
      documentTitle?: string;
      sourceType: string;
      sourceId?: string;
      text: string;
      headingPath: string[];
      score: number;
      mode: string;
    }>;
    mode: string;
  }>;
  getDocument(): AgentDocumentSummary | null;
  getSelection(): AgentSelectionSummary | null;
  /**
   * The complete frozen attached-source set. A multi-document run uses this
   * to disclose exactly which papers are in scope (and which are missing).
   */
  listSources?(): Array<{
    attachmentId: string;
    documentId?: string;
    title: string;
    contentVersion?: string;
    role?: "optional" | "required" | "strict";
  }>;
  /** Frozen section/chapter context when the run resolved one. */
  getSectionContext?(): Promise<AgentSectionContext | null>;
  /** Recently touched extracts, newest first (the "what I just read" proxy). */
  getRecentExtracts(limit: number): Promise<
    Array<{
      id: string;
      documentId: string;
      documentTitle?: string;
      content: string;
      dateModified: string;
    }>
  >;
  /**
   * Bounded card reads. Production implementations MUST filter server-side
   * and never materialize the whole library; `documentIds` is the frozen set.
   */
  getCards(options?: AgentCardQuery): Promise<
    Array<{
      id: string;
      question: string;
      answer?: string;
      clozeText?: string;
      itemType: string;
      state: string;
      dueDate: string;
      reviewCount: number;
      lapses: number;
      lastReviewDate?: string;
      tags: string[];
      documentId?: string;
    }>
  >;
  getDueCards(limit?: number): Promise<
    Array<{
      id: string;
      question: string;
      itemType: string;
      dueDate: string;
      documentId?: string;
    }>
  >;
  /** Aggregate review statistics (counts only — no user content). */
  getReviewStats(): Promise<{
    totalItems: number;
    totalReviews: number;
    totalLapses: number;
    avgInterval: number;
    retentionEstimate: number;
    dueToday: number;
    dueWeek: number;
    dueMonth: number;
  }>;
  /** Image-asset existence check for `propose_occlusion` (id authority). */
  getImageAsset(
    assetId: string
  ): Promise<{ id: string; fileName?: string } | null>;
  /** Abort signal used by tools to stop before registering proposals. */
  signal?: AbortSignal;
  /** Remaining run milliseconds (tools can refuse more work when exhausted). */
  remainingMs?(): number;
}

export interface AgentToolContext {
  session: AgentSessionRuntime;
  env: AgentEnvironment;
  /** Run signal (Stop/source/conversation/flag/unmount/deadline). */
  signal?: AbortSignal;
}

/**
 * Model-facing argument contract for one tool parameter. This is the single
 * source of truth for the catalog text (and future native tool schemas); the
 * runtime validator remains the only enforcement. Every registered tool must
 * declare its parameters (empty array when it takes none).
 */
export interface AgentToolArgDescriptor {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "string[]" | "object";
  required: boolean;
  /** Model-facing one-liner; ≤ 90 chars. */
  description: string;
  /** Enum values (type "enum"). */
  enum?: readonly string[];
  /** String length cap (type "string"/"string[]" entries). */
  maxLength?: number;
  /** Array/object count cap. */
  maxItems?: number;
  /** Numeric bounds (type "number"). */
  min?: number;
  max?: number;
  /** True when the runtime validator clamps (soft limit) rather than rejects. */
  clamped?: boolean;
  /** Simple literal example; never user source content. */
  example?: string;
}

export interface AgentToolDefinition<I = Record<string, unknown>> {
  name: string;
  description: string;
  category: AgentToolCategory;
  /** Argument contract the model sees (also feeds tool schemas). */
  parameters: readonly AgentToolArgDescriptor[];
  /** Hand-written shape validation; unknown params are rejected here. */
  validate(input: unknown): ValidationOutcome<I>;
  execute(input: I, ctx: AgentToolContext): Promise<AgentToolResult>;
}

// ──────────────────────────────────────────────────────────────────────────
// Result constructors (typed non-error outcomes the model can see)
// ──────────────────────────────────────────────────────────────────────────

export function toolOk(
  result: unknown,
  displayDigest: string,
  sources?: AgentSourceRef[]
): AgentToolResult {
  return { ok: true, outcome: "ok", result, displayDigest, sources };
}

export function toolInvalid(problem: string): AgentToolResult {
  return {
    ok: false,
    outcome: "invalid-input",
    result: { error: "invalid-input", problem },
    displayDigest: problem,
  };
}

export function toolNotFound(what: string): AgentToolResult {
  return {
    ok: false,
    outcome: "not-found",
    result: { error: "not-found", problem: what },
    displayDigest: what,
  };
}

export function toolNotAvailable(what: string): AgentToolResult {
  return {
    ok: false,
    outcome: "not-available",
    result: { error: "not-available", problem: what },
    displayDigest: what,
  };
}

export function toolRejected(what: string): AgentToolResult {
  return {
    ok: false,
    outcome: "rejected",
    result: { error: "rejected", problem: what },
    displayDigest: what,
  };
}

export function toolError(what: string): AgentToolResult {
  return {
    ok: false,
    outcome: "error",
    result: { error: "error", problem: what },
    displayDigest: what,
  };
}
