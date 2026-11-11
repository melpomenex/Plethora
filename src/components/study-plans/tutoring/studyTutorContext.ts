import type { StudyTutorContext } from '../../../types/learningEvidence';
import type { StudySourceRefV1 } from '../../../types/studySource';

export interface StudyTutorContextInput {
  planId: string;
  planVersionId: string;
  nodeId: string;
  conceptId?: string | null;
  gapId?: string | null;
  sourceRefs: StudySourceRefV1[];
  objectives?: string[];
  misconception?: string | null;
  evidenceSummary?: string;
  authorizedDocumentIds?: Set<string> | string[];
}

/**
 * Builds a validated Study tutor context (C7-T04).
 * Refuses empty/missing/unauthorized ids instead of global fallback.
 */
export function buildStudyTutorContext(input: StudyTutorContextInput): StudyTutorContext {
  const refs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  const sourceRefIds = refs.map((r) => r.id).filter((id) => typeof id === 'string' && id.length > 0);
  const docIds = [...new Set(refs.map((r) => r.documentId).filter((id) => typeof id === 'string' && id.length > 0))];
  if (docIds.length === 0 || sourceRefIds.length === 0) {
    throw new Error('study.tutor.error.missing_source_context');
  }
  if (input.authorizedDocumentIds) {
    const allowed = Array.isArray(input.authorizedDocumentIds)
      ? new Set(input.authorizedDocumentIds)
      : input.authorizedDocumentIds;
    for (const id of docIds) {
      if (!allowed.has(id)) throw new Error('study.tutor.error.unauthorized_source');
    }
  }
  if (!input.planId || !input.planVersionId || !input.nodeId) {
    throw new Error('study.tutor.error.missing_plan_context');
  }
  return {
    planId: input.planId,
    planVersionId: input.planVersionId,
    nodeId: input.nodeId,
    conceptId: input.conceptId ?? null,
    gapId: input.gapId ?? null,
    sourceDocumentIds: docIds,
    sourceRefIds,
    objectives: input.objectives ?? [],
    misconception: input.misconception ?? null,
    evidenceSummary: input.evidenceSummary ?? '',
  };
}

/** Bounded validated excerpt material for the tutor (no raw history dump). */
export function buildStudyTutorMaterial(
  context: StudyTutorContext,
  excerptsByRefId: Record<string, string>,
  maxChars = 4000,
): string {
  const parts: string[] = [];
  if (context.objectives.length > 0) {
    parts.push(`Objectives: ${context.objectives.join('; ')}`);
  }
  if (context.misconception) parts.push(`Misconception to address: ${context.misconception}`);
  if (context.evidenceSummary) parts.push(`Evidence: ${context.evidenceSummary}`);
  for (const refId of context.sourceRefIds) {
    const excerpt = excerptsByRefId[refId];
    if (typeof excerpt === 'string' && excerpt.trim().length > 0) {
      parts.push(`Source excerpt: ${excerpt.trim().slice(0, 800)}`);
    }
  }
  const joined = parts.join('\n\n');
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}
