/**
 * Honest Plan Coverage Projection Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.2
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T08)
 */

import {
  runCoverageAnalysis,
  type ConceptCoverage,
  type CoverageAnalysisResult,
  type CoverageConceptInput,
  type CoverageDependencies,
  type EvidenceCoverage,
  type IndexCompleteness,
} from '../../ai/concepts/coverage';
import { normalizeConceptName } from '../../../api/concept-links';
import type {
  NodeActivity,
  StudyPlanDetail,
} from '../../../types/learningPaths';
import type { StudySourceScopeV1 } from '../../../types/studySource';

export const MAX_COVERAGE_BATCH_SIZE = 12;

export interface PlanCoverageProjectionOptions {
  planDetail: StudyPlanDetail;
  sourceScope: StudySourceScopeV1;
  signal?: AbortSignal;
  coverageRunner?: typeof runCoverageAnalysis;
  dependencies?: Partial<CoverageDependencies>;
  batchSize?: number;
}

export interface NodeCoverageProgress {
  nodeId: string;
  contentCoverage: EvidenceCoverage | 'not-computed';
  activity: NodeActivity;
  conceptName: string;
}

export interface PlanCoverageProjectionResult {
  planId: string;
  versionId: string;
  nodes: NodeCoverageProgress[];
  coverageByConceptId: Record<string, ConceptCoverage>;
  indexCompleteness: IndexCompleteness;
  limitations: string[];
  blocked: boolean;
  computedAt: string;
}

/**
 * Computes honest concept coverage projection for a study plan:
 * 1. Extracts distinct concepts across included plan nodes.
 * 2. Evaluates concepts in sequential batches of at most 12 (never parallel).
 * 3. Keeps coverage, user activity, and mastery evidence strictly separate.
 * 4. Refuses optimistic claims: unavailable, partial, or blocked indices remain honest.
 */
export async function computePlanCoverageProjection(
  options: PlanCoverageProjectionOptions
): Promise<PlanCoverageProjectionResult> {
  const {
    planDetail,
    sourceScope,
    signal,
    coverageRunner = runCoverageAnalysis,
    dependencies,
    batchSize = MAX_COVERAGE_BATCH_SIZE,
  } = options;

  const allowedDocIds = new Set(
    (sourceScope.resolvedDocuments || []).map((d) => d.documentId)
  );
  if (sourceScope.selected?.documentIds) {
    for (const id of sourceScope.selected.documentIds) {
      if (id) allowedDocIds.add(id);
    }
  }

  // 1. Extract distinct concepts from included nodes
  const conceptInputMap = new Map<string, CoverageConceptInput>();
  const nodeToConceptKeyMap = new Map<string, string>();

  for (const node of planDetail.version.nodes) {
    if (!node.included) continue;

    const conceptName = (node.conceptLabel || node.title || '').trim();
    if (!conceptName) continue;

    const normKey = normalizeConceptName(conceptName);
    if (!normKey) continue;

    nodeToConceptKeyMap.set(node.nodeId, normKey);

    if (!conceptInputMap.has(normKey)) {
      conceptInputMap.set(normKey, {
        name: conceptName,
        conceptId: node.conceptId || undefined,
      });
    }
  }

  const allConceptInputs = Array.from(conceptInputMap.values());

  // 2. If no concepts in plan, return honest empty result
  if (allConceptInputs.length === 0) {
    const defaultCompleteness = sourceScope.indexCompleteness || 'unavailable';
    return {
      planId: planDetail.plan.id,
      versionId: planDetail.version.id,
      nodes: planDetail.version.nodes.map((n) => ({
        nodeId: n.nodeId,
        contentCoverage: 'not-computed',
        activity: planDetail.activityByNodeId[n.nodeId] || 'not-started',
        conceptName: n.conceptLabel || n.title,
      })),
      coverageByConceptId: {},
      indexCompleteness: defaultCompleteness,
      limitations: [...sourceScope.limitations],
      blocked: false,
      computedAt: new Date().toISOString(),
    };
  }

  // 3. Sequential batch processing (at most 12 concepts per run)
  const allCoverageResults: ConceptCoverage[] = [];
  const accumulatedLimitations = new Set<string>(sourceScope.limitations || []);
  let worstCompleteness: IndexCompleteness = 'complete';
  let isBlocked = false;

  for (let i = 0; i < allConceptInputs.length; i += batchSize) {
    if (signal?.aborted) {
      throw new Error('Coverage projection aborted');
    }

    const batch = allConceptInputs.slice(i, i + batchSize);
    let batchResult: CoverageAnalysisResult;

    try {
      batchResult = await coverageRunner({
        concepts: batch,
        scope: {
          documentIds: Array.from(allowedDocIds),
        },
        signal,
        dependencies,
      });
    } catch {
      batchResult = {
        concepts: [],
        indexCompleteness: 'unavailable',
        limitations: ['coverage.limitation.retrieval-failed'],
        blocked: false,
      };
    }

    if (batchResult.blocked) {
      isBlocked = true;
    }

    for (const lim of batchResult.limitations) {
      accumulatedLimitations.add(lim);
    }

    // Reconcile index completeness: unavailable > partial > complete
    if (batchResult.indexCompleteness === 'unavailable') {
      worstCompleteness = 'unavailable';
    } else if (batchResult.indexCompleteness === 'partial' && worstCompleteness !== 'unavailable') {
      worstCompleteness = 'partial';
    }

    for (const c of batchResult.concepts) {
      allCoverageResults.push(c);
    }
  }

  // 4. Index results by concept key & concept id
  const coverageByNormKey = new Map<string, ConceptCoverage>();
  const coverageByConceptId: Record<string, ConceptCoverage> = {};

  for (const c of allCoverageResults) {
    const key = normalizeConceptName(c.conceptName);
    coverageByNormKey.set(key, c);
    if (c.conceptKey) {
      coverageByNormKey.set(c.conceptKey.toLowerCase(), c);
      coverageByConceptId[c.conceptKey] = c;
    }
  }

  // 5. Map coverage to nodes
  const nodesCoverage: NodeCoverageProgress[] = planDetail.version.nodes.map((node) => {
    const normKey = nodeToConceptKeyMap.get(node.nodeId);
    const coverage = normKey ? coverageByNormKey.get(normKey) : undefined;
    const contentCoverage: EvidenceCoverage | 'not-computed' = coverage
      ? coverage.evidenceCoverage
      : 'not-computed';

    const activity: NodeActivity = planDetail.activityByNodeId[node.nodeId] || 'not-started';

    return {
      nodeId: node.nodeId,
      contentCoverage,
      activity,
      conceptName: node.conceptLabel || node.title,
    };
  });

  return {
    planId: planDetail.plan.id,
    versionId: planDetail.version.id,
    nodes: nodesCoverage,
    coverageByConceptId,
    indexCompleteness: worstCompleteness,
    limitations: Array.from(accumulatedLimitations),
    blocked: isBlocked,
    computedAt: new Date().toISOString(),
  };
}
