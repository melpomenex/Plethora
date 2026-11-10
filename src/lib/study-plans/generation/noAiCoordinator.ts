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
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type {
  SaveStudyPlanDraftInput,
  StudyPlanDetail,
} from '../../../types/learningPaths';
import type {
  StudySourceRefInput,
  StudySourceResolution,
} from '../../../types/studySource';
import { verifySourceRevisions } from './coordinator';
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
  resolveSourceRefsFn?: typeof resolveStudySourceRefs;
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
  try {
    rawConcepts = await listConceptsFn();
  } catch {
    rawConcepts = [];
  }

  const conceptNameById = new Map<string, string>();
  for (const c of rawConcepts) {
    conceptNameById.set(c.id, c.name);
  }

  const inScopeConceptIds = new Set<string>();
  const inScopeDocByConceptId = new Map<string, string>();
  const confirmedLinks: ConfirmedConceptLink[] = [];

  for (const link of rawLinks) {
    if (link.isDismissed) continue;

    // Document to concept link
    if (link.sourceKind === 'document' && allowedDocIds.has(link.sourceId) && link.targetKind === 'concept') {
      inScopeConceptIds.add(link.targetId);
      inScopeDocByConceptId.set(link.targetId, link.sourceId);
    } else if (link.targetKind === 'document' && allowedDocIds.has(link.targetId) && link.sourceKind === 'concept') {
      inScopeConceptIds.add(link.sourceId);
      inScopeDocByConceptId.set(link.sourceId, link.targetId);
    }

    // Concept to concept prerequisite link
    if (link.sourceKind === 'concept' && link.targetKind === 'concept') {
      if (link.relationType === 'prerequisite-of') {
        confirmedLinks.push({
          prerequisiteConceptId: link.sourceId,
          dependentConceptId: link.targetId,
        });
      }
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
 * reproducible, source-cited study plan draft.
 */
export async function runNoAiCurriculumCoordinator(
  request: CurriculumGenerationRequest,
  deps: NoAiCoordinatorDependencies = {}
): Promise<NoAiCoordinatorResult> {
  const getPlan = deps.getPlanFn || getStudyPlan;
  const saveDraft = deps.saveDraftFn || saveStudyPlanDraft;
  const resolveSourceRefs = deps.resolveSourceRefsFn || resolveStudySourceRefs;
  const listLinks = deps.listConfirmedConceptLinksFn || listConfirmedConceptLinks;
  const listConceptsFn = deps.listConceptsFn || listConcepts;

  // 1. Fetch current draft plan
  let planDetail = await getPlan(request.planId);
  if (!planDetail.plan.draftVersionId) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.no_active_draft',
      retryable: false,
    });
  }

  // 2. Verify source revisions
  await verifySourceRevisions(request.sourceScope, resolveSourceRefs);

  // 3. Extract confirmed concepts and links in scope
  const allowedDocIds = new Set(
    (request.sourceScope.resolvedDocuments || []).map((d) => d.documentId)
  );
  if (request.sourceScope.selected?.documentIds) {
    for (const id of request.sourceScope.selected.documentIds) {
      if (id) allowedDocIds.add(id);
    }
  }

  const { concepts, links } = await extractConfirmedConceptsInScope(
    allowedDocIds,
    listLinks,
    listConceptsFn
  );

  // 4. Generate deterministic rules-only outline
  const effectiveGoal = request.goal || planDetail.plan.goal;
  const outline = generateRulesOnlyCurriculumOutline({
    sourceScope: request.sourceScope,
    depth: request.depth,
    goal: effectiveGoal,
    confirmedConcepts: concepts,
    confirmedLinks: links,
  });

  // 5. Hydrate source refs for the generated handles
  const docs = request.sourceScope.resolvedDocuments || [];
  const refInputs: StudySourceRefInput[] = docs.map((doc) => ({
    documentId: doc.documentId,
    documentTitle: doc.title,
    sourceType: doc.sourceType,
    revision: doc.revision,
    excerpt: `Source document: ${doc.title}`,
  }));

  let resolutions: StudySourceResolution[] = [];
  try {
    resolutions = await resolveSourceRefs(refInputs);
  } catch {
    resolutions = [];
  }

  const handleToSourceRefIdMap = new Map<string, string>();
  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutions[i];
    if (res?.ref?.id) {
      handleToSourceRefIdMap.set(`src_h${i}`, res.ref.id);
    }
  }

  // 6. Merge with base version to preserve existing user locks, additions, edits
  const mergeResult = mergeCurriculumProposals({
    baseVersion: planDetail.version,
    proposedTopics: outline.decomposeBatch.topics,
    proposedEdges: outline.prerequisiteBatch.edges,
    depth: request.depth,
    handleToSourceRefIdMap,
  });

  // 7. Save draft checkpoint
  const saveInput: SaveStudyPlanDraftInput = {
    planId: request.planId,
    expectedDraftRevision: planDetail.plan.revision,
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
