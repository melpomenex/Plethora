/**
 * Rules-Only (No-AI) Curriculum Generation Coordinator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T08)
 */

import {
  listConfirmedConceptLinks,
  listConcepts,
  type Concept,
  type ConceptLink,
} from '../../../api/concept-links';
import {
  getStudyPlan,
  saveStudyPlanDraft,
  StudyApiError,
} from '../../../api/study-plans';
import type {
  SaveStudyPlanDraftInput,
  StudyPlanDetail,
} from '../../../types/learningPaths';
import type { StudySourceScopeV1 } from '../../../types/studySource';
import { refreshCurriculumScope } from './curriculumPreflight';
import { mergeCurriculumProposals, type MergeCurriculumResult } from './merge';
import {
  generateRulesOnlyCurriculumOutline,
  type ConfirmedConceptLink,
  type ConfirmedConceptSeed,
} from './rulesOutline';
import type { CurriculumGenerationRequest } from './types';

export interface NoAiCoordinatorDependencies {
  getPlanFn?: typeof getStudyPlan;
  saveDraftFn?: typeof saveStudyPlanDraft;
  refreshScopeFn?: typeof refreshCurriculumScope;
  listConfirmedConceptLinksFn?: typeof listConfirmedConceptLinks;
  listConceptsFn?: typeof listConcepts;
}

export interface NoAiCoordinatorResult {
  planDetail: StudyPlanDetail;
  mergeResult: MergeCurriculumResult;
  isRulesOnly: true;
}

/**
 * Extracts confirmed concept seeds and links that touch the allowed source scope.
 */
async function extractConfirmedConceptsInScope(
  allowedDocIds: Set<string>,
  allowedExtractIds: Set<string>,
  listLinksFn: () => Promise<ConceptLink[]>,
  listConceptsFn: () => Promise<Concept[]>
): Promise<{
  concepts: ConfirmedConceptSeed[];
  links: ConfirmedConceptLink[];
}> {
  let rawLinks: ConceptLink[] = [];
  try {
    rawLinks = await listLinksFn();
  } catch {
    rawLinks = [];
  }

  let rawConcepts: Concept[] = [];

  const inScopeConceptIds = new Set<string>();
  const inScopeDocByConceptId = new Map<string, string>();
  const extractOnlyConceptIds = new Set<string>();
  const confirmedLinks: ConfirmedConceptLink[] = [];

  for (const link of rawLinks) {
    if (link.isDismissed) continue;

    // Document to concept link
    if (link.sourceKind === 'document' && allowedDocIds.has(link.sourceId) && link.targetKind === 'concept') {
      inScopeConceptIds.add(link.targetId);
      inScopeDocByConceptId.set(link.targetId, link.sourceId);
      extractOnlyConceptIds.delete(link.targetId);
    } else if (link.sourceKind === 'extract' && allowedExtractIds.has(link.sourceId) && link.targetKind === 'concept') {
      inScopeConceptIds.add(link.targetId);
      if (!inScopeDocByConceptId.has(link.targetId)) extractOnlyConceptIds.add(link.targetId);
    } else if (link.targetKind === 'document' && allowedDocIds.has(link.targetId) && link.sourceKind === 'concept') {
      inScopeConceptIds.add(link.sourceId);
      inScopeDocByConceptId.set(link.sourceId, link.targetId);
      extractOnlyConceptIds.delete(link.sourceId);
    } else if (link.targetKind === 'extract' && allowedExtractIds.has(link.targetId) && link.sourceKind === 'concept') {
      inScopeConceptIds.add(link.sourceId);
      if (!inScopeDocByConceptId.has(link.sourceId)) extractOnlyConceptIds.add(link.sourceId);
    }

  }

  // Fetch concept labels only for document-backed scope. Extract-only concepts
  // use their confirmed IDs without pulling in broader graph metadata.
  const documentBackedConceptIds = new Set(
    [...inScopeConceptIds].filter((id) => !extractOnlyConceptIds.has(id))
  );
  if (documentBackedConceptIds.size > 0) {
    try {
      rawConcepts = await listConceptsFn();
    } catch {
      rawConcepts = [];
    }
  }
  const conceptNameById = new Map<string, string>();
  for (const c of rawConcepts) {
    if (documentBackedConceptIds.has(c.id)) conceptNameById.set(c.id, c.name);
  }

  for (const link of rawLinks) {
    if (link.isDismissed || link.sourceKind !== 'concept' || link.targetKind !== 'concept' ||
        link.relationType !== 'prerequisite-of') continue;
    if (inScopeConceptIds.has(link.sourceId) && inScopeConceptIds.has(link.targetId)) {
      confirmedLinks.push({ prerequisiteConceptId: link.sourceId, dependentConceptId: link.targetId });
    }
  }

  const conceptSeeds: ConfirmedConceptSeed[] = [];
  for (const cid of inScopeConceptIds) {
    const name = conceptNameById.get(cid) || cid;
    conceptSeeds.push({
      conceptId: cid,
      conceptName: name,
      documentId: inScopeDocByConceptId.get(cid),
    });
  }

  conceptSeeds.sort((a, b) => a.conceptName.localeCompare(b.conceptName, 'en-US'));

  return {
    concepts: conceptSeeds,
    links: confirmedLinks,
  };
}

/**
 * Runs deterministic rules-only curriculum generation without any AI model invocation.
 * Reuses confirmed concept graph relationships and source documents to form a
 * reproducible draft with confirmed concept metadata and coarse document inventory.
 */
export async function runNoAiCurriculumCoordinator(
  request: CurriculumGenerationRequest,
  deps: NoAiCoordinatorDependencies = {}
): Promise<NoAiCoordinatorResult> {
  const getPlan = deps.getPlanFn || getStudyPlan;
  const saveDraft = deps.saveDraftFn || saveStudyPlanDraft;
  const refreshScope = deps.refreshScopeFn || refreshCurriculumScope;
  const listLinks = deps.listConfirmedConceptLinksFn || listConfirmedConceptLinks;
  const listConceptsFn = deps.listConceptsFn || listConcepts;

  // 1. Fetch current draft plan
  let planDetail = await getPlan(request.planId);
  if (!planDetail.plan.draftVersionId || planDetail.plan.draftVersionId !== request.baseVersionId) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.no_active_draft',
      retryable: false,
    });
  }

  // 2. Refresh the local source inventory and revisions without passage probes.
  const refreshedScope = await refreshScope(planDetail.version.sourceScope as StudySourceScopeV1);

  // 3. Extract confirmed concepts and links in scope
  const allowedDocIds = new Set<string>();
  if (refreshedScope.selected?.documentIds) {
    for (const id of refreshedScope.selected.documentIds) {
      if (id) allowedDocIds.add(id);
    }
  }
  const allowedExtractIds = new Set(refreshedScope.selected.extractIds);

  const { concepts, links } = await extractConfirmedConceptsInScope(
    allowedDocIds,
    allowedExtractIds,
    listLinks,
    listConceptsFn
  );

  // 4. Generate deterministic rules-only outline
  const effectiveGoal = request.goal || planDetail.plan.goal;
  const outline = generateRulesOnlyCurriculumOutline({
    sourceScope: refreshedScope,
    depth: request.depth,
    goal: effectiveGoal,
    confirmedConcepts: concepts,
    confirmedLinks: links,
  });

  // 5. Merge without fabricating passage references. The refreshed scope above
  // supplies the current local source inventory and revisions.
  const mergeResult = mergeCurriculumProposals({
    baseVersion: planDetail.version,
    proposedTopics: outline.decomposeBatch.topics,
    proposedEdges: outline.prerequisiteBatch.edges,
    depth: request.depth,
  });

  // 6. Save draft checkpoint
  const saveInput: SaveStudyPlanDraftInput = {
    planId: request.planId,
    expectedDraftRevision: planDetail.plan.revision,
    sourceScope: refreshedScope,
    nodes: mergeResult.nodes,
    prerequisites: mergeResult.prerequisites,
  };

  planDetail = await saveDraft(saveInput);

  return {
    planDetail,
    mergeResult,
    isRulesOnly: true,
  };
}
