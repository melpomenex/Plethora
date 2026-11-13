/**
 * Pure fail-closed schema validators for Curriculum Generation proposals.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T01)
 */

import type { FieldIssue } from '../../../types/learningPaths';
import type {
  CurriculumDecomposeBatchOutput,
  CurriculumEdgeProposal,
  CurriculumGenerationRequest,
  CurriculumPriorEvidence,
  CurriculumPrerequisiteOutput,
  CurriculumTopicProposal,
  MasteryEvidenceLevel,
  UncertaintyReason,
} from './types';
import { CURRICULUM_LIMITS } from './curriculumSchemas';
import { validateStudySourceScope } from '../sourceValidation';
import type { StudySourceScopeV1 } from '../../../types/studySource';

export type CurriculumValidationResult<T> =
  | { success: true; data: T; issues?: never }
  | { success: false; issues: FieldIssue[]; data?: never };

const VALID_MASTERY_LEVELS: Set<MasteryEvidenceLevel> = new Set([
  'insufficient-evidence',
  'needs-attention',
  'developing',
  'demonstrated-consistently',
]);

const VALID_UNCERTAINTY_REASONS: Set<UncertaintyReason> = new Set([
  'no-assessment',
  'one-independent-session',
  'few-independent-sessions',
  'same-question-repetition',
  'hints-used',
  'ai-graded',
  'conflicting-outcomes',
  'stale-evidence',
  'narrow-difficulty',
  'source-missing',
  'not-enough-recent-success',
  'low-learner-confidence',
  'high-confidence-error',
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validates a batch decomposition proposal against schema rules and hydrated source bounds.
 */
export function validateCurriculumDecomposeBatch(
  payload: unknown,
  allowedSourceHandles: Set<string> | string[]
): CurriculumValidationResult<CurriculumDecomposeBatchOutput> {
  const issues: FieldIssue[] = [];

  if (!isRecord(payload)) {
    return {
      success: false,
      issues: [
        {
          path: 'root',
          code: 'invalid_input',
          messageKey: 'errors.curriculum.decompose_root_object_expected',
        },
      ],
    };
  }

  // Schema version check
  if (payload.schemaVersion !== CURRICULUM_LIMITS.SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'unsupported_version',
      messageKey: 'errors.curriculum.unsupported_schema_version',
    });
  }

  const allowedSources =
    allowedSourceHandles instanceof Set
      ? allowedSourceHandles
      : new Set(allowedSourceHandles);

  if (!Array.isArray(payload.topics)) {
    issues.push({
      path: 'topics',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.topics_array_expected',
    });
    return { success: false, issues };
  }

  const topicCount = payload.topics.length;
  if (topicCount < CURRICULUM_LIMITS.MIN_TOPICS_PER_BATCH) {
    issues.push({
      path: 'topics',
      code: 'quota_shortfall',
      messageKey: 'errors.curriculum.too_few_topics_in_batch',
    });
  } else if (topicCount > CURRICULUM_LIMITS.MAX_TOPICS_PER_BATCH) {
    issues.push({
      path: 'topics',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.too_many_topics_in_batch',
    });
  }

  const seenHandles = new Set<string>();
  const validatedTopics: CurriculumTopicProposal[] = [];

  payload.topics.forEach((rawTopic, idx) => {
    const path = `topics[${idx}]`;
    if (!isRecord(rawTopic)) {
      issues.push({
        path,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.topic_object_expected',
      });
      return;
    }

    // Handle
    const handle = typeof rawTopic.handle === 'string' ? rawTopic.handle.trim() : '';
    if (!handle || !CURRICULUM_LIMITS.HANDLE_REGEX.test(handle)) {
      issues.push({
        path: `${path}.handle`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_topic_handle',
      });
    } else if (seenHandles.has(handle)) {
      issues.push({
        path: `${path}.handle`,
        code: 'duplicate_node',
        messageKey: 'errors.curriculum.duplicate_topic_handle',
      });
    } else {
      seenHandles.add(handle);
    }

    // Title
    const title = typeof rawTopic.title === 'string' ? rawTopic.title.trim() : '';
    if (
      title.length < CURRICULUM_LIMITS.TITLE_MIN ||
      title.length > CURRICULUM_LIMITS.TITLE_MAX
    ) {
      issues.push({
        path: `${path}.title`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_title_length',
      });
    }

    // Summary
    const summary = typeof rawTopic.summary === 'string' ? rawTopic.summary.trim() : '';
    if (summary.length > CURRICULUM_LIMITS.SUMMARY_MAX) {
      issues.push({
        path: `${path}.summary`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.summary_too_long',
      });
    }

    // Concept Name
    const conceptName =
      typeof rawTopic.conceptName === 'string' ? rawTopic.conceptName.trim() : '';
    if (
      conceptName.length < CURRICULUM_LIMITS.CONCEPT_NAME_MIN ||
      conceptName.length > CURRICULUM_LIMITS.CONCEPT_NAME_MAX
    ) {
      issues.push({
        path: `${path}.conceptName`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_concept_name_length',
      });
    }

    // Material Support
    const materialSupport = rawTopic.materialSupport;
    if (materialSupport !== 'grounded' && materialSupport !== 'unsupported') {
      issues.push({
        path: `${path}.materialSupport`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_material_support',
      });
    }

    // Learning Objectives
    const rawObjectives = rawTopic.learningObjectives;
    const validatedObjectives: string[] = [];
    if (!Array.isArray(rawObjectives)) {
      issues.push({
        path: `${path}.learningObjectives`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.objectives_array_expected',
      });
    } else if (
      rawObjectives.length < CURRICULUM_LIMITS.MIN_OBJECTIVES_PER_TOPIC ||
      rawObjectives.length > CURRICULUM_LIMITS.MAX_OBJECTIVES_PER_TOPIC
    ) {
      issues.push({
        path: `${path}.learningObjectives`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_objective_count',
      });
    } else {
      rawObjectives.forEach((obj, objIdx) => {
        const str = typeof obj === 'string' ? obj.trim() : '';
        if (
          str.length < CURRICULUM_LIMITS.OBJECTIVE_MIN ||
          str.length > CURRICULUM_LIMITS.OBJECTIVE_MAX
        ) {
          issues.push({
            path: `${path}.learningObjectives[${objIdx}]`,
            code: 'invalid_input',
            messageKey: 'errors.curriculum.invalid_objective_length',
          });
        } else {
          validatedObjectives.push(str);
        }
      });
    }

    // Source Handles
    const rawSourceHandles = rawTopic.sourceHandles;
    const validatedSourceHandles: string[] = [];
    if (!Array.isArray(rawSourceHandles)) {
      issues.push({
        path: `${path}.sourceHandles`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.source_handles_array_expected',
      });
    } else {
      if (rawSourceHandles.length > CURRICULUM_LIMITS.MAX_SOURCES_PER_TOPIC) {
        issues.push({
          path: `${path}.sourceHandles`,
          code: 'invalid_source',
          messageKey: 'errors.curriculum.too_many_source_handles',
        });
      }

      if (materialSupport === 'grounded' && rawSourceHandles.length === 0) {
        issues.push({
          path: `${path}.sourceHandles`,
          code: 'insufficient_evidence',
          messageKey: 'errors.curriculum.grounded_node_requires_source',
        });
      }

      rawSourceHandles.forEach((sh, shIdx) => {
        const str = typeof sh === 'string' ? sh.trim() : '';
        if (!str) {
          issues.push({
            path: `${path}.sourceHandles[${shIdx}]`,
            code: 'invalid_source',
            messageKey: 'errors.curriculum.empty_source_handle',
          });
        } else if (!allowedSources.has(str)) {
          issues.push({
            path: `${path}.sourceHandles[${shIdx}]`,
            code: 'missing_source',
            messageKey: 'errors.curriculum.hallucinated_source_handle',
          });
        } else {
          validatedSourceHandles.push(str);
        }
      });
    }

    // Why Here (optional explanation)
    let whyHere: string | null = null;
    if (rawTopic.whyHere !== undefined && rawTopic.whyHere !== null) {
      if (typeof rawTopic.whyHere === 'string') {
        const trimmed = rawTopic.whyHere.trim();
        if (trimmed.length > CURRICULUM_LIMITS.WHY_HERE_MAX) {
          issues.push({
            path: `${path}.whyHere`,
            code: 'invalid_input',
            messageKey: 'errors.curriculum.why_here_too_long',
          });
        } else {
          whyHere = trimmed;
        }
      } else {
        issues.push({
          path: `${path}.whyHere`,
          code: 'invalid_input',
          messageKey: 'errors.curriculum.why_here_string_expected',
        });
      }
    }

    validatedTopics.push({
      handle,
      title,
      summary,
      learningObjectives: validatedObjectives,
      conceptName,
      materialSupport: materialSupport as 'grounded' | 'unsupported',
      sourceHandles: validatedSourceHandles,
      whyHere,
    });
  });

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      schemaVersion: 1,
      topics: validatedTopics,
    },
  };
}

/**
 * Validates proposed prerequisite edges between known batch-local or plan topic handles.
 */
export function validateCurriculumPrerequisiteOutput(
  payload: unknown,
  knownTopicHandles: Set<string> | string[],
  allowedSourceHandles?: Set<string> | string[]
): CurriculumValidationResult<CurriculumPrerequisiteOutput> {
  const issues: FieldIssue[] = [];

  if (!isRecord(payload)) {
    return {
      success: false,
      issues: [
        {
          path: 'root',
          code: 'invalid_input',
          messageKey: 'errors.curriculum.prereq_root_object_expected',
        },
      ],
    };
  }

  if (payload.schemaVersion !== CURRICULUM_LIMITS.SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'unsupported_version',
      messageKey: 'errors.curriculum.unsupported_schema_version',
    });
  }

  if (!Array.isArray(payload.edges)) {
    issues.push({
      path: 'edges',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.edges_array_expected',
    });
    return { success: false, issues };
  }

  if (payload.edges.length > CURRICULUM_LIMITS.MAX_EDGES_PER_BATCH) {
    issues.push({
      path: 'edges',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.too_many_edges_in_batch',
    });
  }

  const topicHandles =
    knownTopicHandles instanceof Set
      ? knownTopicHandles
      : new Set(knownTopicHandles);

  const allowedSources = allowedSourceHandles
    ? allowedSourceHandles instanceof Set
      ? allowedSourceHandles
      : new Set(allowedSourceHandles)
    : null;

  const seenEdges = new Set<string>();
  const validatedEdges: CurriculumEdgeProposal[] = [];

  payload.edges.forEach((rawEdge, idx) => {
    const path = `edges[${idx}]`;
    if (!isRecord(rawEdge)) {
      issues.push({
        path,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.edge_object_expected',
      });
      return;
    }

    const prereq =
      typeof rawEdge.prerequisiteHandle === 'string'
        ? rawEdge.prerequisiteHandle.trim()
        : '';
    const dep =
      typeof rawEdge.dependentHandle === 'string'
        ? rawEdge.dependentHandle.trim()
        : '';

    // Endpoints validity
    if (!prereq || !topicHandles.has(prereq)) {
      issues.push({
        path: `${path}.prerequisiteHandle`,
        code: 'dangling_prerequisite',
        messageKey: 'errors.curriculum.unknown_prerequisite_handle',
      });
    }

    if (!dep || !topicHandles.has(dep)) {
      issues.push({
        path: `${path}.dependentHandle`,
        code: 'dangling_prerequisite',
        messageKey: 'errors.curriculum.unknown_dependent_handle',
      });
    }

    // Self-edge check
    if (prereq && dep && prereq === dep) {
      issues.push({
        path,
        code: 'dependency_cycle',
        messageKey: 'errors.curriculum.self_edge_detected',
      });
    }

    // Duplicate directed edge check
    const edgeKey = `${prereq}->${dep}`;
    if (seenEdges.has(edgeKey)) {
      issues.push({
        path,
        code: 'order_conflict',
        messageKey: 'errors.curriculum.duplicate_edge_detected',
      });
    } else {
      seenEdges.add(edgeKey);
    }

    // Support
    const support = rawEdge.support;
    if (support !== 'inferred' && support !== 'unsupported') {
      issues.push({
        path: `${path}.support`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_edge_support',
      });
    }

    // Rationale
    const rationale =
      typeof rawEdge.rationale === 'string' ? rawEdge.rationale.trim() : '';
    if (
      rationale.length < CURRICULUM_LIMITS.RATIONALE_MIN ||
      rationale.length > CURRICULUM_LIMITS.RATIONALE_MAX
    ) {
      issues.push({
        path: `${path}.rationale`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_rationale_length',
      });
    }

    // Source handles
    const rawSourceHandles = rawEdge.sourceHandles;
    const validatedSourceHandles: string[] = [];
    if (!Array.isArray(rawSourceHandles)) {
      issues.push({
        path: `${path}.sourceHandles`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.source_handles_array_expected',
      });
    } else {
      if (rawSourceHandles.length > CURRICULUM_LIMITS.MAX_SOURCES_PER_EDGE) {
        issues.push({
          path: `${path}.sourceHandles`,
          code: 'invalid_source',
          messageKey: 'errors.curriculum.too_many_source_handles',
        });
      }

      rawSourceHandles.forEach((sh, shIdx) => {
        const str = typeof sh === 'string' ? sh.trim() : '';
        if (allowedSources && str && !allowedSources.has(str)) {
          issues.push({
            path: `${path}.sourceHandles[${shIdx}]`,
            code: 'missing_source',
            messageKey: 'errors.curriculum.hallucinated_source_handle',
          });
        } else if (str) {
          validatedSourceHandles.push(str);
        }
      });
    }

    validatedEdges.push({
      prerequisiteHandle: prereq,
      dependentHandle: dep,
      rationale,
      sourceHandles: validatedSourceHandles,
      support: support as 'inferred' | 'unsupported',
    });
  });

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      schemaVersion: 1,
      edges: validatedEdges,
    },
  };
}

/**
 * Validates prior diagnostic evidence payload if supplied. Accepts null cleanly.
 */
export function validateCurriculumPriorEvidence(
  evidence: unknown
): CurriculumValidationResult<CurriculumPriorEvidence | null> {
  if (evidence === null || evidence === undefined) {
    return { success: true, data: null };
  }

  const issues: FieldIssue[] = [];

  if (!isRecord(evidence)) {
    return {
      success: false,
      issues: [
        {
          path: 'priorEvidence',
          code: 'invalid_input',
          messageKey: 'errors.curriculum.prior_evidence_object_expected',
        },
      ],
    };
  }

  const diagnosticAttemptId =
    typeof evidence.diagnosticAttemptId === 'string'
      ? evidence.diagnosticAttemptId.trim()
      : '';
  if (!diagnosticAttemptId) {
    issues.push({
      path: 'priorEvidence.diagnosticAttemptId',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.invalid_diagnostic_attempt_id',
    });
  }

  if (!Array.isArray(evidence.concepts)) {
    issues.push({
      path: 'priorEvidence.concepts',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.concepts_array_expected',
    });
    return { success: false, issues };
  }

  const validatedConcepts: CurriculumPriorEvidence['concepts'] = [];

  evidence.concepts.forEach((concept, idx) => {
    const path = `priorEvidence.concepts[${idx}]`;
    if (!isRecord(concept)) {
      issues.push({
        path,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.concept_evidence_object_expected',
      });
      return;
    }

    const conceptId =
      typeof concept.conceptId === 'string' ? concept.conceptId.trim() : '';
    if (!conceptId) {
      issues.push({
        path: `${path}.conceptId`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_concept_id',
      });
    }

    const level = concept.level as MasteryEvidenceLevel;
    if (!VALID_MASTERY_LEVELS.has(level)) {
      issues.push({
        path: `${path}.level`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.invalid_mastery_level',
      });
    }

    let observedMean: number | null = null;
    if (concept.observedMean !== null && concept.observedMean !== undefined) {
      if (
        typeof concept.observedMean === 'number' &&
        !Number.isNaN(concept.observedMean) &&
        concept.observedMean >= 0 &&
        concept.observedMean <= 1
      ) {
        observedMean = concept.observedMean;
      } else {
        issues.push({
          path: `${path}.observedMean`,
          code: 'invalid_input',
          messageKey: 'errors.curriculum.invalid_observed_mean',
        });
      }
    }

    const uncertainty: UncertaintyReason[] = [];
    if (!Array.isArray(concept.uncertainty)) {
      issues.push({
        path: `${path}.uncertainty`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.uncertainty_array_expected',
      });
    } else {
      concept.uncertainty.forEach((reason, uIdx) => {
        if (!VALID_UNCERTAINTY_REASONS.has(reason as UncertaintyReason)) {
          issues.push({
            path: `${path}.uncertainty[${uIdx}]`,
            code: 'invalid_input',
            messageKey: 'errors.curriculum.invalid_uncertainty_reason',
          });
        } else {
          uncertainty.push(reason as UncertaintyReason);
        }
      });
    }

    const evidenceGroupIds: string[] = [];
    if (!Array.isArray(concept.evidenceGroupIds)) {
      issues.push({
        path: `${path}.evidenceGroupIds`,
        code: 'invalid_input',
        messageKey: 'errors.curriculum.evidence_group_ids_array_expected',
      });
    } else {
      concept.evidenceGroupIds.forEach((egId, egIdx) => {
        if (typeof egId === 'string' && egId.trim()) {
          evidenceGroupIds.push(egId.trim());
        } else {
          issues.push({
            path: `${path}.evidenceGroupIds[${egIdx}]`,
            code: 'invalid_input',
            messageKey: 'errors.curriculum.invalid_evidence_group_id',
          });
        }
      });
    }

    validatedConcepts.push({
      conceptId,
      level,
      observedMean,
      uncertainty,
      evidenceGroupIds,
    });
  });

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      diagnosticAttemptId,
      concepts: validatedConcepts,
    },
  };
}

/**
 * Validates an entire curriculum generation request envelope.
 */
export function validateCurriculumGenerationRequest(
  request: unknown
): CurriculumValidationResult<CurriculumGenerationRequest> {
  const issues: FieldIssue[] = [];

  if (!isRecord(request)) {
    return {
      success: false,
      issues: [
        {
          path: 'root',
          code: 'invalid_input',
          messageKey: 'errors.curriculum.request_object_expected',
        },
      ],
    };
  }

  const planId = typeof request.planId === 'string' ? request.planId.trim() : '';
  if (!planId) {
    issues.push({
      path: 'planId',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.invalid_plan_id',
    });
  }

  const baseVersionId =
    typeof request.baseVersionId === 'string' ? request.baseVersionId.trim() : '';
  if (!baseVersionId) {
    issues.push({
      path: 'baseVersionId',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.invalid_base_version_id',
    });
  }

  const depth = request.depth;
  if (depth !== 'survey' && depth !== 'foundational' && depth !== 'deep') {
    issues.push({
      path: 'depth',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.invalid_depth',
    });
  }

  const knowledgePolicy = request.knowledgePolicy;
  if (
    knowledgePolicy !== 'source-only' &&
    knowledgePolicy !== 'source-plus-model-knowledge' &&
    knowledgePolicy !== 'model-only'
  ) {
    issues.push({
      path: 'knowledgePolicy',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.invalid_knowledge_policy',
    });
  }

  if (typeof request.rulesOnly !== 'boolean') {
    issues.push({
      path: 'rulesOnly',
      code: 'invalid_input',
      messageKey: 'errors.curriculum.rules_only_boolean_expected',
    });
  }

  // Validate Source Scope
  if (knowledgePolicy === 'model-only') {
    if (request.sourceScope !== null) {
      issues.push({
        path: 'sourceScope',
        code: 'invalid_input',
        messageKey: 'study_plan.error.model_only_scope_forbidden',
      });
    }
    if (request.rulesOnly === true) {
      issues.push({
        path: 'rulesOnly',
        code: 'invalid_input',
        messageKey: 'study_generation.error.model_only_outline_forbidden',
      });
    }
  } else {
    const scopeResult = validateStudySourceScope(request.sourceScope as StudySourceScopeV1);
    if (!scopeResult.ok) issues.push(...(scopeResult.error.fieldIssues || []));
  }

  // Validate Prior Evidence
  const priorResult = validateCurriculumPriorEvidence(request.priorEvidence);
  if (!priorResult.success) {
    issues.push(...(priorResult.issues || []));
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      planId,
      baseVersionId,
      depth: depth as CurriculumGenerationRequest['depth'],
      knowledgePolicy: knowledgePolicy as CurriculumGenerationRequest['knowledgePolicy'],
      rulesOnly: request.rulesOnly as boolean,
      sourceScope: request.sourceScope as StudySourceScopeV1 | null,
      priorEvidence: priorResult.data ?? null,
    },
  };
}
