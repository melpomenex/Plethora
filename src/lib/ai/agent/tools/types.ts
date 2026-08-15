/**
 * Constrained-agent tool layer types (design D25, task 8.1).
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
 */

import type { ValidationOutcome } from "../../schemas/common";

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

/** Per-run mutable session state proposal tools accumulate into. */
export interface AgentSessionRuntime {
  /** Accumulated proposals, capped by bounds (≤ 20) regardless of output. */
  proposals: AgentProposal[];
  /** True once the proposal cap rejected an attempt (loop explains it). */
  proposalCapHit: boolean;
  addProposal(proposal: AgentProposal): boolean;
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

export interface AgentEnvironment {
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
  /** All cards (the tools filter + clamp client-side). */
  getCards(): Promise<
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
    }>
  >;
  getDueCards(): Promise<
    Array<{
      id: string;
      question: string;
      itemType: string;
      dueDate: string;
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
}

export interface AgentToolContext {
  session: AgentSessionRuntime;
  env: AgentEnvironment;
}

export interface AgentToolDefinition<I = Record<string, unknown>> {
  name: string;
  description: string;
  category: AgentToolCategory;
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
