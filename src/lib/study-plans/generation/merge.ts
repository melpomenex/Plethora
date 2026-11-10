/**
 * Curriculum Proposal Reconciliation & Merge Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T02)
 */

import type {
  StudyPlanVersion,
  StudyPlanVersionNode,
  PlanPrerequisite,
  PlanVersionDiff,
  StudyDepth,
} from '../../../types/learningPaths';
import type {
  CurriculumEdgeProposal,
  CurriculumTopicProposal,
} from './types';
import { orderStudyPlan } from '../topology';
import { sha256 } from './requestHash';
import { EVIDENCE_LIMITS } from './planEvidence';

export interface MergeCurriculumInput {
  baseVersion: StudyPlanVersion | null;
  proposedTopics: CurriculumTopicProposal[];
  proposedEdges: CurriculumEdgeProposal[];
  depth: StudyDepth;
  handleToSourceRefIdMap?: Map<string, string>; // Maps batch-local handle "src_h0" -> durable "ssr_..."
}

export interface MergeCurriculumResult {
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  diff: PlanVersionDiff;
  droppedEdgesCount: number;
}

export function computeSemanticKey(
  conceptId: string | null,
  title: string,
  primaryObjective = ''
): string {
  if (conceptId && conceptId.trim()) {
    return sha256(`concept:${conceptId.trim()}`);
  }
  const normTitle = title.normalize('NFC').trim().toLowerCase();
  const normObj = primaryObjective.normalize('NFC').trim().toLowerCase();
  return sha256(`title_obj:${normTitle}:${normObj}`);
}

/**
 * Reconciles newly generated or rules-based curriculum proposals with an existing base plan.
 * Preserves user locks, additions, modifications, and tombstones.
 */
export function mergeCurriculumProposals(
  input: MergeCurriculumInput
): MergeCurriculumResult {
  const depthCap = EVIDENCE_LIMITS.DEPTH_CAPS[input.depth] || 16;
  const baseNodes = input.baseVersion ? [...input.baseVersion.nodes] : [];
  const basePrereqs = input.baseVersion ? [...input.baseVersion.prerequisites] : [];
  const handleMap = input.handleToSourceRefIdMap || new Map<string, string>();

  // Index base nodes by conceptId, conceptLabel, title+obj, and title
  const baseByConceptId = new Map<string, StudyPlanVersionNode>();
  const baseByConceptLabel = new Map<string, StudyPlanVersionNode>();
  const baseByTitleAndObj = new Map<string, StudyPlanVersionNode>();
  const baseByTitle = new Map<string, StudyPlanVersionNode>();
  const baseNodeIds = new Set<string>();

  for (const bNode of baseNodes) {
    baseNodeIds.add(bNode.nodeId);
    if (bNode.conceptId) {
      baseByConceptId.set(bNode.conceptId, bNode);
    }
    if (bNode.conceptLabel) {
      baseByConceptLabel.set(bNode.conceptLabel.toLowerCase().trim(), bNode);
    }
    const titleAndObjKey = computeSemanticKey(
      null,
      bNode.title,
      bNode.learningObjectives[0] || ''
    );
    baseByTitleAndObj.set(titleAndObjKey, bNode);
    baseByTitle.set(bNode.title.toLowerCase().trim(), bNode);
  }

  const mergedNodesMap = new Map<string, StudyPlanVersionNode>();
  const topicHandleToNodeId = new Map<string, string>();

  // 1. Process base nodes first: locks and tombstones must prevail
  for (const bNode of baseNodes) {
    mergedNodesMap.set(bNode.nodeId, { ...bNode });
  }

  // 2. Reconcile proposed topics against base nodes
  for (const pTopic of input.proposedTopics) {
    const titleAndObjKey = computeSemanticKey(
      null,
      pTopic.title,
      pTopic.learningObjectives[0] || ''
    );
    const normConceptName = (pTopic.conceptName || '').toLowerCase().trim();
    const normTitle = (pTopic.title || '').toLowerCase().trim();

    // Look for matching base node
    let matchedBaseNode: StudyPlanVersionNode | undefined;
    if (normConceptName && baseByConceptLabel.has(normConceptName)) {
      matchedBaseNode = baseByConceptLabel.get(normConceptName);
    } else if (normConceptName && baseByConceptId.has(normConceptName)) {
      matchedBaseNode = baseByConceptId.get(normConceptName);
    } else if (baseByTitleAndObj.has(titleAndObjKey)) {
      matchedBaseNode = baseByTitleAndObj.get(titleAndObjKey);
    } else if (baseByTitle.has(normTitle)) {
      matchedBaseNode = baseByTitle.get(normTitle);
    }

    // Resolve sourceRefIds from handles
    const resolvedRefIds: string[] = [];
    for (const sh of pTopic.sourceHandles) {
      const refId = handleMap.get(sh) || sh;
      if (refId && !resolvedRefIds.includes(refId)) {
        resolvedRefIds.push(refId);
      }
    }

    if (matchedBaseNode) {
      const existing = mergedNodesMap.get(matchedBaseNode.nodeId)!;
      topicHandleToNodeId.set(pTopic.handle, existing.nodeId);

      // Precedence Rule 1: Tombstone prevails
      if (!existing.included) {
        // Retain tombstone, do not resurrect
        continue;
      }

      // Precedence Rule 2: Locked node preserves content
      if (existing.locked) {
        // Locked nodes preserve all content & requested position; do not mutate
        continue;
      }

      // Precedence Rule 3: User modified/added nodes preserve user changes
      if (existing.userAdded || existing.userModified) {
        // Only union source refs
        const combinedSources = Array.from(
          new Set([...existing.sourceRefIds, ...resolvedRefIds])
        ).slice(0, 8);
        mergedNodesMap.set(existing.nodeId, {
          ...existing,
          sourceRefIds: combinedSources,
        });
        continue;
      }

      // Standard node update: union objectives and sources
      const combinedObjectives = Array.from(
        new Set([...existing.learningObjectives, ...pTopic.learningObjectives])
      ).slice(0, 6);
      const combinedSources = Array.from(
        new Set([...existing.sourceRefIds, ...resolvedRefIds])
      ).slice(0, 8);

      mergedNodesMap.set(existing.nodeId, {
        ...existing,
        title: pTopic.title,
        summary: pTopic.summary || existing.summary,
        learningObjectives: combinedObjectives,
        conceptLabel: pTopic.conceptName || existing.conceptLabel,
        materialSupport: pTopic.materialSupport,
        whyHere: pTopic.whyHere || existing.whyHere,
        sourceRefIds: combinedSources,
      });
    } else {
      // New proposal: create new node
      const generatedId = `spn_${sha256(pTopic.handle + ':' + pTopic.title).slice(0, 16)}`;
      topicHandleToNodeId.set(pTopic.handle, generatedId);

      mergedNodesMap.set(generatedId, {
        nodeId: generatedId,
        title: pTopic.title,
        summary: pTopic.summary,
        learningObjectives: pTopic.learningObjectives.slice(0, 6),
        conceptId: null,
        conceptLabel: pTopic.conceptName,
        position: -1, // will be assigned by Kahn ordering
        included: true,
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: pTopic.materialSupport,
        whyHere: pTopic.whyHere,
        sourceRefIds: resolvedRefIds.slice(0, 8),
      });
    }
  }

  // 3. Enforce depth cap on included nodes
  // Priority: locked nodes -> userAdded/userModified nodes -> remaining nodes up to depthCap
  let allNodesList = Array.from(mergedNodesMap.values());
  const includedNodes = allNodesList.filter((n) => n.included);
  const excludedNodes = allNodesList.filter((n) => !n.included);

  if (includedNodes.length > depthCap) {
    const lockedOrUser = includedNodes.filter((n) => n.locked || n.userAdded || n.userModified);
    const standard = includedNodes.filter((n) => !n.locked && !n.userAdded && !n.userModified);

    const retained = [...lockedOrUser];
    for (const s of standard) {
      if (retained.length < depthCap) {
        retained.push(s);
      } else {
        // Demote overflow to excluded tombstone
        excludedNodes.push({ ...s, included: false, position: -1 });
      }
    }
    allNodesList = [...retained, ...excludedNodes];
  }

  const activeIncludedNodeIds = new Set(
    allNodesList.filter((n) => n.included).map((n) => n.nodeId)
  );

  // 4. Reconcile Prerequisite Edges
  const preservedBaseEdges: PlanPrerequisite[] = [];
  const seenEdgePairs = new Set<string>();

  // Preserve valid base prerequisites
  for (const bp of basePrereqs) {
    if (
      activeIncludedNodeIds.has(bp.prerequisiteNodeId) &&
      activeIncludedNodeIds.has(bp.dependentNodeId) &&
      bp.prerequisiteNodeId !== bp.dependentNodeId
    ) {
      const pairKey = `${bp.prerequisiteNodeId}->${bp.dependentNodeId}`;
      if (!seenEdgePairs.has(pairKey)) {
        seenEdgePairs.add(pairKey);
        preservedBaseEdges.push(bp);
      }
    }
  }

  // Add proposed edges from model
  let droppedEdgesCount = 0;
  const newProposedEdges: PlanPrerequisite[] = [];

  for (const pEdge of input.proposedEdges) {
    const prereqId =
      topicHandleToNodeId.get(pEdge.prerequisiteHandle) ||
      (activeIncludedNodeIds.has(pEdge.prerequisiteHandle)
        ? pEdge.prerequisiteHandle
        : undefined);
    const depId =
      topicHandleToNodeId.get(pEdge.dependentHandle) ||
      (activeIncludedNodeIds.has(pEdge.dependentHandle)
        ? pEdge.dependentHandle
        : undefined);

    if (
      prereqId &&
      depId &&
      prereqId !== depId &&
      activeIncludedNodeIds.has(prereqId) &&
      activeIncludedNodeIds.has(depId)
    ) {
      const pairKey = `${prereqId}->${depId}`;
      if (!seenEdgePairs.has(pairKey)) {
        seenEdgePairs.add(pairKey);
        const resolvedRefIds = pEdge.sourceHandles
          .map((sh) => handleMap.get(sh) || sh)
          .filter(Boolean)
          .slice(0, 8);

        newProposedEdges.push({
          prerequisiteNodeId: prereqId,
          dependentNodeId: depId,
          support: pEdge.support,
          rationale: pEdge.rationale,
          sourceRefIds: resolvedRefIds,
        });
      }
    } else {
      droppedEdgesCount++;
    }
  }

  // 5. Kahn Topological Ordering and Cycle Pruning
  const includedForKahn = allNodesList.filter((n) => n.included);
  const previousPositions = new Map<string, number>();
  for (const n of baseNodes) {
    if (n.included && n.position >= 0) {
      previousPositions.set(n.nodeId, n.position);
    }
  }

  // Start with preserved base edges
  let currentEdges = [...preservedBaseEdges];
  const orderTest = orderStudyPlan(includedForKahn, currentEdges, previousPositions);
  if (!orderTest.ok) {
    currentEdges = [];
  }

  // Greedily add new proposed edges; drop any edge that creates a cycle
  for (const newEdge of newProposedEdges) {
    const testEdges = [...currentEdges, newEdge];
    const testResult = orderStudyPlan(includedForKahn, testEdges, previousPositions);
    if (testResult.ok) {
      currentEdges = testEdges;
    } else {
      droppedEdgesCount++;
    }
  }

  const finalPrereqs = currentEdges;

  // Final Kahn sequence
  const finalOrder = orderStudyPlan(includedForKahn, finalPrereqs, previousPositions);
  const orderedIncluded = finalOrder.ok ? finalOrder.value.orderedNodes : includedForKahn;

  const finalNodes: StudyPlanVersionNode[] = [
    ...orderedIncluded,
    ...allNodesList.filter((n) => !n.included),
  ];

  // 6. Compute PlanVersionDiff
  const diff: PlanVersionDiff = {
    addedNodeIds: [],
    removedNodeIds: [],
    modifiedNodeIds: [],
    reorderedNodeIds: [],
    addedPrerequisites: [],
    removedPrerequisites: [],
    lockConflicts: [],
  };

  const finalNodeMap = new Map<string, StudyPlanVersionNode>();
  for (const fn of finalNodes) {
    finalNodeMap.set(fn.nodeId, fn);
  }

  // Added nodes: in final as included, but wasn't in base (or wasn't included)
  for (const fn of finalNodes) {
    if (fn.included) {
      const baseNode = baseNodes.find((b) => b.nodeId === fn.nodeId);
      if (!baseNode || !baseNode.included) {
        diff.addedNodeIds.push(fn.nodeId);
      }
    }
  }

  // Removed nodes: in base as included, but now missing or included=false
  for (const bn of baseNodes) {
    if (bn.included) {
      const finalNode = finalNodeMap.get(bn.nodeId);
      if (!finalNode || !finalNode.included) {
        diff.removedNodeIds.push(bn.nodeId);
      }
    }
  }

  // Modified / Reordered nodes
  for (const fn of finalNodes) {
    if (fn.included) {
      const bn = baseNodes.find((b) => b.nodeId === fn.nodeId && b.included);
      if (bn) {
        const titleChanged = bn.title !== fn.title;
        const summaryChanged = bn.summary !== fn.summary;
        const objectivesChanged =
          JSON.stringify(bn.learningObjectives) !== JSON.stringify(fn.learningObjectives);
        const sourcesChanged =
          JSON.stringify(bn.sourceRefIds) !== JSON.stringify(fn.sourceRefIds);

        if (titleChanged || summaryChanged || objectivesChanged || sourcesChanged) {
          diff.modifiedNodeIds.push(fn.nodeId);
        }

        if (bn.position !== fn.position) {
          diff.reorderedNodeIds.push(fn.nodeId);

          if (bn.locked) {
            diff.lockConflicts.push({
              nodeId: fn.nodeId,
              previousPosition: bn.position,
              actualPosition: fn.position,
              reasonKey: 'lock_conflict_reordered_by_prerequisites',
            });
          }
        }
      }
    }
  }

  // Edge diffs
  const baseEdgeSet = new Set(
    basePrereqs.map((p) => `${p.prerequisiteNodeId}->${p.dependentNodeId}`)
  );
  const finalEdgeSet = new Set(
    finalPrereqs.map((p) => `${p.prerequisiteNodeId}->${p.dependentNodeId}`)
  );

  for (const fp of finalPrereqs) {
    const pair = `${fp.prerequisiteNodeId}->${fp.dependentNodeId}`;
    if (!baseEdgeSet.has(pair)) {
      diff.addedPrerequisites.push([fp.prerequisiteNodeId, fp.dependentNodeId]);
    }
  }

  for (const bp of basePrereqs) {
    const pair = `${bp.prerequisiteNodeId}->${bp.dependentNodeId}`;
    if (!finalEdgeSet.has(pair)) {
      diff.removedPrerequisites.push([bp.prerequisiteNodeId, bp.dependentNodeId]);
    }
  }

  return {
    nodes: finalNodes,
    prerequisites: finalPrereqs,
    diff,
    droppedEdgesCount,
  };
}
