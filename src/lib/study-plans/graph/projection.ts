import type { NodeActivity, StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { StudySourceResolution } from '../../../types/studySource';
import { projectPlanHome } from '../home/projection';
import { orderStudyPlan } from '../topology';
import type {
  EdgeDiagnosticCode,
  GraphDiagnostic,
  NodeSourceSummary,
  ProjectStudyPlanGraphInput,
  SourceHealthStatus,
  StudyPlanGraphEdge,
  StudyPlanGraphNode,
  StudyPlanGraphProjection,
  StudyPlanSourceGraphEdge,
  StudyPlanSourceGraphNode,
} from './types';

function summarizeNodeSources(
  sourceRefIds: readonly string[],
  sourceRefs: Readonly<Record<string, StudySourceResolution>>
): NodeSourceSummary {
  let currentCount = 0;
  let staleCount = 0;
  let missingCount = 0;
  let ambiguousCount = 0;
  let unsupportedCount = 0;
  let unverifiedCount = 0;

  for (const refId of sourceRefIds) {
    const res = sourceRefs[refId];
    if (!res) {
      unverifiedCount += 1;
      continue;
    }
    switch (res.status) {
      case 'current':
        currentCount += 1;
        break;
      case 'stale':
        staleCount += 1;
        break;
      case 'missing':
        missingCount += 1;
        break;
      case 'ambiguous':
        ambiguousCount += 1;
        break;
      case 'unsupported':
        unsupportedCount += 1;
        break;
      default:
        unverifiedCount += 1;
        break;
    }
  }

  const totalCount = sourceRefIds.length;
  let primaryStatus: SourceHealthStatus = 'none';
  if (totalCount > 0) {
    if (missingCount > 0) {
      primaryStatus = 'missing';
    } else if (staleCount > 0) {
      primaryStatus = 'stale';
    } else if (ambiguousCount > 0) {
      primaryStatus = 'ambiguous';
    } else if (unsupportedCount > 0) {
      primaryStatus = 'unsupported';
    } else if (currentCount === totalCount) {
      primaryStatus = 'current';
    } else {
      primaryStatus = 'unverified';
    }
  }

  return {
    totalCount,
    currentCount,
    staleCount,
    missingCount,
    ambiguousCount,
    unsupportedCount,
    unverifiedCount,
    primaryStatus,
  };
}

const STATUS_SEVERITY: Record<Exclude<SourceHealthStatus, 'none'>, number> = {
  missing: 5,
  stale: 4,
  ambiguous: 3,
  unsupported: 2,
  unverified: 1,
  current: 0,
};

function mergeSourceStatus(
  a: Exclude<SourceHealthStatus, 'none'>,
  b: Exclude<SourceHealthStatus, 'none'>
): Exclude<SourceHealthStatus, 'none'> {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

function resolveRefHealth(res: StudySourceResolution | undefined): Exclude<SourceHealthStatus, 'none'> {
  if (!res) return 'unverified';
  switch (res.status) {
    case 'current':
    case 'stale':
    case 'missing':
    case 'ambiguous':
    case 'unsupported':
      return res.status;
    default:
      return 'unverified';
  }
}

function compareCurriculumNodes(a: StudyPlanVersionNode, b: StudyPlanVersionNode): number {
  if (a.included !== b.included) {
    return a.included ? -1 : 1;
  }
  const posA = a.position >= 0 ? a.position : Number.MAX_SAFE_INTEGER;
  const posB = b.position >= 0 ? b.position : Number.MAX_SAFE_INTEGER;
  if (posA !== posB) return posA - posB;
  const titleCmp = a.title.localeCompare(b.title, 'en-US');
  if (titleCmp !== 0) return titleCmp;
  return a.nodeId.localeCompare(b.nodeId, 'en-US');
}

export function projectStudyPlanGraph(input: ProjectStudyPlanGraphInput): StudyPlanGraphProjection {
  const {
    nodes,
    prerequisites,
    activityByNodeId = {},
    sourceRefs = {},
    knowledgeAuthority = { kind: 'manual' },
    nodeEvidenceById = {},
    activeGaps = [],
    includeExcluded = false,
  } = input;

  const diagnostics: GraphDiagnostic[] = [];
  const allNodesById = new Map<string, StudyPlanVersionNode>();
  const duplicateNodeIds: string[] = [];

  for (const node of nodes) {
    if (!node.nodeId) continue;
    if (allNodesById.has(node.nodeId)) {
      duplicateNodeIds.push(node.nodeId);
      continue;
    }
    allNodesById.set(node.nodeId, node);
  }

  if (duplicateNodeIds.length > 0) {
    diagnostics.push({
      code: 'duplicate_node',
      message: `Duplicate topic identifier(s) detected: ${duplicateNodeIds.join(', ')}.`,
      nodeIds: duplicateNodeIds,
    });
  }

  // Assign deterministic 1-indexed curriculum numbers to included nodes
  const sortedIncluded = Array.from(allNodesById.values())
    .filter((n) => n.included)
    .sort(compareCurriculumNodes);
  const curriculumNumberById = new Map<string, number>();
  sortedIncluded.forEach((node, index) => {
    curriculumNumberById.set(node.nodeId, index + 1);
  });

  const visibleRawNodes = includeExcluded
    ? Array.from(allNodesById.values()).sort(compareCurriculumNodes)
    : sortedIncluded;
  const visibleIdSet = new Set(visibleRawNodes.map((n) => n.nodeId));

  // Validate prerequisites cleanly without dropping nodes or throwing
  const seenEdgeKeys = new Set<string>();
  const validEdges: StudyPlanGraphEdge[] = [];
  const invalidEdges: StudyPlanGraphEdge[] = [];
  const directPrereqsMap = new Map<string, string[]>();
  const directDepsMap = new Map<string, string[]>();

  for (const node of visibleRawNodes) {
    directPrereqsMap.set(node.nodeId, []);
    directDepsMap.set(node.nodeId, []);
  }

  for (const edge of prerequisites) {
    const id = `${edge.prerequisiteNodeId}->${edge.dependentNodeId}`;
    let diagnosticCode: EdgeDiagnosticCode | undefined;

    if (edge.prerequisiteNodeId === edge.dependentNodeId) {
      diagnosticCode = 'self_edge';
    } else if (seenEdgeKeys.has(id)) {
      diagnosticCode = 'duplicate_edge';
    } else {
      const fromNode = allNodesById.get(edge.prerequisiteNodeId);
      const toNode = allNodesById.get(edge.dependentNodeId);
      if (!fromNode || !toNode) {
        diagnosticCode = 'dangling_prerequisite';
      } else if (!fromNode.included || !toNode.included) {
        diagnosticCode = 'excluded_endpoint';
      }
    }

    seenEdgeKeys.add(id);

    if (diagnosticCode) {
      const invalidEdge: StudyPlanGraphEdge = {
        id,
        prerequisiteNodeId: edge.prerequisiteNodeId,
        dependentNodeId: edge.dependentNodeId,
        support: edge.support,
        rationale: edge.rationale,
        sourceRefIds: [...edge.sourceRefIds],
        isValid: false,
        diagnosticCode,
      };
      invalidEdges.push(invalidEdge);
      diagnostics.push({
        code: diagnosticCode,
        message: `Prerequisite link "${id}" is invalid (${diagnosticCode.replace(/_/g, ' ')}).`,
        edgeId: id,
        nodeIds: [edge.prerequisiteNodeId, edge.dependentNodeId],
      });
      continue;
    }

    if (visibleIdSet.has(edge.prerequisiteNodeId) && visibleIdSet.has(edge.dependentNodeId)) {
      validEdges.push({
        id,
        prerequisiteNodeId: edge.prerequisiteNodeId,
        dependentNodeId: edge.dependentNodeId,
        support: edge.support,
        rationale: edge.rationale,
        sourceRefIds: [...edge.sourceRefIds],
        isValid: true,
      });
      directPrereqsMap.get(edge.dependentNodeId)?.push(edge.prerequisiteNodeId);
      directDepsMap.get(edge.prerequisiteNodeId)?.push(edge.dependentNodeId);
    }
  }

  // Run canonical topology check for cycle / validation diagnostics
  const topoResult = orderStudyPlan(Array.from(allNodesById.values()), prerequisites);
  if (!topoResult.ok && topoResult.error.code === 'dependency_cycle') {
    const cycleIds = topoResult.error.details?.cycle ?? topoResult.error.details?.remainingNodeIds ?? [];
    diagnostics.push({
      code: 'dependency_cycle',
      message: `Circular prerequisite dependency detected across ${cycleIds.length} topic(s).`,
      nodeIds: cycleIds,
    });
  }

  // Compute recommended next node using canonical PlanHome projection when not overridden
  let recommendedNextNodeId = input.recommendedNextNodeId ?? null;
  if (input.recommendedNextNodeId === undefined) {
    const syntheticDetail: StudyPlanDetail = {
      plan: {
        id: 'graph-projection',
        title: '',
        goal: '',
        depth: 'foundational',
        status: 'active',
        currentVersionId: null,
        currentVersion: 1,
        draftVersionId: null,
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
      version: {
        id: 'graph-projection-v',
        planId: 'graph-projection',
        version: 1,
        state: 'draft',
        baseVersionId: null,
        sourceScope: null,
        knowledgeAuthority,
        nodes: topoResult.ok ? topoResult.value.orderedNodes : Array.from(allNodesById.values()),
        prerequisites: [...prerequisites],
        changeSummary: null,
        createdBy: 'user',
        createdAt: '',
        publishedAt: null,
      },
      activityByNodeId: { ...activityByNodeId },
      sourceRefs: { ...sourceRefs },
    };
    const homeProj = projectPlanHome(syntheticDetail);
    recommendedNextNodeId = homeProj.recommendation.nodeId;
  }

  // Count active gaps per node
  const gapCountByNodeId = new Map<string, number>();
  for (const gap of activeGaps) {
    if (gap.status === 'active' && gap.nodeId) {
      gapCountByNodeId.set(gap.nodeId, (gapCountByNodeId.get(gap.nodeId) ?? 0) + 1);
    }
  }

  const statusCounts: Record<NodeActivity, number> = {
    'not-started': 0,
    'in-progress': 0,
    completed: 0,
    skipped: 0,
  };
  let lockedCount = 0;
  let staleOrMissingSourceNodeCount = 0;

  // Source node grouping for Source Coverage layer
  const sourceGroups = new Map<
    string,
    {
      id: string;
      documentId: string | null;
      title: string;
      kind: string;
      status: Exclude<SourceHealthStatus, 'none'>;
      refIds: Set<string>;
      linkedNodeIds: Set<string>;
      topicEdges: Map<string, { refIds: Set<string>; status: Exclude<SourceHealthStatus, 'none'> }>;
    }
  >();

  const graphNodes: StudyPlanGraphNode[] = visibleRawNodes.map((node) => {
    const activity: NodeActivity = activityByNodeId[node.nodeId] ?? 'not-started';
    if (node.included) {
      statusCounts[activity] += 1;
      if (node.locked) lockedCount += 1;
    }

    const directPrereqs = (directPrereqsMap.get(node.nodeId) ?? []).slice().sort((a, b) => {
      return (curriculumNumberById.get(a) ?? 9999) - (curriculumNumberById.get(b) ?? 9999);
    });
    const directDeps = (directDepsMap.get(node.nodeId) ?? []).slice().sort((a, b) => {
      return (curriculumNumberById.get(a) ?? 9999) - (curriculumNumberById.get(b) ?? 9999);
    });

    let incompletePrerequisiteCount = 0;
    for (const prereqId of directPrereqs) {
      const prereqAct = activityByNodeId[prereqId] ?? 'not-started';
      if (prereqAct !== 'completed' && prereqAct !== 'skipped') {
        incompletePrerequisiteCount += 1;
      }
    }

    const prerequisiteReadiness =
      directPrereqs.length === 0
        ? 'entry'
        : incompletePrerequisiteCount === 0
        ? 'ready'
        : 'incomplete-prerequisites';

    const sourceSummary = summarizeNodeSources(node.sourceRefIds, sourceRefs);
    if (
      node.included &&
      (sourceSummary.primaryStatus === 'stale' ||
        sourceSummary.primaryStatus === 'missing' ||
        sourceSummary.primaryStatus === 'ambiguous')
    ) {
      staleOrMissingSourceNodeCount += 1;
    }

    // Populate source graph groups for Source Coverage layer
    for (const refId of node.sourceRefIds) {
      const res = sourceRefs[refId];
      const docKey = res?.ref?.documentId || refId;
      const sourceNodeId = `source:${docKey}`;
      const status = resolveRefHealth(res);
      let group = sourceGroups.get(sourceNodeId);
      if (!group) {
        group = {
          id: sourceNodeId,
          documentId: res?.ref?.documentId ?? null,
          title: res?.ref?.documentTitle || `Source ${refId.slice(0, 8)}`,
          kind: res?.ref?.sourceType || res?.ref?.jump?.kind || 'source',
          status,
          refIds: new Set<string>(),
          linkedNodeIds: new Set<string>(),
          topicEdges: new Map(),
        };
        sourceGroups.set(sourceNodeId, group);
      } else {
        group.status = mergeSourceStatus(group.status, status);
      }
      group.refIds.add(refId);
      group.linkedNodeIds.add(node.nodeId);

      const existingTopicEdge = group.topicEdges.get(node.nodeId);
      if (!existingTopicEdge) {
        group.topicEdges.set(node.nodeId, { refIds: new Set([refId]), status });
      } else {
        existingTopicEdge.refIds.add(refId);
        existingTopicEdge.status = mergeSourceStatus(existingTopicEdge.status, status);
      }
    }

    return {
      nodeId: node.nodeId,
      title: node.title,
      summary: node.summary,
      conceptId: node.conceptId,
      conceptLabel: node.conceptLabel,
      curriculumNumber: curriculumNumberById.get(node.nodeId) ?? -1,
      position: node.position,
      included: node.included,
      locked: node.locked,
      userAdded: node.userAdded,
      userModified: node.userModified,
      activity,
      prerequisiteReadiness,
      incompletePrerequisiteCount,
      directPrerequisiteIds: directPrereqs,
      directDependentIds: directDeps,
      materialSupport: node.materialSupport,
      whyHere: node.whyHere,
      learningObjectives: [...node.learningObjectives],
      sourceRefIds: [...node.sourceRefIds],
      sourceSummary,
      demonstratedLevel: nodeEvidenceById[node.nodeId]?.demonstrated?.level ?? null,
      activeGapCount: gapCountByNodeId.get(node.nodeId) ?? 0,
      isRecommendedNext: recommendedNextNodeId === node.nodeId,
    };
  });

  if (staleOrMissingSourceNodeCount > 0) {
    diagnostics.push({
      code: 'stale_or_missing_sources',
      message: `${staleOrMissingSourceNodeCount} topic(s) have stale, missing, or ambiguous source references.`,
    });
  }

  const sourceNodes: StudyPlanSourceGraphNode[] = Array.from(sourceGroups.values())
    .map((g) => ({
      id: g.id,
      documentId: g.documentId,
      title: g.title,
      kind: g.kind,
      status: g.status,
      refIds: Array.from(g.refIds).sort(),
      linkedNodeIds: Array.from(g.linkedNodeIds).sort(),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en-US') || a.id.localeCompare(b.id, 'en-US'));

  const sourceEdges: StudyPlanSourceGraphEdge[] = [];
  for (const sNode of sourceNodes) {
    const group = sourceGroups.get(sNode.id)!;
    const topicIds = Array.from(group.topicEdges.keys()).sort();
    for (const topicNodeId of topicIds) {
      const info = group.topicEdges.get(topicNodeId)!;
      sourceEdges.push({
        id: `${sNode.id}=>${topicNodeId}`,
        sourceNodeId: sNode.id,
        topicNodeId,
        refIds: Array.from(info.refIds).sort(),
        status: info.status,
      });
    }
  }

  // Deterministic structural key: excludes transient interaction, activity, or evidence state
  const nodeKeyPart = graphNodes
    .map((n) => `${n.nodeId}:${n.included ? 1 : 0}:${n.position}:${n.title}`)
    .sort()
    .join('|');
  const edgeKeyPart = validEdges
    .map((e) => `${e.prerequisiteNodeId}->${e.dependentNodeId}:${e.support}`)
    .sort()
    .join('|');
  const sourceKeyPart = sourceEdges
    .map((se) => se.id)
    .sort()
    .join('|');
  const structuralKey = `${includeExcluded ? 1 : 0}::${nodeKeyPart}::${edgeKeyPart}::${sourceKeyPart}`;

  return {
    nodes: graphNodes,
    edges: validEdges,
    invalidEdges,
    sourceNodes,
    sourceEdges,
    hasPrerequisites: validEdges.length > 0,
    recommendedNextNodeId,
    knowledgeAuthorityKind: knowledgeAuthority.kind,
    statusCounts,
    lockedCount,
    staleOrMissingSourceNodeCount,
    diagnostics,
    structuralKey,
  };
}
