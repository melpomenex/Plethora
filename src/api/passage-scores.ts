/**
 * Typed adapter over the registered passage-score commands (task 1.2).
 *
 * The cache is derived data: rows contain no source text, no geometry and no
 * document identifiers. Callers must treat every read as optional
 * (a miss/unavailable cache is normal). Cache cleanup is scheduled off the
 * interaction path and never deletes documents, extracts, highlights or cards.
 */

import { invokeCommand } from "../lib/tauri";
import {
  PASSAGE_TYPES,
  SUGGESTED_LEARNING_ACTIONS,
  type PassageType,
  type SuggestedLearningAction,
} from "../lib/ai/schemas/passageClassification";
import { PASSAGE_PERSISTENT_CACHE_LIMIT } from "../components/viewer/passageScoring/types";

export interface PassageScoreRecord {
  chunkHash: string;
  passageType: PassageType;
  extractWorthiness: number;
  suggestedAction?: SuggestedLearningAction | null;
  model?: string | null;
  reason?: string | null;
  classifierVersion?: string | null;
  modelRevision?: string | null;
  normalizationVersion?: string | null;
  createdAt: string;
}

export interface PutPassageScoreInput {
  chunkHash: string;
  passageType: PassageType;
  extractWorthiness: number;
  suggestedAction?: SuggestedLearningAction | null;
  /** Legacy display field; keep it equal to `modelRevision` for new rows. */
  model?: string | null;
  reason?: string | null;
  classifierVersion?: string | null;
  modelRevision?: string | null;
  normalizationVersion?: string | null;
}

export interface PassageScoreDismissalRecord {
  documentId: string;
  sourceRevision: string;
  passageId: string;
  classifierVersion: string;
  dismissedAt: string;
}

export interface PassageScoreDismissalInput {
  documentId: string;
  sourceRevision: string;
  passageId: string;
  classifierVersion: string;
}

export class PassageScoreApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassageScoreApiError";
  }
}

function isFiniteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPassageType(value: unknown): value is PassageType {
  return typeof value === "string" && (PASSAGE_TYPES as readonly string[]).includes(value);
}

function isSuggestedAction(value: unknown): value is SuggestedLearningAction {
  return (
    typeof value === "string" &&
    (SUGGESTED_LEARNING_ACTIONS as readonly string[]).includes(value)
  );
}

/** Validate the Rust wire shape; malformed rows become cache misses, not UI. */
export function sanitizePassageScoreRecord(raw: unknown): PassageScoreRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.chunkHash !== "string" || record.chunkHash.length === 0) return null;
  if (!isPassageType(record.passageType)) return null;
  if (!isFiniteScore(record.extractWorthiness)) return null;
  const action = record.suggestedAction;
  if (action !== undefined && action !== null && !isSuggestedAction(action)) return null;
  return {
    chunkHash: record.chunkHash,
    passageType: record.passageType,
    extractWorthiness: record.extractWorthiness,
    suggestedAction: (action ?? null) as SuggestedLearningAction | null,
    model: typeof record.model === "string" ? record.model : null,
    reason: typeof record.reason === "string" ? record.reason : null,
    classifierVersion:
      typeof record.classifierVersion === "string" ? record.classifierVersion : null,
    modelRevision: typeof record.modelRevision === "string" ? record.modelRevision : null,
    normalizationVersion:
      typeof record.normalizationVersion === "string" ? record.normalizationVersion : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
  };
}

export function validatePutPassageScoreInput(input: PutPassageScoreInput): void {
  if (!input.chunkHash || input.chunkHash.length > 256) {
    throw new PassageScoreApiError("passage score hash must be a non-empty bounded digest");
  }
  if (!isPassageType(input.passageType)) {
    throw new PassageScoreApiError("invalid passage type");
  }
  if (!isFiniteScore(input.extractWorthiness)) {
    throw new PassageScoreApiError("extract worthiness must be finite and within [0, 1]");
  }
  if (
    input.suggestedAction !== undefined &&
    input.suggestedAction !== null &&
    !isSuggestedAction(input.suggestedAction)
  ) {
    throw new PassageScoreApiError("invalid suggested learning action");
  }
  if (input.reason != null && input.reason.length > 1_000) {
    throw new PassageScoreApiError("reason exceeds the 1000-character bound");
  }
  for (const [label, value] of [
    ["classifierVersion", input.classifierVersion],
    ["modelRevision", input.modelRevision],
    ["normalizationVersion", input.normalizationVersion],
  ] as const) {
    if (value != null && value.length > 256) {
      throw new PassageScoreApiError(`${label} exceeds the 256-character bound`);
    }
  }
}

/** Cached classification by full versioned digest, or null on a miss. */
export async function getPassageScore(chunkHash: string): Promise<PassageScoreRecord | null> {
  if (!chunkHash) return null;
  const raw = await invokeCommand<unknown>("get_passage_score", {
    chunkHash,
    chunk_hash: chunkHash,
  });
  return sanitizePassageScoreRecord(raw);
}

/** Cache a classification. No source text is ever sent. */
export async function putPassageScore(
  input: PutPassageScoreInput
): Promise<PassageScoreRecord> {
  validatePutPassageScoreInput(input);
  const args = {
    chunkHash: input.chunkHash,
    chunk_hash: input.chunkHash,
    passageType: input.passageType,
    passage_type: input.passageType,
    extractWorthiness: input.extractWorthiness,
    extract_worthiness: input.extractWorthiness,
    suggestedAction: input.suggestedAction ?? null,
    suggested_action: input.suggestedAction ?? null,
    model: input.model ?? input.modelRevision ?? null,
    reason: input.reason ?? null,
    classifierVersion: input.classifierVersion ?? null,
    classifier_version: input.classifierVersion ?? null,
    modelRevision: input.modelRevision ?? null,
    model_revision: input.modelRevision ?? null,
    normalizationVersion: input.normalizationVersion ?? null,
    normalization_version: input.normalizationVersion ?? null,
  };
  const raw = await invokeCommand<unknown>("put_passage_score", args);
  const record = sanitizePassageScoreRecord(raw);
  if (!record) {
    throw new PassageScoreApiError("backend returned an invalid passage score row");
  }
  return record;
}

/**
 * Trim the persistent cache to its documented LRU budget (derived scores
 * only). Returns the number of evicted rows.
 */
export async function cleanupPassageScores(
  keepRows: number = PASSAGE_PERSISTENT_CACHE_LIMIT
): Promise<number> {
  const keep = Number.isFinite(keepRows)
    ? Math.max(0, Math.min(100_000, Math.floor(keepRows)))
    : PASSAGE_PERSISTENT_CACHE_LIMIT;
  const removed = await invokeCommand<number>("cleanup_passage_scores", {
    keepRows: keep,
    keep_rows: keep,
  });
  return typeof removed === "number" && Number.isFinite(removed) ? removed : 0;
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupRuns = 0;

/**
 * Schedule one idle-time cleanup. Called after cache writes; never awaited by
 * a reader interaction. The 10,000-row budget is a documented initial cap.
 */
export function schedulePassageScoreCleanup(): void {
  cleanupRuns += 1;
  // Amortize: the first write schedules, then every 50 writes.
  if (cleanupRuns !== 1 && cleanupRuns % 50 !== 0) return;
  if (cleanupTimer !== null) return;
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    const run = () => {
      void cleanupPassageScores().catch(() => {
        // Cleanup is best-effort; a miss only costs disk space, never content.
      });
    };
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof idle === "function") idle(run, { timeout: 5_000 });
    else run();
  }, 4_000);
}

/** Test hook: reset the cleanup amortization counter/timer. */
export function resetPassageScoreCleanupForTests(): void {
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  cleanupTimer = null;
  cleanupRuns = 0;
}

/* ------------------------------------------------------------------------- */
/* Dismissals                                                                */
/* ------------------------------------------------------------------------- */

function validateDismissalInput(input: PassageScoreDismissalInput): void {
  for (const [label, value] of [
    ["documentId", input.documentId],
    ["sourceRevision", input.sourceRevision],
    ["passageId", input.passageId],
    ["classifierVersion", input.classifierVersion],
  ] as const) {
    if (!value || value.length > 512) {
      throw new PassageScoreApiError(`invalid dismissal ${label}`);
    }
  }
}

export async function getPassageScoreDismissals(
  documentId: string
): Promise<PassageScoreDismissalRecord[]> {
  if (!documentId) return [];
  const raw = await invokeCommand<unknown>("get_passage_score_dismissals", {
    documentId,
    document_id: documentId,
  });
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      documentId: typeof row.documentId === "string" ? row.documentId : documentId,
      sourceRevision: typeof row.sourceRevision === "string" ? row.sourceRevision : "",
      passageId: typeof row.passageId === "string" ? row.passageId : "",
      classifierVersion:
        typeof row.classifierVersion === "string" ? row.classifierVersion : "",
      dismissedAt: typeof row.dismissedAt === "string" ? row.dismissedAt : "",
    }))
    .filter(
      (row) =>
        row.sourceRevision.length > 0 &&
        row.passageId.length > 0 &&
        row.classifierVersion.length > 0
    );
}

export async function putPassageScoreDismissal(
  input: PassageScoreDismissalInput
): Promise<void> {
  validateDismissalInput(input);
  await invokeCommand("put_passage_score_dismissal", {
    documentId: input.documentId,
    document_id: input.documentId,
    sourceRevision: input.sourceRevision,
    source_revision: input.sourceRevision,
    passageId: input.passageId,
    passage_id: input.passageId,
    classifierVersion: input.classifierVersion,
    classifier_version: input.classifierVersion,
  });
}
