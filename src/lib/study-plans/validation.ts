/**
 * Validation Rules and Fail-Closed Schema Checks for Study Plans.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§1–3
 * - openspec/changes/establish-persistent-study-plans/
 */

import type {
  StudyPlan,
  StudyPlanVersion,
  StudyPlanVersionNode,
  FieldIssue,
  StudyResult,
} from '../../types/learningPaths';

export const STUDY_PLAN_LIMITS = {
  PLAN_TITLE_MIN: 1,
  PLAN_TITLE_MAX: 120,
  PLAN_GOAL_MIN: 1,
  PLAN_GOAL_MAX: 200,
  MAX_MANUAL_NODES: 100,
  MAX_DOCUMENTS: 24,
  MAX_EXTRACTS: 200,
  NODE_TITLE_MIN: 1,
  NODE_TITLE_MAX: 160,
  NODE_SUMMARY_MAX: 1000,
  NODE_OBJECTIVES_MIN: 1,
  NODE_OBJECTIVES_MAX: 6,
  NODE_OBJECTIVE_LENGTH_MIN: 1,
  NODE_OBJECTIVE_LENGTH_MAX: 240,
  MAX_NODE_SOURCES: 8,
} as const;

const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

/**
 * Validates a single StudyPlanVersionNode.
 */
export function validateStudyPlanNode(
  node: StudyPlanVersionNode,
  pathPrefix = 'node'
): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!node.nodeId || node.nodeId.trim().length === 0) {
    issues.push({
      path: `${pathPrefix}.nodeId`,
      code: 'required_field',
      messageKey: 'study_plan.error.node_id_required',
    });
  }

  if (node.included) {
    const trimmedTitle = (node.title || '').trim();
    if (
      trimmedTitle.length < STUDY_PLAN_LIMITS.NODE_TITLE_MIN ||
      trimmedTitle.length > STUDY_PLAN_LIMITS.NODE_TITLE_MAX
    ) {
      issues.push({
        path: `${pathPrefix}.title`,
        code: 'invalid_title_length',
        messageKey: 'study_plan.error.invalid_title_length',
      });
    }

    if (node.summary) {
      const trimmedSummary = node.summary.trim();
      if (trimmedSummary.length > STUDY_PLAN_LIMITS.NODE_SUMMARY_MAX) {
        issues.push({
          path: `${pathPrefix}.summary`,
          code: 'invalid_summary_length',
          messageKey: 'study_plan.error.invalid_summary_length',
        });
      }
      if (HTML_TAG_REGEX.test(node.summary)) {
        issues.push({
          path: `${pathPrefix}.summary`,
          code: 'no_raw_html',
          messageKey: 'study_plan.error.summary_no_html',
        });
      }
    }

    if (
      !node.learningObjectives ||
      node.learningObjectives.length < STUDY_PLAN_LIMITS.NODE_OBJECTIVES_MIN ||
      node.learningObjectives.length > STUDY_PLAN_LIMITS.NODE_OBJECTIVES_MAX
    ) {
      issues.push({
        path: `${pathPrefix}.learningObjectives`,
        code: 'invalid_objectives_count',
        messageKey: 'study_plan.error.invalid_objectives_count',
      });
    } else {
      for (let j = 0; j < node.learningObjectives.length; j++) {
        const obj = (node.learningObjectives[j] || '').trim();
        if (
          obj.length < STUDY_PLAN_LIMITS.NODE_OBJECTIVE_LENGTH_MIN ||
          obj.length > STUDY_PLAN_LIMITS.NODE_OBJECTIVE_LENGTH_MAX
        ) {
          issues.push({
            path: `${pathPrefix}.learningObjectives[${j}]`,
            code: 'invalid_objective_length',
            messageKey: 'study_plan.error.invalid_objective_length',
          });
        }
      }
    }

    if (node.sourceRefIds && node.sourceRefIds.length > STUDY_PLAN_LIMITS.MAX_NODE_SOURCES) {
      issues.push({
        path: `${pathPrefix}.sourceRefIds`,
        code: 'max_sources_exceeded',
        messageKey: 'study_plan.error.max_sources_exceeded',
      });
    }

    if (node.position < 0) {
      issues.push({
        path: `${pathPrefix}.position`,
        code: 'invalid_position',
        messageKey: 'study_plan.error.invalid_position',
      });
    }
  } else {
    // Excluded tombstone
    if (node.position !== -1) {
      issues.push({
        path: `${pathPrefix}.position`,
        code: 'excluded_node_position',
        messageKey: 'study_plan.error.excluded_node_position',
      });
    }
  }

  return issues;
}

/**
 * Validates a StudyPlan aggregate.
 */
export function validateStudyPlan(plan: Partial<StudyPlan>): StudyResult<void> {
  const issues: FieldIssue[] = [];

  const title = (plan.title || '').trim();
  if (
    title.length < STUDY_PLAN_LIMITS.PLAN_TITLE_MIN ||
    title.length > STUDY_PLAN_LIMITS.PLAN_TITLE_MAX
  ) {
    issues.push({
      path: 'title',
      code: 'invalid_title_length',
      messageKey: 'study_plan.error.plan_title_length',
    });
  }

  const goal = (plan.goal || '').trim();
  if (
    goal.length < STUDY_PLAN_LIMITS.PLAN_GOAL_MIN ||
    goal.length > STUDY_PLAN_LIMITS.PLAN_GOAL_MAX
  ) {
    issues.push({
      path: 'goal',
      code: 'invalid_goal_length',
      messageKey: 'study_plan.error.plan_goal_length',
    });
  }

  if (plan.depth && !['survey', 'foundational', 'deep'].includes(plan.depth)) {
    issues.push({
      path: 'depth',
      code: 'invalid_depth',
      messageKey: 'study_plan.error.invalid_depth',
    });
  }

  if (plan.status && !['active', 'archived'].includes(plan.status)) {
    issues.push({
      path: 'status',
      code: 'invalid_status',
      messageKey: 'study_plan.error.invalid_status',
    });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_plan.error.validation_failed',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}

/**
 * Validates a complete StudyPlanVersion graph, including limits, prerequisites,
 * contiguous positions, and publication rules.
 */
export function validateStudyPlanVersion(
  version: StudyPlanVersion
): StudyResult<void> {
  const issues: FieldIssue[] = [];

  if (version.nodes.length > STUDY_PLAN_LIMITS.MAX_MANUAL_NODES) {
    issues.push({
      path: 'nodes',
      code: 'max_nodes_exceeded',
      messageKey: 'study_plan.error.max_nodes_exceeded',
    });
  }

  const nodeMap = new Map<string, StudyPlanVersionNode>();
  const titlesSeen = new Set<string>();
  const positionsSeen = new Set<number>();
  let includedCount = 0;

  for (let i = 0; i < version.nodes.length; i++) {
    const node = version.nodes[i];
    const nodeIssues = validateStudyPlanNode(node, `nodes[${i}]`);
    issues.push(...nodeIssues);

    if (nodeMap.has(node.nodeId)) {
      issues.push({
        path: `nodes[${i}].nodeId`,
        code: 'duplicate_node',
        messageKey: 'study_plan.error.duplicate_node',
      });
    }
    nodeMap.set(node.nodeId, node);

    if (node.included) {
      includedCount++;
      const normalizedTitle = (node.title || '').trim().normalize('NFC').toLocaleLowerCase('en-US');
      if (titlesSeen.has(normalizedTitle)) {
        issues.push({
          path: `nodes[${i}].title`,
          code: 'repeated_title',
          messageKey: 'study_plan.error.repeated_title',
        });
      }
      titlesSeen.add(normalizedTitle);

      if (positionsSeen.has(node.position)) {
        issues.push({
          path: `nodes[${i}].position`,
          code: 'duplicate_position',
          messageKey: 'study_plan.error.duplicate_position',
        });
      }
      positionsSeen.add(node.position);

      // If version is published and material support is grounded, require >= 1 sourceRefIds
      if (version.state === 'published' && node.materialSupport === 'grounded') {
        if (!node.sourceRefIds || node.sourceRefIds.length === 0) {
          issues.push({
            path: `nodes[${i}].sourceRefIds`,
            code: 'missing_source_for_grounded_node',
            messageKey: 'study_plan.error.missing_source_for_grounded_node',
          });
        }
      }
    }
  }

  // Verify contiguous positions 0..includedCount-1
  for (let pos = 0; pos < includedCount; pos++) {
    if (!positionsSeen.has(pos)) {
      issues.push({
        path: 'nodes',
        code: 'non_contiguous_positions',
        messageKey: 'study_plan.error.non_contiguous_positions',
      });
      break;
    }
  }

  // Verify prerequisites
  const edgeKeys = new Set<string>();
  for (let i = 0; i < version.prerequisites.length; i++) {
    const edge = version.prerequisites[i];
    if (edge.prerequisiteNodeId === edge.dependentNodeId) {
      issues.push({
        path: `prerequisites[${i}]`,
        code: 'self_edge',
        messageKey: 'study_plan.error.self_edge',
      });
    }

    const key = `${edge.prerequisiteNodeId}->${edge.dependentNodeId}`;
    if (edgeKeys.has(key)) {
      issues.push({
        path: `prerequisites[${i}]`,
        code: 'duplicate_edge',
        messageKey: 'study_plan.error.duplicate_edge',
      });
    }
    edgeKeys.add(key);

    const fromNode = nodeMap.get(edge.prerequisiteNodeId);
    const toNode = nodeMap.get(edge.dependentNodeId);

    if (!fromNode || !toNode) {
      issues.push({
        path: `prerequisites[${i}]`,
        code: 'dangling_prerequisite',
        messageKey: 'study_plan.error.dangling_prerequisite',
      });
    } else if (!fromNode.included || !toNode.included) {
      issues.push({
        path: `prerequisites[${i}]`,
        code: 'excluded_prerequisite',
        messageKey: 'study_plan.error.excluded_prerequisite',
      });
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_plan.error.validation_failed',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}
