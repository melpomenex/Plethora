/**
 * Diagnostic → plan adaptation (task 2.3).
 *
 * Applies finalized diagnostic evidence as a reviewable draft reorder. The
 * reorder runs through the existing deterministic DAG `orderStudyPlan` with
 * the diagnostic concept order as positional preference, so prerequisite
 * validity and user locks are preserved; invalid proposals fail closed and
 * leave the draft untouched. Acceptance uses the same save-draft CAS path —
 * it never publishes, never touches grades/scheduler, and preserves history.
 */

import type { PlanPrerequisite, StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { CurriculumPriorEvidence } from '../generation/types';
import { getStudyPlan, saveStudyPlanDraft } from '../../../api/study-plans';
import { orderStudyPlan } from '../topology';

export interface DiagnosticAdaptationResult {
  reorderedNodeIds: string[];
  planDetail: StudyPlanDetail;
}

export interface DiagnosticAdaptationClients {
  getPlan?: typeof getStudyPlan;
  saveDraft?: typeof saveStudyPlanDraft;
}

export function computePreferredPositions(
  priorEvidence: CurriculumPriorEvidence,
  nodes: readonly StudyPlanVersionNode[]
): Map<string, number> {
  const preferred = new Map<string, number>();
  const conceptRank = new Map(
    priorEvidence.concepts.map((c, i) => [c.conceptId, i])
  );
  for (const node of nodes) {
    if (!node.included) continue;
    const rank = node.conceptId ? conceptRank.get(node.conceptId) : undefined;
    if (rank === undefined) continue;
    // 0 is reserved for the first diagnostic concept; offset by 1 so unmatched
    // nodes (kept at their old positions) never collide with preference 0.
    preferred.set(node.nodeId, rank + 1);
  }
  return preferred;
}

export async function applyDiagnosticAdaptation(
  planId: string,
  expectedPlanRevision: number | undefined,
  priorEvidence: CurriculumPriorEvidence,
  clients: DiagnosticAdaptationClients = {}
): Promise<DiagnosticAdaptationResult> {
  const getPlan = clients.getPlan ?? getStudyPlan;
  const saveDraft = clients.saveDraft ?? saveStudyPlanDraft;
  const detail = await getPlan(planId);
  const expected = expectedPlanRevision ?? detail.plan.revision;

  const nodes = detail.version.nodes;
  const prerequisites: PlanPrerequisite[] = detail.version.prerequisites;
  const preferred = computePreferredPositions(priorEvidence, nodes);
  if (preferred.size === 0) {
    throw new Error('study.diagnostic.error.no_reorder_preferences');
  }
  const previous = new Map<string, number>();
  for (const node of nodes) {
    previous.set(node.nodeId, preferred.get(node.nodeId) ?? node.position + 1000);
  }

  const ordered = orderStudyPlan(nodes, prerequisites, previous);
  if (!ordered.ok) {
    throw new Error('study.diagnostic.error.reorder_breaks_dag');
  }
  const reorderedNodeIds = ordered.value.orderedNodeIds;
  const orderedNodes = ordered.value.orderedNodes;

  const saved = await saveDraft({
    planId,
    expectedDraftRevision: expected,
    nodes: orderedNodes,
    prerequisites,
    sourceScope: detail.version.sourceScope ?? undefined,
    knowledgeAuthority: detail.version.knowledgeAuthority,
  });

  return { reorderedNodeIds, planDetail: saved };
}
