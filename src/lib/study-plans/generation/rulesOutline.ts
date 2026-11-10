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
import { EVIDENCE_LIMITS, planEvidenceBatches } from './planEvidence';

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
  const { allHandles, handleMap } = planEvidenceBatches({
    sourceScope: options.sourceScope,
    depth: options.depth,
  });

  // Map documentId to its first source handle
  const docToHandleMap = new Map<string, string>();
  for (const h of allHandles) {
    if (!docToHandleMap.has(h.documentId)) {
      docToHandleMap.set(h.documentId, h.handle);
    }
  }

  const defaultFirstHandle = allHandles[0]?.handle || 'src_h0';
  const topicProposals: CurriculumTopicProposal[] = [];
  const conceptIdToHandle = new Map<string, string>();

  // 1. First prioritize confirmed concepts if available
  const concepts = (options.confirmedConcepts || []).slice(0, EVIDENCE_LIMITS.MAX_CONCEPT_SEEDS);
  for (const c of concepts) {
    if (topicProposals.length >= depthCap) break;

    const handle = `h_${topicProposals.length}`;
    conceptIdToHandle.set(c.conceptId, handle);

    const docHandle = c.documentId ? docToHandleMap.get(c.documentId) : undefined;
    const assignedSources = docHandle ? [docHandle] : [defaultFirstHandle];

    const conceptName = c.conceptName || (c as any).name || 'Topic';

    topicProposals.push({
      handle,
      title: conceptName,
      summary: `Structured review of ${conceptName} grounded in library material.`,
      learningObjectives: [
        `Understand foundational definitions of ${conceptName}`,
        `Apply core principles of ${conceptName} in context`,
      ],
      conceptName,
      materialSupport: 'grounded',
      sourceHandles: assignedSources,
      whyHere: 'Confirmed library concept',
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
    const docHandle = docToHandleMap.get(doc.documentId) || defaultFirstHandle;

    topicProposals.push({
      handle,
      title: doc.title,
      summary: `Comprehensive study of topics in ${doc.title}.`,
      learningObjectives: [
        `Analyze the core arguments and material in ${doc.title}`,
        `Synthesize key takeaways and conclusions`,
      ],
      conceptName: doc.title,
      materialSupport: 'grounded',
      sourceHandles: [docHandle],
      whyHere: 'Library source material',
    });
  }

  // Ensure at least 3 topics (MIN_TOPICS_PER_BATCH)
  let fallbackIdx = 1;
  while (topicProposals.length < 3) {
    const handle = `h_${topicProposals.length}`;
    topicProposals.push({
      handle,
      title: `Core Study Unit ${fallbackIdx}`,
      summary: 'Grounded unit covering foundational source material.',
      learningObjectives: [
        `Master foundational concepts in unit ${fallbackIdx}`,
        `Apply methods to practical problems`,
      ],
      conceptName: `Unit ${fallbackIdx}`,
      materialSupport: 'grounded',
      sourceHandles: [defaultFirstHandle],
      whyHere: 'Foundational topic sequence',
    });
    fallbackIdx++;
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

  // If no confirmed links, synthesize sequential forward dependencies across units
  if (edgeProposals.length === 0 && topicProposals.length > 1) {
    for (let i = 0; i < topicProposals.length - 1; i++) {
      edgeProposals.push({
        prerequisiteHandle: topicProposals[i].handle,
        dependentHandle: topicProposals[i + 1].handle,
        rationale: 'Sequential curriculum progression through library material.',
        sourceHandles: [],
        support: 'inferred',
      });
    }
  }

  // Create handle to source ref map (for downstream merge)
  const sourceHandleMap = new Map<string, string>();
  for (const [h, item] of handleMap.entries()) {
    sourceHandleMap.set(h, `ssr_${item.documentId}`);
  }

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
