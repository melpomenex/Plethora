/**
 * Production dependencies for the passage-scoring controller (task 2.2/2.4).
 *
 * Reuses the existing classifier task, task-layer validation/diagnostics,
 * `passage_scores` commands and the explicit extract/preview workflows. This
 * module contains no reader-specific layout logic.
 */

import { getPassageScore, putPassageScore, putPassageScoreDismissal, getPassageScoreDismissals, schedulePassageScoreCleanup, type PassageScoreRecord } from "../../../api/passage-scores";
import { runPassageClassification } from "../../../lib/ai/tasks/definitions/passageClassificationTask";
import type { PassageClassificationRun, PassageScoringControllerDeps } from "./controller";
import { PassageDismissalStore, type StoredPassageScore } from "./cache";
import { resolvePassageScoringPolicy, PASSAGE_CLASSIFIER_VERSION } from "./policy";

function toStored(record: PassageScoreRecord): StoredPassageScore {
  return {
    chunkHash: record.chunkHash,
    passageType: record.passageType,
    extractWorthiness: record.extractWorthiness,
    suggestedAction: record.suggestedAction,
    model: record.model,
    reason: record.reason,
    classifierVersion: record.classifierVersion,
    modelRevision: record.modelRevision,
    normalizationVersion: record.normalizationVersion,
    createdAt: record.createdAt,
  };
}

export interface PassageScoringDepsOptions {
  documentId?: string;
  documentTitle?: string;
  sourceRevision: string;
  /** Durable dismissal persistence requires a real library document id. */
  durable?: boolean;
}

export function createPassageScoringDeps(
  options: PassageScoringDepsOptions
): PassageScoringControllerDeps {
  const durable = options.durable ?? Boolean(options.documentId);
  const dismissals = new PassageDismissalStore({
    durable,
    documentId: options.documentId,
    sourceRevision: options.sourceRevision,
    classifierVersion: PASSAGE_CLASSIFIER_VERSION,
    load: async (documentId) => {
      const rows = await getPassageScoreDismissals(documentId);
      return rows.map((row) => ({
        documentId: row.documentId,
        sourceRevision: row.sourceRevision,
        passageId: row.passageId,
        classifierVersion: row.classifierVersion,
        dismissedAt: row.dismissedAt,
      }));
    },
    persist: async (key) => {
      await putPassageScoreDismissal(key);
    },
  });

  return {
    resolvePolicy: (sourceScope) => resolvePassageScoringPolicy({ sourceScope }),
    lookup: async (digest) => {
      try {
        const record = await getPassageScore(digest);
        return record ? toStored(record) : null;
      } catch {
        // Cache unavailable is a miss, never a reader failure.
        return null;
      }
    },
    store: async (score: StoredPassageScore) => {
      await putPassageScore({
        chunkHash: score.chunkHash,
        passageType: score.passageType as PassageScoreRecord["passageType"],
        extractWorthiness: score.extractWorthiness,
        suggestedAction: score.suggestedAction ?? null,
        model: score.model ?? score.modelRevision ?? null,
        reason: score.reason ?? null,
        classifierVersion: score.classifierVersion ?? null,
        modelRevision: score.modelRevision ?? null,
        normalizationVersion: score.normalizationVersion ?? null,
      });
      schedulePassageScoreCleanup();
    },
    dismissals,
    classify: async (request): Promise<PassageClassificationRun> => {
      const { classification, run } = await runPassageClassification(
        {
          passage: request.text,
          documentTitle: request.documentTitle,
        },
        {
          provider: request.policy.provider,
          signal: request.signal,
          targetId: request.targetId,
          observation: request.observation,
        }
      );
      return {
        classification,
        providerId: run.providerId,
        baseModelName: run.baseModelName,
        servedModelClass: run.servedModelClass,
      };
    },
  };
}
