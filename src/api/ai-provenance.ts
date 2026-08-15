/**
 * AI provenance API (design D22/D23, task 2.6).
 *
 * Recording is a SEPARATE invoke that runs after a domain create succeeded —
 * a provenance failure must never roll back (or block) a created card, and a
 * failed generation must never have anything to record.
 */

import { invokeCommand } from "../lib/tauri";

export interface AiProvenanceRecord {
  id: string;
  target_kind: string;
  target_id: string;
  task_id: string;
  provider: string;
  model?: string | null;
  model_class?: string | null;
  input_fingerprint?: string | null;
  created_at: string;
  metadata_json?: string | null;
}

export interface RecordAiProvenanceInput {
  /** What was created, e.g. "learning_item". */
  targetKind: string;
  /** Id of the created object. */
  targetId: string;
  /** Task that proposed it, e.g. "learn-this". */
  taskId: string;
  /** Provider id from the run result (`AITaskResult.providerId`). */
  provider: string;
  model?: string;
  modelClass?: string;
  /** fnv1a of the source passage (see `providers/types.ts` `fnv1aHash`). */
  inputFingerprint?: string;
  /** Selection context payload (passage, selectionContext, documentId, cardType). */
  metadata?: Record<string, unknown>;
}

export async function recordAiProvenance(
  input: RecordAiProvenanceInput
): Promise<AiProvenanceRecord> {
  return await invokeCommand<AiProvenanceRecord>("record_ai_provenance", {
    targetKind: input.targetKind,
    targetId: input.targetId,
    taskId: input.taskId,
    provider: input.provider,
    model: input.model,
    modelClass: input.modelClass,
    inputFingerprint: input.inputFingerprint,
    metadataJson: input.metadata,
  });
}

export async function getAiProvenance(
  targetKind: string,
  targetId: string
): Promise<AiProvenanceRecord[]> {
  return await invokeCommand<AiProvenanceRecord[]>("get_ai_provenance", {
    targetKind,
    targetId,
  });
}
