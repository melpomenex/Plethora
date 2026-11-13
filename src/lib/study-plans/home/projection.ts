/**
 * Plan Home deterministic recommendation projection (task 1.1).
 *
 * Composes the plan version's nodes, activity, prerequisites and source status
 * into a single advisory “Continue” action with an explainable reason, plus a
 * separate real due-review count (or unavailable). Advisory only: it never
 * mutates scheduler state, dates or Queue ordering.
 */

import type { StudyPlanDetail, NodeActivity } from '../../../types/learningPaths';

export type PlanRecommendationReason =
  | 'resume'
  | 'next-topic'
  | 'prerequisite-blocked'
  | 'no-sources'
  | 'all-complete';

export interface PlanHomeRecommendation {
  nodeId: string | null;
  title: string;
  reasonKey: PlanRecommendationReason;
  reasonLabelKey: string;
  /** Dependents currently blocked until this recommendation is met (kept visible). */
  blockedDependents: Array<{ nodeId: string; title: string }>;
  blocked: boolean;
}

export interface PlanHomeProjection {
  recommendation: PlanHomeRecommendation;
  /** Real due-review count; null means the data is unavailable. */
  dueReviewCount: number | null;
  /** Included nodes in path order (browse). */
  path: Array<{ nodeId: string; title: string; position: number; activity: NodeActivity }>;
}

const COMPLETE_ACTIVITY = new Set<NodeActivity>(['completed', 'skipped']);

export function projectPlanHome(
  planDetail: StudyPlanDetail,
  opts: { dueReviewCount?: number | null } = {}
): PlanHomeProjection {
  const nodes = planDetail.version.nodes
    .filter((n) => n.included)
    .sort((a, b) => a.position - b.position);
  const activity = planDetail.activityByNodeId ?? {};
  const incoming = new Map<string, string[]>();
  for (const edge of planDetail.version.prerequisites) {
    const list = incoming.get(edge.dependentNodeId) ?? [];
    list.push(edge.prerequisiteNodeId);
    incoming.set(edge.dependentNodeId, list);
  }

  const dueReviewCount = opts.dueReviewCount ?? null;
  const path = nodes.map((n) => ({
    nodeId: n.nodeId,
    title: n.title,
    position: n.position,
    activity: activity[n.nodeId] ?? ('not-started' as NodeActivity),
  }));

  // Dependents that cannot start until this node is met (visible, never hidden).
  const blockedDependents = nodes
    .filter((n) => {
      const a = activity[n.nodeId] ?? 'not-started';
      return !COMPLETE_ACTIVITY.has(a) && (incoming.get(n.nodeId) ?? [])
        .some((prereq) => {
          const pa = activity[prereq] ?? 'not-started';
          return !COMPLETE_ACTIVITY.has(pa);
        });
    })
    .map((n) => ({ nodeId: n.nodeId, title: n.title }));

  // 1. Resume the active objective if any.
  const active = nodes.find((n) => activity[n.nodeId] === 'in-progress');
  if (active) {
    return {
      recommendation: {
        nodeId: active.nodeId,
        title: active.title,
        reasonKey: 'resume',
        reasonLabelKey: 'study_plan.home.reason.resume',
        blocked: false,
        blockedDependents,
      },
      dueReviewCount,
      path,
    };
  }

  // 2. First not-done topic in prerequisite order with an explainable reason.
  const next = nodes.find((n) => !COMPLETE_ACTIVITY.has(activity[n.nodeId] ?? 'not-started'));
  if (!next) {
    return {
      recommendation: {
        nodeId: null,
        title: '',
        reasonKey: 'all-complete',
        reasonLabelKey: 'study_plan.home.reason.all_complete',
        blocked: false,
        blockedDependents: [],
      },
      dueReviewCount,
      path,
    };
  }

  const isLibrary = planDetail.version.knowledgeAuthority.kind === 'library';
  const missingSources = isLibrary && next.sourceRefIds.length === 0;
  return {
    recommendation: {
      nodeId: next.nodeId,
      title: next.title,
      reasonKey: missingSources ? 'no-sources' : 'next-topic',
      reasonLabelKey: missingSources
        ? 'study_plan.home.reason.no_sources'
        : 'study_plan.home.reason.next_topic',
      blocked: false,
      blockedDependents,
    },
    dueReviewCount,
    path,
  };
}
