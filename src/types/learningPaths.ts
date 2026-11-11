/**
 * Canonical Study Plans and Learning Paths Domain Contracts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§1–3
 * - openspec/changes/establish-persistent-study-plans/
 */

// ============================================================================
// 1. Common Results and Error Types (§1.2)
// ============================================================================

export interface FieldIssue {
  path: string; // e.g. "nodes[2].learningObjectives[0]"
  code: string; // stable machine-readable key
  messageKey: string; // i18n key; no source text embedded
}

export type StudyErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'unsupported_version'
  | 'unsupported_platform'
  | 'stale_revision'
  | 'invalid_state'
  | 'order_conflict'
  | 'dependency_cycle'
  | 'dangling_prerequisite'
  | 'duplicate_node'
  | 'invalid_source'
  | 'stale_source'
  | 'missing_source'
  | 'ambiguous_source'
  | 'insufficient_evidence'
  | 'quota_shortfall'
  | 'uncommitted_question'
  | 'committed_question_immutable'
  | 'duplicate_submission'
  | 'grading_unavailable'
  | 'needs_manual_review'
  | 'provider_unavailable'
  | 'provider_capability_missing'
  | 'privacy_denied'
  | 'cost_consent_required'
  | 'source_ai_excluded'
  | 'source_changed'
  | 'job_lease_stale'
  | 'job_cancelled'
  | 'invalid_model_output'
  | 'model_timeout'
  | 'storage_failed'
  | 'cancelled'
  | 'internal_error';

export interface StudyCommandError {
  code: StudyErrorCode;
  messageKey: string;
  retryable: boolean;
  fieldIssues?: FieldIssue[];
  details?: {
    jobId?: string;
    nextStepKey?: string;
    minPosition?: number;
    maxPosition?: number;
    expectedRevision?: number;
    actualRevision?: number;
    requested?: number;
    valid?: number;
    missingByKind?: Record<string, number>;
    remainingNodeIds?: string[];
    cycle?: string[];
  };
}

export type StudyResult<T> =
  | { ok: true; value: T; error?: never }
  | { ok: false; error: StudyCommandError; value?: never };

// ============================================================================
// 2. Source Scope and Evidence Types (§2.1, §2.2)
// ============================================================================

import type {
  StudyDepth,
  KnowledgePolicy,
  SelectedSourceScope,
  ResolvedSourceDocument,
  StudySourceScopeV1,
  StudySourceResolution,
  StudySourceRefInput,
  StudySourceRefV1,
  StudySourceChunk,
} from './studySource';

export type {
  StudyDepth,
  KnowledgePolicy,
  SelectedSourceScope,
  ResolvedSourceDocument,
  StudySourceScopeV1,
  StudySourceResolution,
  StudySourceRefInput,
  StudySourceRefV1,
  StudySourceChunk,
};

// ============================================================================
// 3. Study Plan Aggregate Types (§3)
// ============================================================================

export type StudyPlanStatus = 'active' | 'archived';
export type PlanVersionState = 'draft' | 'published' | 'superseded';
export type NodeActivity = 'not-started' | 'in-progress' | 'completed' | 'skipped';
export type MaterialSupport = 'grounded' | 'unsupported' | 'not-validated';

export interface StudyPlan {
  id: string;
  title: string; // 1..120
  goal: string; // normalizeSessionGoal; 1..200, refuse overflow
  depth: StudyDepth;
  status: StudyPlanStatus;
  currentVersionId: string | null;
  currentVersion: number; // 0 only while initial draft exists
  draftVersionId: string | null;
  revision: number; // increments on head/draft switch/publish; CAS token
  createdAt: string;
  updatedAt: string;
}

export interface StudyPlanNodeIdentity {
  id: string;
  planId: string;
  semanticKey: string; // sha256 of conceptId or NFC case-folded title plus primary objective for deduplication
  createdAt: string;
}

export interface StudyPlanVersionNode {
  nodeId: string;
  title: string; // 1..160
  summary: string; // 0..1000; no raw HTML
  learningObjectives: string[]; // 1..6, each 1..240
  conceptId: string | null; // existing concepts.id; null is a custom/material-gap node
  conceptLabel: string;
  position: number; // 0..includedCount-1; contiguous among included nodes; -1 for excluded
  included: boolean; // false is a user-removal tombstone retained across drafts
  locked: boolean; // content and relative position requested for future drafts
  userAdded: boolean;
  userModified: boolean;
  materialSupport: MaterialSupport;
  whyHere: string | null; // bounded explanation, may be unsupported and labelled
  sourceRefIds: string[]; // max 8; grounded published node requires >=1
}

export interface PlanPrerequisite {
  prerequisiteNodeId: string;
  dependentNodeId: string;
  support: 'user' | 'confirmed-concept-link' | 'inferred' | 'unsupported';
  rationale: string | null;
  sourceRefIds: string[]; // inferred/confirmed edges require evidence; unsupported is visible
}

export interface PlanVersionDiff {
  addedNodeIds: string[];
  removedNodeIds: string[];
  modifiedNodeIds: string[];
  reorderedNodeIds: string[];
  addedPrerequisites: Array<[string, string]>;
  removedPrerequisites: Array<[string, string]>;
  lockConflicts: Array<{
    nodeId: string;
    previousPosition: number;
    actualPosition: number;
    reasonKey: string;
  }>;
}

export interface StudyPlanVersion {
  id: string;
  planId: string;
  version: number; // positive; unique within plan, allocated at draft creation
  state: PlanVersionState;
  baseVersionId: string | null;
  sourceScope: StudySourceScopeV1;
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  changeSummary: PlanVersionDiff | null;
  createdBy: 'user' | 'ai' | 'legacy-import' | 'diagnostic-adaptation';
  createdAt: string;
  publishedAt: string | null;
}

export interface StudyPlanDetail {
  plan: StudyPlan;
  version: StudyPlanVersion;
  activityByNodeId: Record<string, NodeActivity>; // persisted separately; not mastery
  sourceRefs: Record<string, StudySourceResolution>;
}

export interface StudyPlanSummary {
  id: string;
  title: string;
  goal: string;
  depth: StudyDepth;
  status: StudyPlanStatus;
  currentVersion: number;
  nodeCount: number;
  completedNodeCount: number;
  sourceDocumentCount: number;
  hasDraft: boolean;
  updatedAt: string;
}

export interface CreateStudyPlanInput {
  title: string;
  goal: string;
  depth: StudyDepth;
  sourceScope: StudySourceScopeV1 | Record<string, unknown>;
  initialNodes?: StudyPlanVersionNode[];
  initialPrerequisites?: PlanPrerequisite[];
}

export interface SaveStudyPlanDraftInput {
  planId: string;
  expectedDraftRevision: number;
  sourceRefs?: Record<string, StudySourceRefInput>;
  sourceScope?: StudySourceScopeV1 | Record<string, unknown>;
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
}

export interface LegacyImportResult {
  planId: string;
  importedNodeCount: number;
  importedVersion: number;
  isRetry: boolean;
}

// Re-export algorithms and validators
import {
  orderStudyPlan,
  calculateManualMoveBounds,
  reorderStudyPlanNode,
  type StudyPlanOrderSuccess,
  type ManualMoveBounds,
} from '../lib/study-plans/topology';

export {
  orderStudyPlan,
  calculateManualMoveBounds,
  reorderStudyPlanNode,
  type StudyPlanOrderSuccess,
  type ManualMoveBounds,
};

export {
  validateStudyPlan,
  validateStudyPlanVersion,
  validateStudyPlanNode,
  STUDY_PLAN_LIMITS,
} from '../lib/study-plans/validation';

// ============================================================================
// 4. Legacy Compatibility Layer (for transitional migration until C1-T07)
// ============================================================================

/** @deprecated Legacy node status. Use NodeActivity instead. */
export type PathNodeStatus = 'pending' | 'active' | 'completed' | 'skipped';

/** @deprecated Legacy goal status. Use StudyPlanStatus instead. */
export type GoalStatus = 'active' | 'completed' | 'archived';

/** @deprecated Legacy learning goal type. Use StudyPlan instead. */
export interface LearningGoal {
  id: string;
  title: string;
  description?: string;
  scope?: {
    collectionIds?: string[];
    tagIds?: string[];
  };
  status: GoalStatus;
  createdAt: string;
}

/** @deprecated Legacy learning path node type. Use StudyPlanVersionNode instead. */
export interface LearningPathNode {
  id: string;
  pathId: string;
  title: string;
  conceptId?: string;
  conceptName?: string;
  sourceDocIds: string[];
  prerequisiteNodeIds: string[];
  estimatedMasteryStart?: number;
  targetMastery?: number;
  orderIndex: number;
  isUserModified: boolean;
  status: PathNodeStatus;
}

/** @deprecated Legacy learning path type. Use StudyPlan instead. */
export interface LearningPath {
  id: string;
  goalId: string;
  version: number;
  title: string;
  nodes: LearningPathNode[];
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Topologically sorts path nodes ensuring all prerequisite nodes come before dependent nodes.
 * Updated to use strict ordering and reject cycles and dangling prerequisites.
 */
export function generateLearningPathTopology(
  nodes: Omit<LearningPathNode, 'orderIndex'>[]
): LearningPathNode[] {
  // Convert legacy nodes into StudyPlanVersionNode representation
  const versionNodes: StudyPlanVersionNode[] = nodes.map((n, idx) => ({
    nodeId: n.id,
    title: n.title,
    summary: '',
    learningObjectives: ['Learn topic'],
    conceptId: n.conceptId ?? null,
    conceptLabel: n.conceptName ?? n.title,
    position: idx,
    included: true,
    locked: false,
    userAdded: false,
    userModified: n.isUserModified,
    materialSupport: 'not-validated',
    whyHere: null,
    sourceRefIds: [],
  }));

  const prereqs: PlanPrerequisite[] = [];
  for (const n of nodes) {
    for (const prereqId of n.prerequisiteNodeIds) {
      prereqs.push({
        prerequisiteNodeId: prereqId,
        dependentNodeId: n.id,
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      });
    }
  }

  const result = orderStudyPlan(versionNodes, prereqs);

  if (!result.ok) {
    throw new Error(`Topology planning failed: ${result.error.code} (${result.error.messageKey})`);
  }

  const nodeMap = new Map<string, Omit<LearningPathNode, 'orderIndex'>>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  return result.value.orderedNodes.map((n: StudyPlanVersionNode, idx: number) => {
    const orig = nodeMap.get(n.nodeId)!;
    return {
      ...orig,
      orderIndex: idx,
    };
  });
}

// ============================================================================
// 4. Curriculum Generation Proposal Contracts (§3.3)
// ============================================================================

export type {
  MasteryEvidenceLevel,
  UncertaintyReason,
  CurriculumPriorEvidenceConcept,
  CurriculumPriorEvidence,
  CurriculumGenerationRequest,
  CurriculumTopicProposal,
  CurriculumEdgeProposal,
  CurriculumDecomposeBatchOutput,
  CurriculumPrerequisiteOutput,
} from '../lib/study-plans/generation/types';

