import type { StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type {
  LearningSegment,
  LearningSegmentObjectiveLink,
  ObjectiveCoverageStatus,
  StudyTrailItem,
  StudyTrailOverview,
} from '../../../types/studyTrail';

export interface StudyQueueEntry {
  item: StudyTrailItem;
  node: StudyPlanVersionNode;
  objectiveText: string;
  segment: LearningSegment | null;
  alternatives: Array<{ link: LearningSegmentObjectiveLink; segment: LearningSegment }>;
  coverageStatus: ObjectiveCoverageStatus;
  documentTitle: string;
  estimatedMinutes: number;
  unmetPrerequisites: Array<{ nodeId: string; title: string }>;
  isBlocked: boolean;
  isCompleted: boolean;
}

export interface StudyQueueProjection {
  nextRecommended: StudyQueueEntry | null;
  remediationItems: StudyQueueEntry[];
  upcomingItems: StudyQueueEntry[];
  blockedItems: StudyQueueEntry[];
  completedItems: StudyQueueEntry[];
  uncoveredCount: number;
  totalEstimatedMinutesRemaining: number;
}

export function isTrailItemCompleted(status: StudyTrailItem['status']): boolean {
  return status === 'reading_completed' || status === 'check_passed' || status === 'skipped';
}

export function formatEstimatedMinutes(seconds: number): number {
  if (!seconds || seconds <= 0) return 1;
  return Math.max(1, Math.round(seconds / 60));
}

export function projectStudyQueue(
  detail: StudyPlanDetail,
  overview: StudyTrailOverview | null,
): StudyQueueProjection {
  if (!overview) {
    return {
      nextRecommended: null,
      remediationItems: [],
      upcomingItems: [],
      blockedItems: [],
      completedItems: [],
      uncoveredCount: 0,
      totalEstimatedMinutesRemaining: 0,
    };
  }

  const nodeMap = new Map(detail.version.nodes.map((n) => [n.nodeId, n]));
  const segmentMap = new Map(overview.segments.map((s) => [s.id, s]));

  // Determine which nodes are completed (either via trail items or node activity)
  const completedNodes = new Set<string>();
  for (const [nodeId, act] of Object.entries(detail.activityByNodeId)) {
    if (act === 'completed' || act === 'skipped') {
      completedNodes.add(nodeId);
    }
  }
  const nodeItems = new Map<string, StudyTrailItem[]>();
  for (const item of overview.trailItems) {
    if (!item.isRemediation) {
      const list = nodeItems.get(item.nodeId) ?? [];
      list.push(item);
      nodeItems.set(item.nodeId, list);
    }
  }
  for (const [nodeId, items] of nodeItems.entries()) {
    if (items.length > 0 && items.every((i) => isTrailItemCompleted(i.status))) {
      completedNodes.add(nodeId);
    }
  }

  // Build prerequisite lookup
  const prereqMap = new Map<string, string[]>();
  for (const edge of detail.version.prerequisites) {
    const list = prereqMap.get(edge.dependentNodeId) ?? [];
    list.push(edge.prerequisiteNodeId);
    prereqMap.set(edge.dependentNodeId, list);
  }

  const entries: StudyQueueEntry[] = [];
  let uncoveredCount = 0;

  for (const item of overview.trailItems) {
    const node = nodeMap.get(item.nodeId);
    if (!node || !node.included) continue;

    const objectiveText = node.learningObjectives[item.objectiveIndex] ?? node.title;
    const segment = item.segmentId ? segmentMap.get(item.segmentId) ?? null : null;
    const objLinks = overview.objectiveLinks.filter(
      (l) => l.nodeId === item.nodeId && l.objectiveIndex === item.objectiveIndex,
    );
    const alternatives = objLinks
      .filter((l) => l.segmentId !== item.segmentId)
      .map((link) => ({ link, segment: segmentMap.get(link.segmentId) }))
      .filter((x): x is { link: LearningSegmentObjectiveLink; segment: LearningSegment } => Boolean(x.segment));

    const coverageStatus: ObjectiveCoverageStatus =
      objLinks.find((l) => l.segmentId === item.segmentId)?.coverageStatus ??
      objLinks[0]?.coverageStatus ??
      (segment ? 'adequately_covered' : 'no_match');

    if (!segment || coverageStatus === 'no_match' || coverageStatus === 'insufficient') {
      uncoveredCount += 1;
    }

    const prereqs = prereqMap.get(item.nodeId) ?? [];
    const unmetPrerequisites = prereqs
      .filter((pid) => !completedNodes.has(pid))
      .map((pid) => ({
        nodeId: pid,
        title: nodeMap.get(pid)?.title ?? pid,
      }));

    const isCompleted = isTrailItemCompleted(item.status);
    const isBlocked = !isCompleted && !item.isRemediation && unmetPrerequisites.length > 0;
    const documentTitle = segment
      ? overview.documentTitles[segment.documentId] ?? segment.title
      : '';
    const estimatedMinutes = segment ? formatEstimatedMinutes(segment.estimatedDurationSeconds) : 0;

    entries.push({
      item,
      node,
      objectiveText,
      segment,
      alternatives,
      coverageStatus,
      documentTitle,
      estimatedMinutes,
      unmetPrerequisites,
      isBlocked,
      isCompleted,
    });
  }

  const remediationItems = entries.filter((e) => e.item.isRemediation && !e.isCompleted);
  const completedItems = entries.filter((e) => e.isCompleted);
  const blockedItems = entries.filter((e) => !e.item.isRemediation && !e.isCompleted && e.isBlocked);
  const readyUpcoming = entries.filter((e) => !e.item.isRemediation && !e.isCompleted && !e.isBlocked);

  // Prefer in-progress or remediation first, else first ready upcoming item with a segment (or first ready)
  const nextRecommended =
    remediationItems[0] ??
    readyUpcoming.find((e) => e.item.status === 'in_progress') ??
    readyUpcoming.find((e) => e.segment !== null) ??
    readyUpcoming[0] ??
    null;

  const upcomingItems = readyUpcoming.filter((e) => e.item.id !== nextRecommended?.item.id);
  const totalEstimatedMinutesRemaining = [...remediationItems, ...readyUpcoming, ...blockedItems]
    .reduce((sum, e) => sum + e.estimatedMinutes, 0);

  return {
    nextRecommended,
    remediationItems,
    upcomingItems,
    blockedItems,
    completedItems,
    uncoveredCount,
    totalEstimatedMinutesRemaining,
  };
}
