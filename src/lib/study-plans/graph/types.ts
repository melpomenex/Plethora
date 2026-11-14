import type {
  MaterialSupport,
  NodeActivity,
  PlanPrerequisite,
  StudyPlanKnowledgeAuthority,
  StudyPlanVersionNode,
} from '../../../types/learningPaths';
import type { MasteryEvidenceLevel, NodeLearningProgress, KnowledgeGapView } from '../../../types/learningEvidence';
import type { StudySourceResolution } from '../../../types/studySource';

export type GraphOrientation = 'TB' | 'LR';
export type GraphViewLayer = 'curriculum' | 'prerequisites' | 'sources';
export type PrerequisiteSupportFilter = 'all' | PlanPrerequisite['support'];

export type GraphHighlightMode =
  | { kind: 'none' }
  | { kind: 'prerequisites'; nodeId: string }
  | { kind: 'dependents'; nodeId: string }
  | { kind: 'next-topic'; nodeId: string }
  | { kind: 'source'; sourceNodeId: string };

export type PrerequisiteReadiness = 'entry' | 'ready' | 'incomplete-prerequisites';

export type SourceHealthStatus =
  | 'current'
  | 'stale'
  | 'missing'
  | 'ambiguous'
  | 'unsupported'
  | 'unverified'
  | 'none';

export interface NodeSourceSummary {
  totalCount: number;
  currentCount: number;
  staleCount: number;
  missingCount: number;
  ambiguousCount: number;
  unsupportedCount: number;
  unverifiedCount: number;
  primaryStatus: SourceHealthStatus;
}

export interface StudyPlanGraphNode {
  nodeId: string;
  title: string;
  summary: string;
  conceptId: string | null;
  conceptLabel: string;
  curriculumNumber: number; // 1-indexed for included nodes, -1 for excluded
  position: number;
  included: boolean;
  locked: boolean; // Authoring lock — distinct from prerequisite readiness
  userAdded: boolean;
  userModified: boolean;
  activity: NodeActivity;
  prerequisiteReadiness: PrerequisiteReadiness;
  incompletePrerequisiteCount: number;
  directPrerequisiteIds: string[];
  directDependentIds: string[];
  materialSupport: MaterialSupport;
  whyHere: string | null;
  learningObjectives: string[];
  sourceRefIds: string[];
  sourceSummary: NodeSourceSummary;
  demonstratedLevel: MasteryEvidenceLevel | null;
  activeGapCount: number;
  isRecommendedNext: boolean;
}

export type EdgeDiagnosticCode =
  | 'self_edge'
  | 'duplicate_edge'
  | 'dangling_prerequisite'
  | 'excluded_endpoint';

export interface StudyPlanGraphEdge {
  id: string;
  prerequisiteNodeId: string;
  dependentNodeId: string;
  support: PlanPrerequisite['support'];
  rationale: string | null;
  sourceRefIds: string[];
  isValid: boolean;
  diagnosticCode?: EdgeDiagnosticCode;
}

export interface StudyPlanSourceGraphNode {
  id: string;
  documentId: string | null;
  title: string;
  kind: string;
  status: Exclude<SourceHealthStatus, 'none'>;
  refIds: string[];
  linkedNodeIds: string[];
}

export interface StudyPlanSourceGraphEdge {
  id: string;
  sourceNodeId: string;
  topicNodeId: string;
  refIds: string[];
  status: Exclude<SourceHealthStatus, 'none'>;
}

export interface GraphDiagnostic {
  code: string;
  message: string;
  nodeIds?: string[];
  edgeId?: string;
}

export interface StudyPlanGraphProjection {
  nodes: StudyPlanGraphNode[];
  edges: StudyPlanGraphEdge[];
  invalidEdges: StudyPlanGraphEdge[];
  sourceNodes: StudyPlanSourceGraphNode[];
  sourceEdges: StudyPlanSourceGraphEdge[];
  hasPrerequisites: boolean;
  recommendedNextNodeId: string | null;
  knowledgeAuthorityKind: StudyPlanKnowledgeAuthority['kind'];
  statusCounts: Record<NodeActivity, number>;
  lockedCount: number;
  staleOrMissingSourceNodeCount: number;
  diagnostics: GraphDiagnostic[];
  structuralKey: string;
}

export interface ProjectStudyPlanGraphInput {
  nodes: readonly StudyPlanVersionNode[];
  prerequisites: readonly PlanPrerequisite[];
  activityByNodeId?: Readonly<Record<string, NodeActivity>>;
  sourceRefs?: Readonly<Record<string, StudySourceResolution>>;
  knowledgeAuthority?: StudyPlanKnowledgeAuthority;
  nodeEvidenceById?: Readonly<Record<string, NodeLearningProgress>>;
  activeGaps?: readonly KnowledgeGapView[];
  recommendedNextNodeId?: string | null;
  includeExcluded?: boolean;
}

export interface PositionedGraphNode {
  node: StudyPlanGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  orderInRank: number;
  isIsolated: boolean;
}

export interface PositionedSourceGraphNode {
  sourceNode: StudyPlanSourceGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedGraphEdge {
  edge: StudyPlanGraphEdge;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  labelX: number;
  labelY: number;
  pathD: string;
  isBackEdge: boolean;
}

export interface PositionedSourceGraphEdge {
  edge: StudyPlanSourceGraphEdge;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  pathD: string;
}

export type GraphLayoutMode = 'empty' | 'roadmap-no-prerequisites' | 'dag';

export interface StudyPlanGraphLayout {
  mode: GraphLayoutMode;
  orientation: GraphOrientation;
  viewLayer: GraphViewLayer;
  width: number;
  height: number;
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
  sourceNodes: PositionedSourceGraphNode[];
  sourceEdges: PositionedSourceGraphEdge[];
  nodePositionById: Readonly<Record<string, PositionedGraphNode>>;
  sourcePositionById: Readonly<Record<string, PositionedSourceGraphNode>>;
}

export interface StudyPlanGraphPrefs {
  outlineMode: 'list' | 'graph';
  orientation: GraphOrientation;
  showMinimap: boolean;
  showLegend: boolean;
}
