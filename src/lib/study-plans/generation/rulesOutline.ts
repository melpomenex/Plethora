/**
 * Rules-Only Deterministic Curriculum Outline Generator (No-AI).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T02, C2-T08)
 */

import type { StudyDepth, StudySourceScopeV1 } from '../../../types/studySource';
import type {
  CurriculumDecomposeBatchOutput,
  CurriculumEdgeProposal,
  CurriculumPrerequisiteOutput,
  CurriculumTopicProposal,
} from './types';
import { EVIDENCE_LIMITS } from './planEvidence';

export interface ConfirmedConceptSeed {
  conceptId: string;
  conceptName: string;
  documentId?: string;
}

export interface ConfirmedConceptLink {
  prerequisiteConceptId: string;
  dependentConceptId: string;
}

export interface RulesOutlineOptions {
  sourceScope: StudySourceScopeV1;
  depth: StudyDepth;
  goal?: string;
  confirmedConcepts?: ConfirmedConceptSeed[];
  confirmedLinks?: ConfirmedConceptLink[];
}

export interface RulesOutlineResult {
  decomposeBatch: CurriculumDecomposeBatchOutput;
  prerequisiteBatch: CurriculumPrerequisiteOutput;
  sourceHandleMap: Map<string, string>;
}

/**
 * Pure, deterministic rules-only curriculum outline generator.
 * Uses confirmed concept graph links and document inventory without AI.
 */
export function generateRulesOnlyCurriculumOutline(
  options: RulesOutlineOptions
): RulesOutlineResult {
  const depthCap = EVIDENCE_LIMITS.DEPTH_CAPS[options.depth] || 16;
  const topicProposals: CurriculumTopicProposal[] = [];
  const conceptIdToHandle = new Map<string, string>();

  // 1. First prioritize confirmed concepts if available
  const concepts = (options.confirmedConcepts || []).slice(0, EVIDENCE_LIMITS.MAX_CONCEPT_SEEDS);
  for (const c of concepts) {
    if (topicProposals.length >= depthCap) break;

    const handle = `h_${topicProposals.length}`;
    conceptIdToHandle.set(c.conceptId, handle);

    const conceptName = c.conceptName || (c as any).name || 'Topic';

    topicProposals.push({
      handle,
      title: conceptName,
      summary: `Confirmed concept graph entry for ${conceptName}; no passage-level evidence was inspected.`,
      learningObjectives: [`Review the confirmed concept label ${conceptName} for this plan.`],
      conceptName,
      materialSupport: 'unsupported',
      sourceHandles: [],
      whyHere: 'Confirmed concept metadata; no passage citation available',
    });
  }

  // 2. Add document-based topics to fulfill depth or if concepts were sparse
  const docs = options.sourceScope.resolvedDocuments || [];
  for (const doc of docs) {
    if (topicProposals.length >= depthCap) break;

    // Avoid duplicate topics with same title
    const normDocTitle = doc.title.toLowerCase().trim();
    if (topicProposals.some((t) => t.title.toLowerCase().trim() === normDocTitle)) {
      continue;
    }

    const handle = `h_${topicProposals.length}`;
    topicProposals.push({
      handle,
      title: doc.title,
      summary: `Coarse inventory entry for ${doc.title}; document contents were not inspected.`,
      learningObjectives: [`Review the title of ${doc.title} for relevance to this plan.`],
      conceptName: undefined,
      materialSupport: 'unsupported',
      sourceHandles: [],
      whyHere: 'Inferred from the selected document inventory only',
    });
  }

  // 3. Build confirmed prerequisite edges
  const edgeProposals: CurriculumEdgeProposal[] = [];
  const links = options.confirmedLinks || [];

  for (const link of links) {
    const prereqHandle = conceptIdToHandle.get(link.prerequisiteConceptId);
    const depHandle = conceptIdToHandle.get(link.dependentConceptId);

    if (prereqHandle && depHandle && prereqHandle !== depHandle) {
      edgeProposals.push({
        prerequisiteHandle: prereqHandle,
        dependentHandle: depHandle,
        rationale: 'Confirmed conceptual prerequisite dependency in library graph.',
        sourceHandles: [],
        support: 'confirmed-concept-link',
      });
    }
  }


  // Create handle to source ref map (for downstream merge)
  const sourceHandleMap = new Map<string, string>();
  return {
    decomposeBatch: {
      schemaVersion: 1,
      topics: topicProposals,
    },
    prerequisiteBatch: {
      schemaVersion: 1,
      edges: edgeProposals,
    },
    sourceHandleMap,
  };
}
