/**
 * Competency-Based Adaptive Curricula Domain Engine (Phase 3A).
 *
 * Implements:
 * - 7-value typed conceptual relationship taxonomy with explicit DAG vs associative semantics.
 * - Deterministic graph validation (`CYCLE_DETECTED` strictly on active `requires` edges,
 *   duplicate edge detection, front-matter/TOC pseudo-prerequisite detection).
 * - Non-destructive adaptive progression overlay driven by verified 5D competency profiles
 *   (`demonstrated_prior`, `ready`, `advisory_blocked`, `completed`, `needs_grounding_repair`).
 * - Source-grounding verification and privacy-preserving recovery actions without fabrication.
 */

import type {
  CompetencyDimension,
  ConceptCompetencyProfile,
} from "../../types/learnerModel";

export const ALL_CONCEPT_RELATIONSHIP_TYPES = [
  "requires",
  "builds_upon",
  "related_to",
  "example_of",
  "contrasts_with",
  "applies",
  "alternative_explanation_of",
] as const;

export type ConceptRelationshipType =
  (typeof ALL_CONCEPT_RELATIONSHIP_TYPES)[number];

export interface ConceptRelationshipMetadata {
  type: ConceptRelationshipType;
  enforcesAcyclicity: boolean;
  affectsPrerequisiteGating: boolean;
  isSoftOrderingHint: boolean;
  isAssociative: boolean;
  description: string;
}

export const CONCEPT_RELATIONSHIP_METADATA: Readonly<
  Record<ConceptRelationshipType, ConceptRelationshipMetadata>
> = {
  requires: {
    type: "requires",
    enforcesAcyclicity: true,
    affectsPrerequisiteGating: true,
    isSoftOrderingHint: false,
    isAssociative: false,
    description: "Target requires prior understanding of source (hard DAG invariant).",
  },
  builds_upon: {
    type: "builds_upon",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: true,
    isAssociative: false,
    description: "Target deepens or extends source (advisory ordering hint).",
  },
  related_to: {
    type: "related_to",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: false,
    isAssociative: true,
    description: "Associative conceptual link between source and target.",
  },
  example_of: {
    type: "example_of",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: false,
    isAssociative: true,
    description: "Source is a concrete instance or case of target.",
  },
  contrasts_with: {
    type: "contrasts_with",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: false,
    isAssociative: true,
    description: "Source and target highlight key distinctions or misconceptions.",
  },
  applies: {
    type: "applies",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: false,
    isAssociative: true,
    description: "Source applies target in a practical or procedural context.",
  },
  alternative_explanation_of: {
    type: "alternative_explanation_of",
    enforcesAcyclicity: false,
    affectsPrerequisiteGating: false,
    isSoftOrderingHint: false,
    isAssociative: true,
    description: "Source explains target from another source, modality, or level.",
  },
};

export type ConceptEdgeProvenance =
  | "source_verified"
  | "user_authored"
  | "ai_inferred";

export interface ConceptRelationshipEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: ConceptRelationshipType;
  provenance: ConceptEdgeProvenance;
  /** Confidence score in [0.0, 1.0]. */
  confidence: number;
  uncertaintyNote?: string | null;
  isBypassed?: boolean;
  isRejected?: boolean;
  bypassReason?: string | null;
  sourceRefIds: string[];
}

export interface AdaptiveCurriculumNode {
  id: string;
  title: string;
  conceptIds: string[];
  position: number;
  completed?: boolean;
  /** Optional node-specific target dimensions (non-exposure dimensions only for skipping). */
  targetDimensions?: readonly CompetencyDimension[];
  isManuallySkipped?: boolean;
  isManuallyUnskipped?: boolean;
  isPinnedNext?: boolean;
  hasUnresolvedGrounding?: boolean;
}

export type CurriculumGraphIssueCode =
  | "CYCLE_DETECTED"
  | "DUPLICATE_EDGE"
  | "FRONT_MATTER_PREREQUISITE"
  | "UNKNOWN_NODE"
  | "SELF_LOOP";

export interface CurriculumGraphIssue {
  code: CurriculumGraphIssueCode;
  severity: "error" | "warning";
  message: string;
  edgeIds: string[];
  nodeIds: string[];
  cyclePath?: string[];
}

export interface CurriculumGraphValidationResult {
  valid: boolean;
  errors: CurriculumGraphIssue[];
  warnings: CurriculumGraphIssue[];
  issues: CurriculumGraphIssue[];
  cyclePaths: string[][];
  duplicateEdgeIds: string[];
  frontMatterNodeIds: string[];
  topologicalOrder: string[] | null;
}

export const DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_SKIP_TARGET_DIMENSIONS: readonly CompetencyDimension[] = [
  "comprehension",
  "retention",
];

const FRONT_MATTER_EXACT_PATTERN =
  /^(?:table\s+of\s+contents|contents|toc|preface|foreword|acknowledg(?:e)?ments?|dedication|copyright(?:\s+(?:page|notice|information))?|title\s+page|half\s+title|cover(?:\s+page)?|colophon|front\s*matter|back\s*matter|about\s+the\s+author(?:s)?|about\s+this\s+(?:book|guide|manual|edition)|list\s+of\s+(?:figures|tables|illustrations|abbreviations|symbols|examples|listings)|publisher(?:'s)?\s+note|credits|contributors|epigraph|errata|imprint|isbn|index|bibliography|references|glossary|notation(?:\s+and\s+conventions)?|how\s+to\s+use\s+this\s+book)$/i;

/**
 * Detects headings that represent front-matter, table-of-contents, or boilerplate
 * sections rather than substantive conceptual prerequisites.
 */
export function isLikelyFrontMatterHeading(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;

  // Strip optional leading numbering (e.g. "0.", "0.1 ", "Chapter 0:", "Part I -", "iv. ")
  const stripped = trimmed
    .replace(/^(?:(?:chapter|section|part)\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+)[\s.:)-]+/i, "")
    .replace(/[:.\-–—]+$/g, "")
    .trim();

  if (!stripped) return false;
  return FRONT_MATTER_EXACT_PATTERN.test(stripped);
}

/**
 * Validates a curriculum graph:
 * - Detects cycles ONLY in the active hard `"requires"` subgraph (`CYCLE_DETECTED` with cycle path).
 * - Permits cycles in associative / non-blocking edge types (`related_to`, `contrasts_with`, etc.).
 * - Flags duplicate `(sourceNodeId, targetNodeId, relationshipType)` edges.
 * - Flags front-matter / TOC pseudo-prerequisites on `requires` edges.
 */
export function validateCurriculumGraph(
  nodes: readonly AdaptiveCurriculumNode[],
  edges: readonly ConceptRelationshipEdge[],
): CurriculumGraphValidationResult {
  const errors: CurriculumGraphIssue[] = [];
  const warnings: CurriculumGraphIssue[] = [];
  const nodeMap = new Map<string, AdaptiveCurriculumNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const activeEdges = edges.filter((edge) => !edge.isRejected);
  const duplicateEdgeIds: string[] = [];
  const frontMatterNodeIdSet = new Set<string>();
  const seenEdgeKeys = new Map<string, string>();

  // 1. Endpoint checks, duplicate checks, front-matter checks
  for (const edge of activeEdges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    const targetNode = nodeMap.get(edge.targetNodeId);

    if (!sourceNode || !targetNode) {
      const missing: string[] = [];
      if (!sourceNode) missing.push(edge.sourceNodeId);
      if (!targetNode) missing.push(edge.targetNodeId);
      errors.push({
        code: "UNKNOWN_NODE",
        severity: "error",
        message: `Edge "${edge.id}" references unknown node(s): ${missing.join(", ")}`,
        edgeIds: [edge.id],
        nodeIds: missing,
      });
      continue;
    }

    const dupKey = `${edge.sourceNodeId}::${edge.targetNodeId}::${edge.relationshipType}`;
    const firstId = seenEdgeKeys.get(dupKey);
    if (firstId !== undefined) {
      duplicateEdgeIds.push(edge.id);
      warnings.push({
        code: "DUPLICATE_EDGE",
        severity: "warning",
        message: `Duplicate "${edge.relationshipType}" edge from "${edge.sourceNodeId}" to "${edge.targetNodeId}" (duplicates "${firstId}").`,
        edgeIds: [firstId, edge.id],
        nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      });
    } else {
      seenEdgeKeys.set(dupKey, edge.id);
    }

    if (edge.sourceNodeId === edge.targetNodeId) {
      if (edge.relationshipType === "requires") {
        errors.push({
          code: "CYCLE_DETECTED",
          severity: "error",
          message: `Self-referential "requires" cycle detected on node "${edge.sourceNodeId}".`,
          edgeIds: [edge.id],
          nodeIds: [edge.sourceNodeId],
          cyclePath: [edge.sourceNodeId, edge.sourceNodeId],
        });
      } else {
        warnings.push({
          code: "SELF_LOOP",
          severity: "warning",
          message: `Self-loop on non-blocking "${edge.relationshipType}" edge "${edge.id}".`,
          edgeIds: [edge.id],
          nodeIds: [edge.sourceNodeId],
        });
      }
    }

    if (
      edge.relationshipType === "requires" &&
      isLikelyFrontMatterHeading(sourceNode.title)
    ) {
      frontMatterNodeIdSet.add(sourceNode.id);
      warnings.push({
        code: "FRONT_MATTER_PREREQUISITE",
        severity: "warning",
        message: `Node "${sourceNode.title}" (${sourceNode.id}) appears to be front-matter/TOC and should not be a hard prerequisite for "${targetNode.title}".`,
        edgeIds: [edge.id],
        nodeIds: [sourceNode.id, targetNode.id],
      });
    }
  }

  // 2. Hard cycle detection strictly on active `requires` subgraph (excluding self-loops already reported)
  const requiresAdj = new Map<string, ConceptRelationshipEdge[]>();
  const sortedNodeIds = [...nodeMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const id of sortedNodeIds) {
    requiresAdj.set(id, []);
  }

  for (const edge of activeEdges) {
    if (edge.relationshipType !== "requires") continue;
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) continue;
    requiresAdj.get(edge.sourceNodeId)!.push(edge);
  }

  for (const list of requiresAdj.values()) {
    list.sort((a, b) => {
      const targetCmp = a.targetNodeId.localeCompare(b.targetNodeId);
      if (targetCmp !== 0) return targetCmp;
      return a.id.localeCompare(b.id);
    });
  }

  // 0 = unvisited, 1 = visiting (on stack), 2 = visited
  const visitState = new Map<string, 0 | 1 | 2>();
  const stackNodes: string[] = [];
  const stackEdges: string[] = [];
  const reportedCycleKeys = new Set<string>();
  const cyclePaths: string[][] = [];

  for (const err of errors) {
    if (err.code === "CYCLE_DETECTED" && err.cyclePath) {
      cyclePaths.push(err.cyclePath);
    }
  }

  function dfs(nodeId: string): void {
    visitState.set(nodeId, 1);
    stackNodes.push(nodeId);

    const outgoing = requiresAdj.get(nodeId) ?? [];
    for (const edge of outgoing) {
      const next = edge.targetNodeId;
      const state = visitState.get(next) ?? 0;

      if (state === 1) {
        const startIdx = stackNodes.indexOf(next);
        const rawCycle = [...stackNodes.slice(startIdx), next];
        const cycleEdgeIds = [...stackEdges.slice(startIdx), edge.id];

        // Canonicalize cycle key to avoid duplicate reporting of the same loop
        const cycleBody = rawCycle.slice(0, -1);
        let minIdx = 0;
        for (let i = 1; i < cycleBody.length; i += 1) {
          if (cycleBody[i].localeCompare(cycleBody[minIdx]) < 0) {
            minIdx = i;
          }
        }
        const canonicalBody = [
          ...cycleBody.slice(minIdx),
          ...cycleBody.slice(0, minIdx),
        ];
        const canonicalKey = canonicalBody.join("->");

        if (!reportedCycleKeys.has(canonicalKey)) {
          reportedCycleKeys.add(canonicalKey);
          const canonicalPath = [...canonicalBody, canonicalBody[0]];
          cyclePaths.push(canonicalPath);
          errors.push({
            code: "CYCLE_DETECTED",
            severity: "error",
            message: `Cycle detected in "requires" subgraph: ${canonicalPath.join(" -> ")}`,
            edgeIds: cycleEdgeIds,
            nodeIds: canonicalBody,
            cyclePath: canonicalPath,
          });
        }
      } else if (state === 0) {
        stackEdges.push(edge.id);
        dfs(next);
        stackEdges.pop();
      }
    }

    stackNodes.pop();
    visitState.set(nodeId, 2);
  }

  for (const nodeId of sortedNodeIds) {
    if ((visitState.get(nodeId) ?? 0) === 0) {
      dfs(nodeId);
    }
  }

  const hasCycle = cyclePaths.length > 0;
  const topologicalOrder = hasCycle
    ? null
    : computeDeterministicTopologicalOrder(nodes, activeEdges);

  const issues = [...errors, ...warnings];
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
    cyclePaths,
    duplicateEdgeIds,
    frontMatterNodeIds: [...frontMatterNodeIdSet].sort((a, b) => a.localeCompare(b)),
    topologicalOrder,
  };
}

/**
 * Deterministic Kahn topological ordering over `requires` edges, using `builds_upon`
 * in-degree as a soft secondary tie-breaker, then `(position, id)`.
 */
function computeDeterministicTopologicalOrder(
  nodes: readonly AdaptiveCurriculumNode[],
  activeEdges: readonly ConceptRelationshipEdge[],
): string[] {
  const nodeMap = new Map<string, AdaptiveCurriculumNode>();
  const inDegree = new Map<string, number>();
  const buildsUponInDegree = new Map<string, number>();
  const requiresOutgoing = new Map<string, string[]>();
  const buildsUponOutgoing = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    buildsUponInDegree.set(node.id, 0);
    requiresOutgoing.set(node.id, []);
    buildsUponOutgoing.set(node.id, []);
  }

  const seenReqPairs = new Set<string>();
  const seenBuildsPairs = new Set<string>();

  for (const edge of activeEdges) {
    if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) continue;
    if (edge.sourceNodeId === edge.targetNodeId) continue;

    if (edge.relationshipType === "requires") {
      const key = `${edge.sourceNodeId}->${edge.targetNodeId}`;
      if (!seenReqPairs.has(key)) {
        seenReqPairs.add(key);
        requiresOutgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
        inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
      }
    } else if (edge.relationshipType === "builds_upon") {
      const key = `${edge.sourceNodeId}->${edge.targetNodeId}`;
      if (!seenBuildsPairs.has(key)) {
        seenBuildsPairs.add(key);
        buildsUponOutgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
        buildsUponInDegree.set(
          edge.targetNodeId,
          (buildsUponInDegree.get(edge.targetNodeId) ?? 0) + 1,
        );
      }
    }
  }

  const ready: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) ready.push(id);
  }

  const compareReady = (aId: string, bId: string): number => {
    const aBuilds = buildsUponInDegree.get(aId) ?? 0;
    const bBuilds = buildsUponInDegree.get(bId) ?? 0;
    if (aBuilds !== bBuilds) return aBuilds - bBuilds;
    const aNode = nodeMap.get(aId)!;
    const bNode = nodeMap.get(bId)!;
    if (aNode.position !== bNode.position) return aNode.position - bNode.position;
    return aId.localeCompare(bId);
  };

  const ordered: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareReady);
    const current = ready.shift()!;
    ordered.push(current);

    for (const next of requiresOutgoing.get(current) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) {
        ready.push(next);
      }
    }
    for (const next of buildsUponOutgoing.get(current) ?? []) {
      buildsUponInDegree.set(
        next,
        Math.max(0, (buildsUponInDegree.get(next) ?? 0) - 1),
      );
    }
  }

  return ordered;
}

export type AdaptiveNodeStatus =
  | "completed"
  | "demonstrated_prior"
  | "ready"
  | "advisory_blocked"
  | "needs_grounding_repair";

export interface AdaptiveProgressionOptions {
  /**
   * Target non-exposure dimensions required to classify a node as `demonstrated_prior`.
   * Defaults to `["comprehension", "retention"]`.
   * Note: `"exposure"` is stripped and can NEVER trigger `demonstrated_prior` alone.
   */
  targetDimensions?: readonly CompetencyDimension[];
  /**
   * Confidence threshold below which `ai_inferred` `requires` edges are treated as
   * uncertain and non-blocking (default: `0.7`).
   */
  aiConfidenceThreshold?: number;
}

export interface AdaptiveNodeProgressionState {
  nodeId: string;
  title: string;
  conceptIds: string[];
  status: AdaptiveNodeStatus;
  /** True when the node is preserved non-destructively and can be skipped due to prior mastery. */
  skippable: boolean;
  /** Always true: prior-demonstrated and completed nodes remain reviewable. */
  reviewable: boolean;
  /** True when `advisory_blocked` — Plethora NEVER permanently locks out a node. */
  canBypass: boolean;
  blockingEdgeIds: string[];
  unmetPrerequisiteNodeIds: string[];
  bypassedEdgeIds: string[];
  uncertainEdgeIds: string[];
  softWarnings: string[];
  demonstratedDimensions: CompetencyDimension[];
}

export interface AdaptivePathwayRecommendation {
  kind:
    | "recommended_next"
    | "alternative_explanation"
    | "bypass_advisory_prerequisite"
    | "parallel_ready_branch";
  targetNodeId: string;
  relatedNodeIds: string[];
  edgeIds: string[];
  reason: string;
}

export interface AdaptiveProgressionResult {
  nodeStates: Record<string, AdaptiveNodeProgressionState>;
  orderedNodeIds: string[];
  recommendedNextNodeIds: string[];
  skippedPriorNodeIds: string[];
  alternativePathways: AdaptivePathwayRecommendation[];
}

function lookupProfile(
  profiles:
    | ReadonlyMap<string, ConceptCompetencyProfile>
    | Readonly<Record<string, ConceptCompetencyProfile>>,
  conceptId: string,
): ConceptCompetencyProfile | undefined {
  if (profiles instanceof Map) {
    return profiles.get(conceptId);
  }
  return (profiles as Readonly<Record<string, ConceptCompetencyProfile>>)[conceptId];
}

/**
 * Evaluates whether a node's linked concepts are already `demonstrated` on the
 * required non-exposure target dimensions.
 *
 * Epistemic guardrails:
 * - NEVER skips based on `exposure` alone.
 * - NEVER skips based on `selfDeclaration` or unverified evidence.
 * - Requires at least one linked concept and verified `status === "demonstrated"`
 *   with `rawEvidenceCount > 0` and `evidenceIds.length > 0`.
 */
function evaluateDemonstratedPrior(
  node: AdaptiveCurriculumNode,
  profiles:
    | ReadonlyMap<string, ConceptCompetencyProfile>
    | Readonly<Record<string, ConceptCompetencyProfile>>,
  defaultTargetDimensions: readonly CompetencyDimension[],
): { isDemonstrated: boolean; demonstratedDimensions: CompetencyDimension[] } {
  if (node.conceptIds.length === 0) {
    return { isDemonstrated: false, demonstratedDimensions: [] };
  }

  const rawDims = node.targetDimensions ?? defaultTargetDimensions;
  // Strictly strip `exposure` — exposure alone can NEVER skip a curriculum node
  const nonExposureDims = rawDims.filter((d) => d !== "exposure");
  const effectiveDims =
    nonExposureDims.length > 0 ? nonExposureDims : DEFAULT_SKIP_TARGET_DIMENSIONS;

  const demonstratedSet = new Set<CompetencyDimension>();

  for (const conceptId of node.conceptIds) {
    const profile = lookupProfile(profiles, conceptId);
    if (!profile) {
      return { isDemonstrated: false, demonstratedDimensions: [] };
    }

    for (const dim of effectiveDims) {
      const projection = profile.dimensions[dim];
      const hasVerifiedDemonstrated =
        projection !== undefined &&
        projection.status === "demonstrated" &&
        projection.rawEvidenceCount > 0 &&
        projection.evidenceIds.length > 0 &&
        projection.estimate !== null &&
        projection.estimate >= 0.8;

      if (!hasVerifiedDemonstrated) {
        return { isDemonstrated: false, demonstratedDimensions: [] };
      }
      demonstratedSet.add(dim);
    }
  }

  return {
    isDemonstrated: true,
    demonstratedDimensions: [...demonstratedSet],
  };
}

/**
 * Computes non-destructive adaptive progression over a curriculum graph using
 * verified 5D competency profiles and optional learner bypasses.
 */
export function computeAdaptiveProgression(
  nodes: readonly AdaptiveCurriculumNode[],
  edges: readonly ConceptRelationshipEdge[],
  competencyProfiles:
    | ReadonlyMap<string, ConceptCompetencyProfile>
    | Readonly<Record<string, ConceptCompetencyProfile>>,
  bypassedEdgeIds?: ReadonlySet<string> | readonly string[],
  options?: AdaptiveProgressionOptions,
): AdaptiveProgressionResult {
  const aiConfidenceThreshold =
    options?.aiConfidenceThreshold ?? DEFAULT_AI_CONFIDENCE_THRESHOLD;
  const defaultTargetDims =
    options?.targetDimensions ?? DEFAULT_SKIP_TARGET_DIMENSIONS;

  const bypassedSet = new Set<string>(bypassedEdgeIds ?? []);
  const activeEdges = edges.filter((e) => !e.isRejected);
  const nodeMap = new Map<string, AdaptiveCurriculumNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const validation = validateCurriculumGraph(nodes, activeEdges);
  const orderedNodeIds =
    validation.topologicalOrder ??
    [...nodes]
      .sort((a, b) =>
        a.position !== b.position ? a.position - b.position : a.id.localeCompare(b.id),
      )
      .map((n) => n.id);

  // First pass: determine completion and `demonstrated_prior` status per node
  const priorEvaluation = new Map<
    string,
    { isDemonstrated: boolean; demonstratedDimensions: CompetencyDimension[] }
  >();
  const satisfiedAsPrereq = new Set<string>();

  for (const node of nodes) {
    const evalResult = evaluateDemonstratedPrior(
      node,
      competencyProfiles,
      defaultTargetDims,
    );
    priorEvaluation.set(node.id, evalResult);

    if (
      node.completed ||
      node.isManuallySkipped ||
      (!node.isManuallyUnskipped && evalResult.isDemonstrated)
    ) {
      satisfiedAsPrereq.add(node.id);
    }
  }

  // Group incoming `requires` edges per target node
  const incomingRequires = new Map<string, ConceptRelationshipEdge[]>();
  for (const edge of activeEdges) {
    if (edge.relationshipType !== "requires") continue;
    if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) continue;
    const list = incomingRequires.get(edge.targetNodeId) ?? [];
    list.push(edge);
    incomingRequires.set(edge.targetNodeId, list);
  }

  // Second pass: compute node states
  const nodeStates: Record<string, AdaptiveNodeProgressionState> = {};
  const skippedPriorNodeIds: string[] = [];

  for (const nodeId of orderedNodeIds) {
    const node = nodeMap.get(nodeId)!;
    const prior = priorEvaluation.get(nodeId)!;
    const reqEdges = incomingRequires.get(nodeId) ?? [];

    const blockingEdgeIds: string[] = [];
    const unmetPrerequisiteNodeIds: string[] = [];
    const nodeBypassedEdgeIds: string[] = [];
    const uncertainEdgeIds: string[] = [];
    const softWarnings: string[] = [];

    for (const edge of reqEdges) {
      if (satisfiedAsPrereq.has(edge.sourceNodeId)) {
        continue;
      }

      const sourceNode = nodeMap.get(edge.sourceNodeId)!;
      const isEdgeBypassed = Boolean(edge.isBypassed) || bypassedSet.has(edge.id);
      const isUncertainAi =
        edge.provenance === "ai_inferred" &&
        edge.confidence < aiConfidenceThreshold;
      const isFrontMatter = isLikelyFrontMatterHeading(sourceNode.title);

      if (isEdgeBypassed) {
        nodeBypassedEdgeIds.push(edge.id);
        softWarnings.push(
          `Prerequisite "${sourceNode.title}" was bypassed by learner${edge.bypassReason ? ` (${edge.bypassReason})` : ""}.`,
        );
      } else if (isUncertainAi) {
        uncertainEdgeIds.push(edge.id);
        const noteSuffix = edge.uncertaintyNote ? ` — ${edge.uncertaintyNote}` : "";
        softWarnings.push(
          `Uncertain AI-inferred prerequisite "${sourceNode.title}" (confidence ${edge.confidence.toFixed(2)} < ${aiConfidenceThreshold.toFixed(2)}) is non-blocking${noteSuffix}.`,
        );
      } else if (isFrontMatter) {
        uncertainEdgeIds.push(edge.id);
        softWarnings.push(
          `Front-matter heading "${sourceNode.title}" is ignored as a hard prerequisite.`,
        );
      } else {
        blockingEdgeIds.push(edge.id);
        unmetPrerequisiteNodeIds.push(edge.sourceNodeId);
      }
    }

    let status: AdaptiveNodeStatus;
    let skippable = false;

    if (node.completed) {
      status = "completed";
    } else if (node.hasUnresolvedGrounding) {
      status = "needs_grounding_repair";
    } else if (!node.isManuallyUnskipped && prior.isDemonstrated) {
      status = "demonstrated_prior";
      skippable = true;
      skippedPriorNodeIds.push(node.id);
    } else if (blockingEdgeIds.length > 0) {
      status = "advisory_blocked";
    } else {
      status = "ready";
    }

    nodeStates[node.id] = {
      nodeId: node.id,
      title: node.title,
      conceptIds: [...node.conceptIds],
      status,
      skippable,
      reviewable: true,
      canBypass: status === "advisory_blocked",
      blockingEdgeIds,
      unmetPrerequisiteNodeIds,
      bypassedEdgeIds: nodeBypassedEdgeIds,
      uncertainEdgeIds,
      softWarnings,
      demonstratedDimensions: prior.demonstratedDimensions,
    };
  }

  // Optimal next ready node(s): pinned first, then topological order
  const readyNodes = orderedNodeIds
    .filter((id) => nodeStates[id].status === "ready")
    .sort((aId, bId) => {
      const aPinned = nodeMap.get(aId)?.isPinnedNext ? 0 : 1;
      const bPinned = nodeMap.get(bId)?.isPinnedNext ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      return orderedNodeIds.indexOf(aId) - orderedNodeIds.indexOf(bId);
    });

  const recommendedNextNodeIds = readyNodes.slice(0, 3);
  const alternativePathways: AdaptivePathwayRecommendation[] = [];

  if (recommendedNextNodeIds.length > 0) {
    alternativePathways.push({
      kind: "recommended_next",
      targetNodeId: recommendedNextNodeIds[0],
      relatedNodeIds: recommendedNextNodeIds.slice(1),
      edgeIds: [],
      reason: `Next optimal ready node in adaptive progression.`,
    });
  }

  // Surface parallel ready branches
  for (const parallelId of recommendedNextNodeIds.slice(1)) {
    alternativePathways.push({
      kind: "parallel_ready_branch",
      targetNodeId: parallelId,
      relatedNodeIds: [recommendedNextNodeIds[0]],
      edgeIds: [],
      reason: `Independent ready branch "${nodeStates[parallelId].title}" can be studied in parallel.`,
    });
  }

  // Surface alternative explanation pathways and bypass options for advisory-blocked nodes
  for (const edge of activeEdges) {
    if (
      edge.relationshipType === "alternative_explanation_of" &&
      nodeMap.has(edge.sourceNodeId) &&
      nodeMap.has(edge.targetNodeId)
    ) {
      const targetState = nodeStates[edge.targetNodeId];
      if (
        targetState &&
        targetState.status !== "completed" &&
        targetState.status !== "demonstrated_prior"
      ) {
        alternativePathways.push({
          kind: "alternative_explanation",
          targetNodeId: edge.sourceNodeId,
          relatedNodeIds: [edge.targetNodeId],
          edgeIds: [edge.id],
          reason: `"${nodeMap.get(edge.sourceNodeId)!.title}" provides an alternative explanation of "${targetState.title}".`,
        });
      }
    }
  }

  for (const nodeId of orderedNodeIds) {
    const state = nodeStates[nodeId];
    if (state.status === "advisory_blocked") {
      alternativePathways.push({
        kind: "bypass_advisory_prerequisite",
        targetNodeId: nodeId,
        relatedNodeIds: state.unmetPrerequisiteNodeIds,
        edgeIds: state.blockingEdgeIds,
        reason: `"${state.title}" has advisory prerequisite(s) that can be bypassed if you already know the material.`,
      });
    }
  }

  return {
    nodeStates,
    orderedNodeIds,
    recommendedNextNodeIds,
    skippedPriorNodeIds,
    alternativePathways,
  };
}

// ============================================================================
// Source-Grounding Verification & Recovery
// ============================================================================

export type SourceLocatorType = "page" | "timestamp" | "passage" | "section";

export interface SourceGroundingAnchor {
  sourceId: string;
  locatorType: SourceLocatorType;
  pageNumber?: number;
  timestampSeconds?: number;
  passageText?: string;
  passageFingerprint?: string;
  sectionId?: string;
}

export interface AvailableSourcePassage {
  id: string;
  text: string;
  fingerprint?: string;
  pageNumber?: number;
  timestampSeconds?: number;
}

export interface AvailableSourceRecord {
  id: string;
  title: string;
  exists: boolean;
  isIndexed?: boolean;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  pageCount?: number;
  durationSeconds?: number;
  sections?: readonly string[];
  passages?: readonly AvailableSourcePassage[];
  alternativeSourceIds?: readonly string[];
}

export interface GroundingVerificationPolicy {
  /** Whether the caller would like to use cloud AI re-anchoring if local matching fails. */
  allowCloudFallback?: boolean;
  /** Minimum deterministic token-overlap similarity [0, 1] for local fuzzy re-anchoring (default 0.75). */
  fuzzyMatchThreshold?: number;
}

export type GroundingRecoveryAction =
  | "reindex_source"
  | "switch_to_local_only"
  | "select_alternative_passage"
  | "mark_ungrounded_manual";

export type GroundingVerificationStatus =
  | "verified"
  | "reanchored"
  | "missing_source"
  | "source_not_indexed"
  | "anchor_drifted"
  | "privacy_restricted";

export interface SourceGroundingVerificationResult {
  status: GroundingVerificationStatus;
  isGrounded: boolean;
  /** Explicitly guarantees Plethora never fabricates grounding on failure. */
  fabricated: false;
  cloudAiAllowed: boolean;
  verificationMode: "local_only" | "standard";
  sourceId: string;
  matchedPassageId?: string;
  similarityScore?: number;
  reason: string;
  recoveryActions: GroundingRecoveryAction[];
}

function tokenizeForSimilarity(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .trim();
  if (!normalized) return new Set();
  return new Set(normalized.split(/\s+/).filter((token) => token.length > 0));
}

function computeJaccardSimilarity(a: string, b: string): number {
  const setA = tokenizeForSimilarity(a);
  const setB = tokenizeForSimilarity(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Verifies that a curriculum node's source grounding anchor (page, timestamp,
 * section, or passage) resolves to an existing source while strictly enforcing
 * `isLocalOnly` / `isAiExcluded` privacy boundaries.
 *
 * Never fabricates grounding; returns structured recovery actions on failure.
 */
export function verifySourceGrounding(
  anchor: SourceGroundingAnchor,
  availableSources: readonly AvailableSourceRecord[],
  policy?: GroundingVerificationPolicy,
): SourceGroundingVerificationResult {
  const fuzzyThreshold = policy?.fuzzyMatchThreshold ?? 0.75;
  const requestedCloud = Boolean(policy?.allowCloudFallback);

  const source = availableSources.find((s) => s.id === anchor.sourceId);

  if (!source || !source.exists) {
    const hasAlternatives = availableSources.some(
      (s) => s.exists && s.id !== anchor.sourceId,
    );
    const recoveryActions: GroundingRecoveryAction[] = [];
    if (hasAlternatives) {
      recoveryActions.push("select_alternative_passage");
    }
    recoveryActions.push("mark_ungrounded_manual");

    return {
      status: "missing_source",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed: false,
      verificationMode: "local_only",
      sourceId: anchor.sourceId,
      reason: `Source "${anchor.sourceId}" is missing or unavailable.`,
      recoveryActions,
    };
  }

  const isPrivacyRestricted = source.isLocalOnly || source.isAiExcluded;
  const cloudAiAllowed = requestedCloud && !isPrivacyRestricted;
  const verificationMode: "local_only" | "standard" = isPrivacyRestricted
    ? "local_only"
    : "standard";

  // If the caller requested cloud fallback on a local-only or AI-excluded document,
  // strictly enforce local-only verification and surface `switch_to_local_only` if
  // verification cannot succeed locally.
  const appendPrivacyRecovery = (
    actions: GroundingRecoveryAction[],
  ): GroundingRecoveryAction[] => {
    if (isPrivacyRestricted && requestedCloud && !actions.includes("switch_to_local_only")) {
      return ["switch_to_local_only", ...actions];
    }
    return actions;
  };

  if (source.isIndexed === false) {
    return {
      status: "source_not_indexed",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed,
      verificationMode,
      sourceId: source.id,
      reason: `Source "${source.title}" is not indexed; passage/locator verification cannot complete.`,
      recoveryActions: appendPrivacyRecovery([
        "reindex_source",
        "mark_ungrounded_manual",
      ]),
    };
  }

  // Locator verification by type
  if (anchor.locatorType === "page") {
    const page = anchor.pageNumber;
    const valid =
      typeof page === "number" &&
      Number.isInteger(page) &&
      page >= 1 &&
      typeof source.pageCount === "number" &&
      page <= source.pageCount;

    if (valid) {
      return {
        status: "verified",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        reason: `Verified page ${page} of ${source.pageCount} in "${source.title}".`,
        recoveryActions: [],
      };
    }

    const actions: GroundingRecoveryAction[] = [
      "reindex_source",
      "select_alternative_passage",
      "mark_ungrounded_manual",
    ];
    return {
      status: isPrivacyRestricted && requestedCloud ? "privacy_restricted" : "anchor_drifted",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed,
      verificationMode,
      sourceId: source.id,
      reason: `Page anchor (${String(page)}) is out of bounds for "${source.title}" (pageCount=${String(source.pageCount ?? "unknown")}).`,
      recoveryActions: appendPrivacyRecovery(actions),
    };
  }

  if (anchor.locatorType === "timestamp") {
    const ts = anchor.timestampSeconds;
    const valid =
      typeof ts === "number" &&
      Number.isFinite(ts) &&
      ts >= 0 &&
      typeof source.durationSeconds === "number" &&
      ts <= source.durationSeconds;

    if (valid) {
      return {
        status: "verified",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        reason: `Verified timestamp ${ts}s within ${source.durationSeconds}s duration of "${source.title}".`,
        recoveryActions: [],
      };
    }

    const actions: GroundingRecoveryAction[] = [
      "reindex_source",
      "select_alternative_passage",
      "mark_ungrounded_manual",
    ];
    return {
      status: isPrivacyRestricted && requestedCloud ? "privacy_restricted" : "anchor_drifted",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed,
      verificationMode,
      sourceId: source.id,
      reason: `Timestamp anchor (${String(ts)}s) is out of bounds for "${source.title}" (duration=${String(source.durationSeconds ?? "unknown")}s).`,
      recoveryActions: appendPrivacyRecovery(actions),
    };
  }

  if (anchor.locatorType === "section") {
    const valid =
      typeof anchor.sectionId === "string" &&
      Array.isArray(source.sections) &&
      source.sections.includes(anchor.sectionId);

    if (valid) {
      return {
        status: "verified",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        reason: `Verified section "${anchor.sectionId}" in "${source.title}".`,
        recoveryActions: [],
      };
    }

    const actions: GroundingRecoveryAction[] = [
      "reindex_source",
      "select_alternative_passage",
      "mark_ungrounded_manual",
    ];
    return {
      status: isPrivacyRestricted && requestedCloud ? "privacy_restricted" : "anchor_drifted",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed,
      verificationMode,
      sourceId: source.id,
      reason: `Section "${String(anchor.sectionId)}" was not found in "${source.title}".`,
      recoveryActions: appendPrivacyRecovery(actions),
    };
  }

  // Passage locator: exact fingerprint / text match, then local deterministic fuzzy re-anchoring
  const passages = source.passages ?? [];
  if (passages.length === 0) {
    return {
      status: "source_not_indexed",
      isGrounded: false,
      fabricated: false,
      cloudAiAllowed,
      verificationMode,
      sourceId: source.id,
      reason: `No indexed passages available in "${source.title}" to verify anchor.`,
      recoveryActions: appendPrivacyRecovery([
        "reindex_source",
        "mark_ungrounded_manual",
      ]),
    };
  }

  // Exact fingerprint match
  if (anchor.passageFingerprint) {
    const exactFp = passages.find(
      (p) => p.fingerprint && p.fingerprint === anchor.passageFingerprint,
    );
    if (exactFp) {
      return {
        status: "verified",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        matchedPassageId: exactFp.id,
        similarityScore: 1.0,
        reason: `Verified exact passage fingerprint match in "${source.title}".`,
        recoveryActions: [],
      };
    }
  }

  // Exact substring or fuzzy local deterministic match on passageText
  if (anchor.passageText && anchor.passageText.trim().length > 0) {
    const needle = anchor.passageText.trim().toLowerCase();
    const exactText = passages.find((p) => p.text.toLowerCase().includes(needle));
    if (exactText) {
      return {
        status: "verified",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        matchedPassageId: exactText.id,
        similarityScore: 1.0,
        reason: `Verified exact passage text match in "${source.title}".`,
        recoveryActions: [],
      };
    }

    let bestPassage: AvailableSourcePassage | null = null;
    let bestScore = 0;
    for (const candidate of passages) {
      const score = computeJaccardSimilarity(anchor.passageText, candidate.text);
      if (score > bestScore) {
        bestScore = score;
        bestPassage = candidate;
      }
    }

    if (bestPassage && bestScore >= fuzzyThreshold) {
      return {
        status: "reanchored",
        isGrounded: true,
        fabricated: false,
        cloudAiAllowed,
        verificationMode,
        sourceId: source.id,
        matchedPassageId: bestPassage.id,
        similarityScore: bestScore,
        reason: `Locally re-anchored drifted passage in "${source.title}" (similarity ${bestScore.toFixed(2)}).`,
        recoveryActions: [],
      };
    }
  }

  const recoveryActions: GroundingRecoveryAction[] = [
    "reindex_source",
    "select_alternative_passage",
    "mark_ungrounded_manual",
  ];
  return {
    status: isPrivacyRestricted && requestedCloud ? "privacy_restricted" : "anchor_drifted",
    isGrounded: false,
    fabricated: false,
    cloudAiAllowed,
    verificationMode,
    sourceId: source.id,
    reason: isPrivacyRestricted && requestedCloud
      ? `Passage anchor drifted in privacy-restricted source "${source.title}"; cloud fallback is blocked.`
      : `Passage anchor could not be verified in "${source.title}".`,
    recoveryActions: appendPrivacyRecovery(recoveryActions),
  };
}
