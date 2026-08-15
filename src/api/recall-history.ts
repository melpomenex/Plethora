/**
 * Recall prompt history API (task 5.2 TS wrapper, design D19).
 *
 * Thin typed wrappers over `record_recall_prompt`,
 * `set_recall_prompt_outcome`, and `get_recent_recall_prompts`. The viewer's
 * recall controller records every shown prompt (for the 30-day
 * near-duplicate window) and updates the outcome when the user answers,
 * dismisses, or promotes a question.
 *
 * Rows serialize camelCase (matching the Rust `RecallPromptRecord`).
 */

import { invokeCommand } from "../lib/tauri";

export type RecallPromptOutcome = "asked" | "answered" | "dismissed" | "promoted";

export interface RecallPromptRecord {
  id: string;
  documentId: string | null;
  chunkIds: string[];
  fingerprint: string;
  question: string;
  askedAt: string;
  outcome: RecallPromptOutcome | string;
}

/** Default deduplication window (design D19: 30 days). */
export const RECALL_DEDUP_WINDOW_DAYS = 30;

/** Record a recall prompt that was shown to the reader. */
export function recordRecallPrompt(input: {
  documentId?: string | null;
  chunkIds: string[];
  fingerprint: string;
  question: string;
  outcome?: RecallPromptOutcome;
}): Promise<RecallPromptRecord> {
  return invokeCommand<RecallPromptRecord>("record_recall_prompt", {
    documentId: input.documentId ?? null,
    document_id: input.documentId ?? null,
    chunkIds: input.chunkIds,
    chunk_ids: input.chunkIds,
    fingerprint: input.fingerprint,
    question: input.question,
    outcome: input.outcome ?? null,
  });
}

/** Update the outcome of a recorded prompt (asked → answered/dismissed/promoted). */
export function setRecallPromptOutcome(
  promptId: string,
  outcome: RecallPromptOutcome
): Promise<boolean> {
  return invokeCommand<boolean>("set_recall_prompt_outcome", {
    promptId,
    prompt_id: promptId,
    outcome,
  });
}

/**
 * Recent recall prompts, newest first. Scope to a document for the usual
 * in-document dedup check; omit it to suppress cross-document duplicates
 * too.
 */
export function getRecentRecallPrompts(
  documentId?: string | null,
  sinceDays: number = RECALL_DEDUP_WINDOW_DAYS
): Promise<RecallPromptRecord[]> {
  return invokeCommand<RecallPromptRecord[]>("get_recent_recall_prompts", {
    documentId: documentId ?? null,
    document_id: documentId ?? null,
    sinceDays,
    since_days: sinceDays,
  });
}
