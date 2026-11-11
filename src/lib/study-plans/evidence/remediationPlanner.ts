/**
 * Deterministic Remediation Planner.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §9
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T02)
 *
 * Emits typed RemediationRecommendation records based on detected knowledge gaps
 * without executing them directly or modifying schedulers.
 */

import type {
  KnowledgeGapView,
  RemediationRecommendation,
  RemediationKind,
} from '../../../types/learningEvidence';

export interface PlanRemediationOptions {
  sourceRefIds?: string[];
  objectives?: string[];
  now?: string | number | Date;
}

export function planRemediationForGap(
  gap: KnowledgeGapView,
  options: PlanRemediationOptions = {}
): RemediationRecommendation[] {
  const nowIso = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const sourceRefIds = options.sourceRefIds || [];
  const objectives = options.objectives || [];

  const recommendations: RemediationRecommendation[] = [];

  const basePayload = {
    conceptId: gap.conceptId,
    nodeId: gap.nodeId || undefined,
    planId: gap.planId || undefined,
    objectives,
    evidenceSummary: `Identified gap: ${gap.kind} (${gap.ruleId})`,
  };

  // 1. Open Grounding Source (if source references exist)
  if (sourceRefIds.length > 0) {
    recommendations.push({
      id: `rem-src-${gap.id}`,
      gapId: gap.id,
      kind: 'open-source',
      status: 'suggested',
      sourceRefIds,
      payload: {
        ...basePayload,
        evidenceSummary: `Review original source references for concept "${gap.conceptName}".`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  // 2. Targeted Practice (recommended for all assessment & lapse weaknesses)
  if (gap.kind === 'repeatedly_failed' || gap.kind === 'weak_transfer' || gap.kind === 'weak_prerequisite') {
    recommendations.push({
      id: `rem-practice-${gap.id}`,
      gapId: gap.id,
      kind: 'targeted-practice',
      status: 'suggested',
      sourceRefIds,
      payload: {
        ...basePayload,
        evidenceSummary: `Targeted practice exercises to reinforce concept "${gap.conceptName}".`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  // 3. Follow-up Assessment / Re-evaluation
  if (gap.kind === 'repeatedly_failed' || gap.kind === 'weak_prerequisite') {
    recommendations.push({
      id: `rem-exam-${gap.id}`,
      gapId: gap.id,
      kind: 'follow-up-exam',
      status: 'suggested',
      sourceRefIds,
      payload: {
        ...basePayload,
        evidenceSummary: `Diagnostic follow-up examination to confirm resolution for "${gap.conceptName}".`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  // 4. Plan Adjustment (for missing material or disconnected cluster gaps)
  if (gap.kind === 'missing_concept' || gap.kind === 'disconnected_cluster') {
    recommendations.push({
      id: `rem-plan-${gap.id}`,
      gapId: gap.id,
      kind: 'plan-adjustment',
      status: 'suggested',
      sourceRefIds,
      payload: {
        ...basePayload,
        evidenceSummary: `Curriculum plan adjustment needed: resolve unlinked or missing source material.`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  return recommendations;
}
