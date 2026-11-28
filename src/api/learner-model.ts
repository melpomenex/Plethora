/**
 * Tauri IPC wrappers for the 5-dimension Persistent Learner Model (Phase 1B)
 * with deterministic browser/test fallback backed by `competencyEstimator.ts`.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import { projectConceptProfile } from "../lib/learner-model/competencyEstimator";
import {
  COMPETENCY_POLICY_VERSION,
  type CompetencyDimension,
  type CompetencyEvidenceRecord,
  type ConceptCompetencyProfile,
  type DeclaredCompetencyLevel,
  type LearnerCompetencyDeclaration,
  type RecordCompetencyEvidenceInput,
} from "../types/learnerModel";

const fallbackEvidenceById = new Map<string, CompetencyEvidenceRecord>();
const fallbackEvidenceByUniqueKey = new Map<string, string>();
const fallbackDeclarationsByConceptId = new Map<string, LearnerCompetencyDeclaration>();
let fallbackCounter = 0;

function evidenceUniqueKey(
  conceptId: string,
  dimension: CompetencyDimension,
  sourceKind: string,
  sourceRecordId: string,
): string {
  return `${conceptId}::${dimension}::${sourceKind}::${sourceRecordId}`;
}

function generateId(prefix: string): string {
  fallbackCounter += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${fallbackCounter}`;
}

export async function recordCompetencyEvidence(
  input: RecordCompetencyEvidenceInput,
): Promise<CompetencyEvidenceRecord> {
  if (
    (input.sourceKind === "reading_progress" || input.sourceKind === "extract_created") &&
    input.dimension !== "exposure"
  ) {
    throw new Error(
      `Source kind "${input.sourceKind}" can only record "exposure" evidence, not "${input.dimension}"`,
    );
  }

  if (isTauri()) {
    return invokeCommand<CompetencyEvidenceRecord>("record_competency_evidence", {
      input,
    });
  }

  const uniqueKey = evidenceUniqueKey(
    input.conceptId,
    input.dimension,
    input.sourceKind,
    input.sourceRecordId,
  );
  const existingId = fallbackEvidenceByUniqueKey.get(uniqueKey);
  if (existingId) {
    const existing = fallbackEvidenceById.get(existingId);
    if (existing) {
      return existing;
    }
  }

  const nowIso = new Date().toISOString();
  const record: CompetencyEvidenceRecord = {
    id: input.id ?? generateId("ce"),
    conceptId: input.conceptId,
    dimension: input.dimension,
    sourceKind: input.sourceKind,
    sourceEventId: input.sourceEventId ?? null,
    sourceRecordId: input.sourceRecordId,
    evidenceGroupId: input.evidenceGroupId,
    cardFamilyId: input.cardFamilyId ?? null,
    sessionId: input.sessionId ?? null,
    observedScore: input.observedScore,
    baseWeight: input.baseWeight,
    elapsedDays: input.elapsedDays ?? null,
    hintLevel: input.hintLevel ?? 0,
    isVerified: input.isVerified ?? true,
    isInvalidated: false,
    invalidatedByEventId: null,
    documentId: input.documentId ?? null,
    isLocalOnly: Boolean(input.isLocalOnly),
    isAiExcluded: Boolean(input.isAiExcluded),
    occurredAt: input.occurredAt ?? nowIso,
    policyVersion: input.policyVersion ?? COMPETENCY_POLICY_VERSION,
    createdAt: nowIso,
  };

  fallbackEvidenceById.set(record.id, record);
  fallbackEvidenceByUniqueKey.set(uniqueKey, record.id);
  return record;
}

export async function invalidateCompetencyEvidence(params: {
  evidenceIds?: string[];
  sourceEventId?: string;
  invalidatedByEventId?: string | null;
}): Promise<{ invalidatedCount: number; affectedConceptIds: string[] }> {
  if (isTauri()) {
    return invokeCommand<{ invalidatedCount: number; affectedConceptIds: string[] }>(
      "invalidate_competency_evidence",
      {
        evidenceIds: params.evidenceIds ?? null,
        sourceEventId: params.sourceEventId ?? null,
        invalidatedByEventId: params.invalidatedByEventId ?? null,
      },
    );
  }

  const idSet = new Set(params.evidenceIds ?? []);
  const affected = new Set<string>();
  let invalidatedCount = 0;

  for (const [id, record] of fallbackEvidenceById.entries()) {
    const matchesId = idSet.has(id);
    const matchesSourceEvent =
      params.sourceEventId !== undefined &&
      record.sourceEventId === params.sourceEventId;

    if ((matchesId || matchesSourceEvent) && !record.isInvalidated) {
      fallbackEvidenceById.set(id, {
        ...record,
        isInvalidated: true,
        invalidatedByEventId: params.invalidatedByEventId ?? null,
      });
      affected.add(record.conceptId);
      invalidatedCount += 1;
    }
  }

  return {
    invalidatedCount,
    affectedConceptIds: Array.from(affected),
  };
}

export async function getConceptCompetencyProfile(
  conceptId: string,
  options?: {
    conceptName?: string;
    aiContext?: boolean;
    nowIso?: string;
  },
): Promise<ConceptCompetencyProfile> {
  if (isTauri()) {
    return invokeCommand<ConceptCompetencyProfile>("get_concept_competency_profile", {
      conceptId,
      aiContext: Boolean(options?.aiContext),
    });
  }

  const allRecords = Array.from(fallbackEvidenceById.values());
  const declaration = fallbackDeclarationsByConceptId.get(conceptId) ?? null;
  return projectConceptProfile(
    conceptId,
    allRecords,
    declaration,
    options?.nowIso ?? new Date().toISOString(),
    {
      conceptName: options?.conceptName ?? conceptId,
      excludeAiExcluded: Boolean(options?.aiContext),
    },
  );
}

export async function listConceptCompetencyProfiles(options?: {
  conceptIds?: string[];
  aiContext?: boolean;
  nowIso?: string;
}): Promise<ConceptCompetencyProfile[]> {
  if (isTauri()) {
    return invokeCommand<ConceptCompetencyProfile[]>(
      "list_concept_competency_profiles",
      {
        conceptIds: options?.conceptIds ?? null,
        aiContext: Boolean(options?.aiContext),
      },
    );
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const allRecords = Array.from(fallbackEvidenceById.values());
  const conceptIdSet = new Set<string>(options?.conceptIds ?? []);

  if (!options?.conceptIds) {
    for (const r of allRecords) {
      conceptIdSet.add(r.conceptId);
    }
    for (const conceptId of fallbackDeclarationsByConceptId.keys()) {
      conceptIdSet.add(conceptId);
    }
  }

  return Array.from(conceptIdSet).map((conceptId) =>
    projectConceptProfile(
      conceptId,
      allRecords,
      fallbackDeclarationsByConceptId.get(conceptId) ?? null,
      nowIso,
      {
        excludeAiExcluded: Boolean(options?.aiContext),
      },
    ),
  );
}

export async function setLearnerCompetencyDeclaration(
  conceptId: string,
  declaredLevel: DeclaredCompetencyLevel,
  note?: string | null,
): Promise<LearnerCompetencyDeclaration> {
  if (isTauri()) {
    return invokeCommand<LearnerCompetencyDeclaration>(
      "set_learner_competency_declaration",
      {
        conceptId,
        declaredLevel,
        note: note ?? null,
      },
    );
  }

  const nowIso = new Date().toISOString();
  const existing = fallbackDeclarationsByConceptId.get(conceptId);
  const declaration: LearnerCompetencyDeclaration = {
    id: existing?.id ?? generateId("lcd"),
    conceptId,
    declaredLevel,
    note: note ?? null,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  fallbackDeclarationsByConceptId.set(conceptId, declaration);
  return declaration;
}

export async function getConceptEvidenceHistory(
  conceptId: string,
  options?: {
    dimension?: CompetencyDimension;
    includeInvalidated?: boolean;
    aiContext?: boolean;
  },
): Promise<CompetencyEvidenceRecord[]> {
  if (isTauri()) {
    return invokeCommand<CompetencyEvidenceRecord[]>("get_concept_evidence_history", {
      conceptId,
      dimension: options?.dimension ?? null,
      includeInvalidated: Boolean(options?.includeInvalidated),
      aiContext: Boolean(options?.aiContext),
    });
  }

  return Array.from(fallbackEvidenceById.values())
    .filter((record) => {
      if (record.conceptId !== conceptId) return false;
      if (options?.dimension && record.dimension !== options.dimension) return false;
      if (!options?.includeInvalidated && record.isInvalidated) return false;
      if (options?.aiContext && record.isAiExcluded) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

/** Test-only helper to reset the browser/test fallback store. */
export function _resetLearnerModelApiFallbackForTests(): void {
  fallbackEvidenceById.clear();
  fallbackEvidenceByUniqueKey.clear();
  fallbackDeclarationsByConceptId.clear();
  fallbackCounter = 0;
}
