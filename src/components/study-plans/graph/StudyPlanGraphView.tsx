import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Info,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import type {
  NodeActivity,
  PlanPrerequisite,
  StudyPlanDetail,
  StudyPlanVersionNode,
} from '../../../types/learningPaths';
import type {
  KnowledgeGapView,
  NodeLearningProgress,
} from '../../../types/learningEvidence';
import type { StudySourceResolution } from '../../../types/studySource';
import type {
  GraphHighlightMode,
  GraphOrientation,
  GraphViewLayer,
  PrerequisiteSupportFilter,
  StudyPlanGraphEdge,
  StudyPlanGraphNode as GraphNodeModel,
  StudyPlanSourceGraphNode,
} from '../../../lib/study-plans/graph/types';
import { projectStudyPlanGraph } from '../../../lib/study-plans/graph/projection';
import {
  computeTransitiveSubgraph,
  removePrerequisiteEdge,
  searchStudyPlanGraphNodes,
  validateAndAddPrerequisiteEdge,
  type PrerequisiteMutationResult,
} from '../../../lib/study-plans/graph/traversal';
import { computeStudyPlanGraphLayout } from '../../../lib/study-plans/graph/layout';
import {
  loadStudyPlanGraphPrefs,
  saveStudyPlanGraphPrefs,
} from '../../../lib/study-plans/graph/persistence';
import { getStudyPlanEvidence, listLearningGaps } from '../../../api/learning-evidence';
import { isTauri } from '../../../lib/tauri';
import { t, useI18n } from '../../../lib/i18n';
import { PlanNodeEditor } from '../PlanNodeEditor';
import { StudyPlanGraphEdgesLayer, getEdgeSupportLabel } from './StudyPlanGraphEdge';
import { StudyPlanGraphInspector } from './StudyPlanGraphInspector';
import { StudyPlanGraphLegend } from './StudyPlanGraphLegend';
import { StudyPlanGraphMinimap } from './StudyPlanGraphMinimap';
import { StudyPlanGraphNode } from './StudyPlanGraphNode';
import { StudyPlanGraphSourceNode } from './StudyPlanGraphSourceNode';
import {
  StudyPlanGraphToolbar,
  type OutlineViewMode,
} from './StudyPlanGraphToolbar';
import { getGraphSurfaceTokens } from './theme';

export interface StudyPlanGraphViewProps {
  planDetail: StudyPlanDetail;
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onChangeNodes: (nodes: StudyPlanVersionNode[]) => void;
  onChangeNode: (node: StudyPlanVersionNode) => void;
  onChangePrerequisites: (prereqs: PlanPrerequisite[]) => void;
  onChangeActivity: (nodeId: string, activity: NodeActivity) => void;
  onStartLesson: (nodeId: string) => void;
  onStartPractice?: (nodeId: string) => void;
  onOpenSource: (refId: string, resolution?: StudySourceResolution) => void;
  isReadOnly: boolean;
  mode?: OutlineViewMode;
  onChangeMode?: (mode: OutlineViewMode) => void;
  initialOrientation?: GraphOrientation;
  nodeEvidenceById?: Readonly<Record<string, NodeLearningProgress>>;
  activeGaps?: readonly KnowledgeGapView[];
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.15;
const FIT_PADDING = 36;
const DEFAULT_VIEWPORT_WIDTH = 960;
const DEFAULT_VIEWPORT_HEIGHT = 560;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function mapMutationErrorToLocalized(
  result: PrerequisiteMutationResult
): string {
  const code = 'code' in result ? result.code : 'invalid_input';
  switch (code) {
    case 'dependency_cycle':
      return t('study_plan.error.dependency_cycle');
    case 'self_edge':
      return t('study_plan.error.self_edge');
    case 'duplicate_edge':
      return t('study_plan.error.duplicate_edge');
    case 'excluded_endpoint':
      return t('study_plan.error.excluded_prerequisite');
    case 'not_found':
      return t('study_plan.error.node_not_found');
    case 'read_only':
    case 'invalid_input':
    default:
      return t('study_plan.error.validation_failed');
  }
}

export const StudyPlanGraphView: React.FC<StudyPlanGraphViewProps> = ({
  planDetail,
  nodes,
  prerequisites,
  selectedNodeId,
  onSelectNode,
  onChangeNodes,
  onChangeNode,
  onChangePrerequisites,
  onChangeActivity,
  onStartLesson,
  onStartPractice,
  onOpenSource,
  isReadOnly,
  mode = 'graph',
  onChangeMode,
  initialOrientation,
  nodeEvidenceById: nodeEvidenceProp,
  activeGaps: activeGapsProp,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();
  const planId = planDetail.plan.id;

  const initialPrefs = useMemo(() => loadStudyPlanGraphPrefs(planId), [planId]);

  const [orientation, setOrientation] = useState<GraphOrientation>(
    () => initialOrientation ?? initialPrefs.orientation
  );
  const [showMinimap, setShowMinimap] = useState<boolean>(() => initialPrefs.showMinimap);
  const [showLegend, setShowLegend] = useState<boolean>(() => initialPrefs.showLegend);
  const [viewLayer, setViewLayer] = useState<GraphViewLayer>('curriculum');
  const [supportFilter, setSupportFilter] = useState<PrerequisiteSupportFilter>('all');
  const [includeExcluded, setIncludeExcluded] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [highlightMode, setHighlightMode] = useState<GraphHighlightMode>({ kind: 'none' });
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(() => selectedNodeId !== null);
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const [isConnectMode, setIsConnectMode] = useState(false);
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Optional non-blocking evidence hydration (live native Tauri runtime)
  const [loadedEvidenceById, setLoadedEvidenceById] = useState<
    Record<string, NodeLearningProgress> | undefined
  >(undefined);
  const [loadedGaps, setLoadedGaps] = useState<KnowledgeGapView[] | undefined>(undefined);

  useEffect(() => {
    if (nodeEvidenceProp !== undefined && activeGapsProp !== undefined) return;
    if (!isTauri()) return;
    let active = true;

    void Promise.allSettled([
      getStudyPlanEvidence(planId),
      listLearningGaps(planId, false),
    ]).then(([evidenceResult, gapsResult]) => {
      if (!active) return;
      if (evidenceResult.status === 'fulfilled' && nodeEvidenceProp === undefined) {
        const byNodeId: Record<string, NodeLearningProgress> = {};
        for (const item of evidenceResult.value.nodes) {
          byNodeId[item.nodeId] = item;
        }
        setLoadedEvidenceById(byNodeId);
      }
      if (gapsResult.status === 'fulfilled' && activeGapsProp === undefined) {
        setLoadedGaps(gapsResult.value);
      }
    });

    return () => {
      active = false;
    };
  }, [planId, nodeEvidenceProp, activeGapsProp]);

  const effectiveEvidenceById = nodeEvidenceProp ?? loadedEvidenceById;
  const effectiveGaps = activeGapsProp ?? loadedGaps;

  // Domain projection (memoized cleanly)
  const projection = useMemo(
    () =>
      projectStudyPlanGraph({
        nodes,
        prerequisites,
        activityByNodeId: planDetail.activityByNodeId,
        sourceRefs: planDetail.sourceRefs,
        knowledgeAuthority: planDetail.version.knowledgeAuthority,
        nodeEvidenceById: effectiveEvidenceById,
        activeGaps: effectiveGaps,
        includeExcluded,
      }),
    [
      nodes,
      prerequisites,
      planDetail.activityByNodeId,
      planDetail.sourceRefs,
      planDetail.version.knowledgeAuthority,
      effectiveEvidenceById,
      effectiveGaps,
      includeExcluded,
    ]
  );

  // Deterministic Sugiyama DAG layout
  const layout = useMemo(
    () =>
      computeStudyPlanGraphLayout(projection, {
        orientation,
        viewLayer,
        supportFilter,
      }),
    [projection, orientation, viewLayer, supportFilter]
  );

  const nodeById = useMemo(() => {
    const map: Record<string, GraphNodeModel> = {};
    for (const node of projection.nodes) {
      map[node.nodeId] = node;
    }
    return map;
  }, [projection.nodes]);

  const sourceNodeById = useMemo(() => {
    const map: Record<string, StudyPlanSourceGraphNode> = {};
    for (const src of projection.sourceNodes) {
      map[src.id] = src;
    }
    return map;
  }, [projection.sourceNodes]);

  const edgeById = useMemo(() => {
    const map: Record<string, StudyPlanGraphEdge> = {};
    for (const edge of projection.edges) {
      map[edge.id] = edge;
    }
    return map;
  }, [projection.edges]);

  // Search matching
  const searchMatches = useMemo(
    () => searchStudyPlanGraphNodes(projection.nodes, searchQuery),
    [projection.nodes, searchQuery]
  );
  const searchMatchIdSet = useMemo(
    () => new Set(searchMatches.map((n) => n.nodeId)),
    [searchMatches]
  );
  const activeSearchNode =
    searchMatches.length > 0
      ? searchMatches[activeSearchIndex % searchMatches.length] ?? searchMatches[0]
      : null;

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [searchQuery]);

  // Highlighted subgraph sets
  const {
    highlightedNodeIds,
    highlightedEdgeIds,
    highlightedSourceIds,
    highlightedSourceEdgeIds,
  } = useMemo(() => {
    if (highlightMode.kind === 'none') {
      return {
        highlightedNodeIds: null as Set<string> | null,
        highlightedEdgeIds: null as Set<string> | null,
        highlightedSourceIds: null as Set<string> | null,
        highlightedSourceEdgeIds: null as Set<string> | null,
      };
    }

    if (highlightMode.kind === 'prerequisites' || highlightMode.kind === 'dependents') {
      const sub = computeTransitiveSubgraph(
        highlightMode.nodeId,
        layout.edges.map((e) => e.edge),
        highlightMode.kind
      );
      return {
        highlightedNodeIds: sub.transitiveNodeIds,
        highlightedEdgeIds: sub.highlightedEdgeIds,
        highlightedSourceIds: null,
        highlightedSourceEdgeIds: null,
      };
    }

    if (highlightMode.kind === 'next-topic') {
      const sub = computeTransitiveSubgraph(
        highlightMode.nodeId,
        layout.edges.map((e) => e.edge),
        'prerequisites'
      );
      return {
        highlightedNodeIds: sub.transitiveNodeIds,
        highlightedEdgeIds: sub.highlightedEdgeIds,
        highlightedSourceIds: null,
        highlightedSourceEdgeIds: null,
      };
    }

    // kind === 'source'
    const srcNode = sourceNodeById[highlightMode.sourceNodeId];
    const topicIds = new Set<string>(srcNode?.linkedNodeIds ?? []);
    const srcEdgeIds = new Set<string>(
      layout.sourceEdges
        .filter((se) => se.edge.sourceNodeId === highlightMode.sourceNodeId)
        .map((se) => se.edge.id)
    );
    return {
      highlightedNodeIds: topicIds,
      highlightedEdgeIds: null,
      highlightedSourceIds: new Set<string>([highlightMode.sourceNodeId]),
      highlightedSourceEdgeIds: srcEdgeIds,
    };
  }, [highlightMode, layout.edges, layout.sourceEdges, sourceNodeById]);

  // Viewport & Pan/Zoom State
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT,
  });
  const [transform, setTransform] = useState<{ zoom: number; x: number; y: number }>({
    zoom: 1,
    x: 24,
    y: 24,
  });

  // Measure viewport cleanly with ResizeObserver
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          setViewportSize({ width: w, height: h });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const computeFitTransform = useCallback(
    (targetLayout = layout, vp = viewportSize) => {
      const vw = vp.width > 0 ? vp.width : DEFAULT_VIEWPORT_WIDTH;
      const vh = vp.height > 0 ? vp.height : DEFAULT_VIEWPORT_HEIGHT;
      const gw = Math.max(targetLayout.width, 1);
      const gh = Math.max(targetLayout.height, 1);

      const availW = Math.max(vw - FIT_PADDING * 2, 120);
      const availH = Math.max(vh - FIT_PADDING * 2, 120);
      const zoom = clampZoom(Math.min(availW / gw, availH / gh, 1.0));
      const x = (vw - gw * zoom) / 2;
      const y = (vh - gh * zoom) / 2;
      return { zoom, x, y };
    },
    [layout, viewportSize]
  );

  // Auto-fit ONLY on first mount or when plan/orientation/viewLayer changes (NOT on selection/activity/filter!)
  const lastFittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const fitKey = `${planId}:${orientation}:${viewLayer}`;
    if (lastFittedKeyRef.current !== fitKey) {
      lastFittedKeyRef.current = fitKey;
      setTransform(computeFitTransform(layout, viewportSize));
    }
  }, [planId, orientation, viewLayer, computeFitTransform, layout, viewportSize]);

  const handleFitView = useCallback(() => {
    setTransform(computeFitTransform(layout, viewportSize));
  }, [computeFitTransform, layout, viewportSize]);

  const handleZoomBy = useCallback(
    (delta: number) => {
      setTransform((prev) => {
        const nextZoom = clampZoom(prev.zoom + delta);
        if (nextZoom === prev.zoom) return prev;
        const vw = viewportSize.width > 0 ? viewportSize.width : DEFAULT_VIEWPORT_WIDTH;
        const vh = viewportSize.height > 0 ? viewportSize.height : DEFAULT_VIEWPORT_HEIGHT;
        const cx = vw / 2;
        const cy = vh / 2;
        const factor = nextZoom / prev.zoom;
        return {
          zoom: nextZoom,
          x: cx - (cx - prev.x) * factor,
          y: cy - (cy - prev.y) * factor,
        };
      });
    },
    [viewportSize.width, viewportSize.height]
  );

  const handleResetZoom = useCallback(() => {
    setTransform((prev) => {
      const vw = viewportSize.width > 0 ? viewportSize.width : DEFAULT_VIEWPORT_WIDTH;
      const vh = viewportSize.height > 0 ? viewportSize.height : DEFAULT_VIEWPORT_HEIGHT;
      const cx = vw / 2;
      const cy = vh / 2;
      const factor = 1 / prev.zoom;
      return {
        zoom: 1,
        x: cx - (cx - prev.x) * factor,
        y: cy - (cy - prev.y) * factor,
      };
    });
  }, [viewportSize.width, viewportSize.height]);

  const centerAtGraphPoint = useCallback(
    (graphX: number, graphY: number) => {
      const vw = viewportSize.width > 0 ? viewportSize.width : DEFAULT_VIEWPORT_WIDTH;
      const vh = viewportSize.height > 0 ? viewportSize.height : DEFAULT_VIEWPORT_HEIGHT;
      setTransform((prev) => ({
        ...prev,
        x: vw / 2 - graphX * prev.zoom,
        y: vh / 2 - graphY * prev.zoom,
      }));
    },
    [viewportSize.width, viewportSize.height]
  );

  const revealNodeIfNeeded = useCallback(
    (nodeId: string) => {
      const positioned = layout.nodePositionById[nodeId];
      if (!positioned) return;
      centerAtGraphPoint(
        positioned.x + positioned.width / 2,
        positioned.y + positioned.height / 2
      );
    },
    [layout.nodePositionById, centerAtGraphPoint]
  );

  // Pointer drag pan handlers
  const dragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    startTx: number;
    startTy: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !drag.active) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true;
      }
      setTransform((prev) => ({
        ...prev,
        x: drag.startTx + dx,
        y: drag.startTy + dy,
      }));
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        setSelectedEdgeId(null);
      }
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Ignore drags starting on interactive elements inside overlay controls
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, aside')) return;
    canvasRef.current?.focus({ preventScroll: true });
    dragRef.current = {
      active: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
      moved: false,
    };
  };

  // Non-passive wheel zoom when Ctrl/Cmd held OR canvas is focused (prevents accidental page-scroll hijacking)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const isModifierZoom = e.ctrlKey || e.metaKey;
      const isCanvasFocused =
        document.activeElement === el || el.contains(document.activeElement);
      if (!isModifierZoom && !isCanvasFocused) {
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const step = e.deltaY < 0 ? 0.1 : -0.1;

      setTransform((prev) => {
        const nextZoom = clampZoom(prev.zoom + step);
        if (nextZoom === prev.zoom) return prev;
        const factor = nextZoom / prev.zoom;
        return {
          zoom: nextZoom,
          x: pointerX - (pointerX - prev.x) * factor,
          y: pointerY - (pointerY - prev.y) * factor,
        };
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Apply prerequisite mutation helper cleanly (preserving excluded tombstones)
  const applyPrereqMutation = useCallback(
    (result: PrerequisiteMutationResult) => {
      if (!result.ok) {
        setConnectError(mapMutationErrorToLocalized(result));
        return false;
      }
      setConnectError(null);
      const includedMap = new Map(
        result.nodes.map((n, index) => [n.nodeId, { ...n, position: index }])
      );
      const mergedNodes = nodes.map((n) => includedMap.get(n.nodeId) ?? n);
      onChangePrerequisites(result.prerequisites);
      onChangeNodes(mergedNodes);
      return true;
    },
    [nodes, onChangeNodes, onChangePrerequisites]
  );

  // Node selection / connect workflow handler
  const handleSelectTopicNode = useCallback(
    (nodeId: string) => {
      setSelectedEdgeId(null);
      setSelectedSourceNodeId(null);

      if (isConnectMode && !isReadOnly) {
        if (!connectSourceNodeId) {
          setConnectSourceNodeId(nodeId);
          setConnectError(null);
          onSelectNode(nodeId);
          return;
        }
        if (connectSourceNodeId === nodeId) {
          setConnectSourceNodeId(null);
          return;
        }
        const res = validateAndAddPrerequisiteEdge(
          nodes,
          prerequisites,
          connectSourceNodeId,
          nodeId,
          isReadOnly
        );
        const succeeded = applyPrereqMutation(res);
        if (succeeded) {
          setConnectSourceNodeId(null);
          setIsConnectMode(false);
          onSelectNode(nodeId);
          setIsInspectorOpen(true);
        }
        return;
      }

      onSelectNode(nodeId);
      setIsInspectorOpen(true);
    },
    [
      isConnectMode,
      isReadOnly,
      connectSourceNodeId,
      nodes,
      prerequisites,
      applyPrereqMutation,
      onSelectNode,
    ]
  );

  const handleSelectSourceNode = useCallback((sourceNodeId: string) => {
    setSelectedEdgeId(null);
    setSelectedSourceNodeId(sourceNodeId);
    setHighlightMode({ kind: 'source', sourceNodeId });
    setIsInspectorOpen(true);
  }, []);

  const handleToggleHighlight = useCallback(
    (kind: 'prerequisites' | 'dependents', nodeId: string) => {
      setHighlightMode((prev) =>
        prev.kind === kind && prev.nodeId === nodeId
          ? { kind: 'none' }
          : { kind, nodeId }
      );
    },
    []
  );

  const handleHighlightRecommendedNext = useCallback(() => {
    const nextId = projection.recommendedNextNodeId;
    if (!nextId) return;
    setHighlightMode((prev) =>
      prev.kind === 'next-topic' && prev.nodeId === nextId
        ? { kind: 'none' }
        : { kind: 'next-topic', nodeId: nextId }
    );
    onSelectNode(nextId);
    setSelectedSourceNodeId(null);
    setIsInspectorOpen(true);
    revealNodeIfNeeded(nextId);
  }, [projection.recommendedNextNodeId, onSelectNode, revealNodeIfNeeded]);

  const handleAddPrerequisite = useCallback(
    (prerequisiteNodeId: string, dependentNodeId: string) => {
      const res = validateAndAddPrerequisiteEdge(
        nodes,
        prerequisites,
        prerequisiteNodeId,
        dependentNodeId,
        isReadOnly
      );
      applyPrereqMutation(res);
    },
    [nodes, prerequisites, isReadOnly, applyPrereqMutation]
  );

  const handleRemovePrerequisite = useCallback(
    (prerequisiteNodeId: string, dependentNodeId: string) => {
      const res = removePrerequisiteEdge(
        nodes,
        prerequisites,
        prerequisiteNodeId,
        dependentNodeId,
        isReadOnly
      );
      if (applyPrereqMutation(res)) {
        setSelectedEdgeId(null);
      }
    },
    [nodes, prerequisites, isReadOnly, applyPrereqMutation]
  );

  const handleAddTopic = useCallback(() => {
    if (isReadOnly || nodes.length >= 100) return;
    const includedCount = nodes.filter((n) => n.included).length;
    const newId = `spn_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newNode: StudyPlanVersionNode = {
      nodeId: newId,
      title: t('studyPlans.ui.topic-var0.7b244fd9', { var0: includedCount + 1 }),
      summary: '',
      learningObjectives: ['Learn topic fundamentals'],
      conceptId: null,
      conceptLabel: `Topic ${includedCount + 1}`,
      position: includedCount,
      included: true,
      locked: false,
      userAdded: true,
      userModified: true,
      materialSupport: 'not-validated',
      whyHere: null,
      sourceRefIds: [],
    };
    onChangeNodes([...nodes, newNode]);
    onSelectNode(newId);
    setSelectedSourceNodeId(null);
    setIsInspectorOpen(true);
  }, [isReadOnly, nodes, onChangeNodes, onSelectNode]);

  // Search navigation
  const jumpToSearchMatch = useCallback(
    (nextIndex: number) => {
      if (searchMatches.length === 0) return;
      const wrapped =
        ((nextIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setActiveSearchIndex(wrapped);
      const target = searchMatches[wrapped];
      if (target) {
        onSelectNode(target.nodeId);
        setSelectedSourceNodeId(null);
        setIsInspectorOpen(true);
        revealNodeIfNeeded(target.nodeId);
      }
    },
    [searchMatches, onSelectNode, revealNodeIfNeeded]
  );

  // Keyboard navigation on the graph stage
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomBy(ZOOM_STEP);
    } else if (e.key === '-') {
      e.preventDefault();
      handleZoomBy(-ZOOM_STEP);
    } else if (e.key === '0') {
      e.preventDefault();
      handleResetZoom();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      handleFitView();
    } else if (e.key === '/') {
      e.preventDefault();
      searchInputRef.current?.focus();
    } else if (e.key === 'Escape') {
      if (editingNodeId) {
        setEditingNodeId(null);
      } else if (isConnectMode) {
        setIsConnectMode(false);
        setConnectSourceNodeId(null);
      } else if (selectedEdgeId) {
        setSelectedEdgeId(null);
      } else if (highlightMode.kind !== 'none') {
        setHighlightMode({ kind: 'none' });
      } else if (isInspectorOpen) {
        setIsInspectorOpen(false);
      }
    } else if (
      e.key === 'ArrowRight' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowUp'
    ) {
      if (layout.nodes.length === 0) return;
      e.preventDefault();
      const currentIdx = layout.nodes.findIndex((pn) => pn.node.nodeId === selectedNodeId);
      if (currentIdx === -1) {
        const first = layout.nodes[0];
        if (first) {
          onSelectNode(first.node.nodeId);
          setIsInspectorOpen(true);
        }
        return;
      }

      const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const currentNode = layout.nodes[currentIdx]?.node;
      // Prefer traversing along prerequisite/dependent relationship if available
      if (currentNode) {
        const nextConnected = forward
          ? currentNode.directDependentIds[0]
          : currentNode.directPrerequisiteIds[0];
        if (nextConnected && layout.nodePositionById[nextConnected]) {
          onSelectNode(nextConnected);
          setSelectedSourceNodeId(null);
          setIsInspectorOpen(true);
          return;
        }
      }

      const nextIdx = forward
        ? (currentIdx + 1) % layout.nodes.length
        : (currentIdx - 1 + layout.nodes.length) % layout.nodes.length;
      const candidate = layout.nodes[nextIdx];
      if (candidate) {
        onSelectNode(candidate.node.nodeId);
        setSelectedSourceNodeId(null);
        setIsInspectorOpen(true);
      }
    }
  };

  // Preference mutations
  const handleToggleOrientation = () => {
    const next: GraphOrientation = orientation === 'TB' ? 'LR' : 'TB';
    setOrientation(next);
    saveStudyPlanGraphPrefs(planId, { orientation: next });
  };

  const handleToggleMinimap = () => {
    const next = !showMinimap;
    setShowMinimap(next);
    saveStudyPlanGraphPrefs(planId, { showMinimap: next });
  };

  const handleToggleLegend = () => {
    const next = !showLegend;
    setShowLegend(next);
    saveStudyPlanGraphPrefs(planId, { showLegend: next });
  };

  const selectedGraphNode = selectedNodeId ? nodeById[selectedNodeId] ?? null : null;
  const selectedSourceNode = selectedSourceNodeId
    ? sourceNodeById[selectedSourceNodeId] ?? null
    : null;
  const selectedEdge = selectedEdgeId ? edgeById[selectedEdgeId] ?? null : null;
  const editingRawNode = editingNodeId
    ? nodes.find((n) => n.nodeId === editingNodeId) ?? null
    : null;

  const excludedNodeCount = useMemo(
    () => nodes.filter((n) => !n.included).length,
    [nodes]
  );

  const hasActiveSearchDim = searchQuery.trim().length > 0 && searchMatches.length > 0;

  // Compute highlight label text with literal keys
  const renderHighlightStatusLabel = () => {
    switch (highlightMode.kind) {
      case 'prerequisites': {
        const focusTitle = nodeById[highlightMode.nodeId]?.title ?? '';
        return t('studyPlans.graph.highlightStatusPrereqs', { var0: focusTitle });
      }
      case 'dependents': {
        const focusTitle = nodeById[highlightMode.nodeId]?.title ?? '';
        return t('studyPlans.graph.highlightStatusDeps', { var0: focusTitle });
      }
      case 'next-topic': {
        const focusTitle = nodeById[highlightMode.nodeId]?.title ?? '';
        return t('studyPlans.graph.highlightStatusNext', { var0: focusTitle });
      }
      case 'source': {
        const srcTitle = sourceNodeById[highlightMode.sourceNodeId]?.title ?? '';
        return t('studyPlans.graph.highlightStatusSource', { var0: srcTitle });
      }
      case 'none':
      default:
        return '';
    }
  };

  const connectSourceTitle = connectSourceNodeId
    ? nodeById[connectSourceNodeId]?.title ?? ''
    : '';

  return (
    <div
      data-testid="study-plan-graph-view"
      className="flex flex-col gap-3 w-full"
    >
      {/* Unified Graph Toolbar */}
      <StudyPlanGraphToolbar
        mode={mode}
        onChangeMode={onChangeMode}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchMatchCount={searchMatches.length}
        activeSearchIndex={activeSearchIndex}
        onPrevSearchMatch={() => jumpToSearchMatch(activeSearchIndex - 1)}
        onNextSearchMatch={() => jumpToSearchMatch(activeSearchIndex + 1)}
        supportFilter={supportFilter}
        onSupportFilterChange={setSupportFilter}
        zoom={transform.zoom}
        onFitView={handleFitView}
        onZoomIn={() => handleZoomBy(ZOOM_STEP)}
        onZoomOut={() => handleZoomBy(-ZOOM_STEP)}
        onResetZoom={handleResetZoom}
        orientation={orientation}
        onToggleOrientation={handleToggleOrientation}
        viewLayer={viewLayer}
        onChangeViewLayer={setViewLayer}
        hasSources={projection.sourceNodes.length > 0}
        showMinimap={showMinimap}
        onToggleMinimap={handleToggleMinimap}
        showLegend={showLegend}
        onToggleLegend={handleToggleLegend}
        hasRecommendedNext={projection.recommendedNextNodeId !== null}
        isNextHighlighted={highlightMode.kind === 'next-topic'}
        onHighlightRecommendedNext={handleHighlightRecommendedNext}
        isReadOnly={isReadOnly}
        isConnectMode={isConnectMode}
        onToggleConnectMode={() => {
          setIsConnectMode((prev) => !prev);
          setConnectSourceNodeId(null);
          setConnectError(null);
        }}
        canAddTopic={!isReadOnly && nodes.length < 100}
        onAddTopic={handleAddTopic}
        excludedNodeCount={excludedNodeCount}
        includeExcluded={includeExcluded}
        onToggleIncludeExcluded={() => setIncludeExcluded((prev) => !prev)}
      />

      {/* Informational / Action Banners */}
      {layout.mode === 'roadmap-no-prerequisites' && (
        <div
          data-testid="study-plan-graph-no-prereqs-banner"
          className="px-3.5 py-2 rounded-xl border text-xs flex items-center gap-2"
          style={{
            backgroundColor: tokens.panelSurface,
            borderColor: tokens.borderSubtle,
            color: tokens.textMuted,
          }}
        >
          <Info size={15} style={{ color: tokens.primary }} aria-hidden="true" />
          <span>{t('studyPlans.graph.noPrerequisitesBanner')}</span>
        </div>
      )}

      {isConnectMode && !isReadOnly && (
        <div
          data-testid="study-plan-graph-connect-banner"
          className="px-3.5 py-2 rounded-xl border text-xs flex items-center justify-between gap-2"
          style={{
            backgroundColor: tokens.primaryContainer,
            borderColor: tokens.primary,
            color: tokens.onPrimaryContainer,
          }}
        >
          <span>
            {connectSourceNodeId
              ? t('studyPlans.graph.connectBannerPickTarget', { var0: connectSourceTitle })
              : t('studyPlans.graph.connectBannerPickSource')}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsConnectMode(false);
              setConnectSourceNodeId(null);
            }}
            className="underline font-semibold cursor-pointer"
          >
            {t('studyPlans.graph.cancelConnect')}
          </button>
        </div>
      )}

      {connectError && (
        <div
          role="alert"
          data-testid="study-plan-graph-error-banner"
          className="px-3.5 py-2 rounded-xl border text-xs flex items-center justify-between gap-2"
          style={{
            backgroundColor: tokens.errorContainer,
            borderColor: tokens.errorAccent,
            color: tokens.onErrorContainer,
          }}
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Warning size={15} weight="fill" aria-hidden="true" />
            <span>{connectError}</span>
          </span>
          <button
            type="button"
            onClick={() => setConnectError(null)}
            className="font-semibold underline cursor-pointer"
          >
            {t('studyPlans.graph.dismissNotice')}
          </button>
        </div>
      )}

      {/* Main Stage: Canvas + Collapsible Side Inspector */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch h-[calc(100vh-250px)] min-h-[520px] max-h-[820px] relative">
        {/* Interactive Pannable / Zoomable Canvas */}
        <div
          ref={canvasRef}
          tabIndex={0}
          role="region"
          data-testid="study-plan-graph-canvas"
          aria-label={t('studyPlans.graph.canvasAria')}
          onPointerDown={handleCanvasPointerDown}
          onKeyDown={handleCanvasKeyDown}
          className="relative flex-1 min-w-0 rounded-2xl border overflow-hidden outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2"
          style={{
            backgroundColor: tokens.canvasBackground,
            borderColor: tokens.borderSubtle,
            backgroundImage: `radial-gradient(${tokens.dotGridColor} 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        >
          {layout.mode === 'empty' ? (
            <div
              data-testid="study-plan-graph-empty"
              className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
            >
              <div className="text-sm font-semibold mb-1" style={{ color: tokens.textPrimary }}>
                {t('studyPlans.graph.emptyGraphTitle')}
              </div>
              <p className="text-xs max-w-sm" style={{ color: tokens.textMuted }}>
                {t('studyPlans.graph.emptyGraphBody')}
              </p>
            </div>
          ) : (
            <div
              data-testid="study-plan-graph-transform"
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {/* SVG Edges Layer */}
              <StudyPlanGraphEdgesLayer
                width={layout.width}
                height={layout.height}
                edges={layout.edges}
                sourceEdges={layout.sourceEdges}
                nodeById={nodeById}
                selectedEdgeId={selectedEdgeId}
                highlightedEdgeIds={highlightedEdgeIds}
                highlightedSourceEdgeIds={highlightedSourceEdgeIds}
                onSelectEdge={(edgeId) => {
                  setSelectedEdgeId(edgeId);
                }}
              />

              {/* Source Document Nodes (Source Coverage layer) */}
              {layout.sourceNodes.map((positionedSource) => {
                const srcId = positionedSource.sourceNode.id;
                const isSelected = selectedSourceNodeId === srcId;
                const isDimmed =
                  highlightedSourceIds !== null && !highlightedSourceIds.has(srcId);

                return (
                  <StudyPlanGraphSourceNode
                    key={srcId}
                    positioned={positionedSource}
                    isSelected={isSelected}
                    isDimmed={isDimmed}
                    onSelect={handleSelectSourceNode}
                  />
                );
              })}

              {/* Topic Cards */}
              {layout.nodes.map((positioned) => {
                const nodeId = positioned.node.nodeId;
                const isSelected = selectedNodeId === nodeId && selectedSourceNodeId === null;
                const isHighlighted =
                  highlightedNodeIds !== null && highlightedNodeIds.has(nodeId);
                const isSearchMatch = searchMatchIdSet.has(nodeId);
                const isActiveSearchMatch = activeSearchNode?.nodeId === nodeId;
                const isDimmedByHighlight =
                  highlightedNodeIds !== null && !highlightedNodeIds.has(nodeId);
                const isDimmedBySearch = hasActiveSearchDim && !isSearchMatch;

                return (
                  <StudyPlanGraphNode
                    key={nodeId}
                    positioned={positioned}
                    zoom={transform.zoom}
                    isSelected={isSelected}
                    isHighlighted={isHighlighted}
                    isDimmed={isDimmedByHighlight || isDimmedBySearch}
                    isSearchMatch={isSearchMatch}
                    isActiveSearchMatch={isActiveSearchMatch}
                    isConnectSource={connectSourceNodeId === nodeId}
                    isConnectCandidate={
                      isConnectMode &&
                      connectSourceNodeId !== null &&
                      connectSourceNodeId !== nodeId &&
                      positioned.node.included
                    }
                    onSelect={handleSelectTopicNode}
                    onDoubleClickNode={(id) => {
                      onSelectNode(id);
                      setIsInspectorOpen(true);
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Top-right / Floating Overview Minimap & Legend */}
          {(showMinimap || showLegend) && layout.mode !== 'empty' && (
            <div className="hidden sm:flex flex-col gap-2 absolute top-3 right-3 z-20 pointer-events-auto">
              {showMinimap && (
                <StudyPlanGraphMinimap
                  layout={layout}
                  selectedNodeId={selectedNodeId}
                  zoom={transform.zoom}
                  translateX={transform.x}
                  translateY={transform.y}
                  viewportWidth={viewportSize.width}
                  viewportHeight={viewportSize.height}
                  onCenterAtGraphPoint={centerAtGraphPoint}
                />
              )}
              {showLegend && (
                <StudyPlanGraphLegend
                  statusCounts={projection.statusCounts}
                  lockedCount={projection.lockedCount}
                  staleOrMissingSourceNodeCount={projection.staleOrMissingSourceNodeCount}
                  viewLayer={viewLayer}
                />
              )}
            </div>
          )}

          {/* Selected Edge Rationale Popover */}
          {selectedEdge && (
            <div
              data-testid="study-plan-graph-edge-popover"
              className="absolute bottom-3 right-3 z-20 max-w-xs w-full rounded-xl border shadow-lg p-3 text-xs space-y-2"
              style={{
                backgroundColor: tokens.panelSurface,
                borderColor: tokens.borderSubtle,
                color: tokens.textPrimary,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold leading-snug">
                  {t('studyPlans.graph.edgeSourceArrow', {
                    var0: nodeById[selectedEdge.prerequisiteNodeId]?.title ?? selectedEdge.prerequisiteNodeId,
                    var1: nodeById[selectedEdge.dependentNodeId]?.title ?? selectedEdge.dependentNodeId,
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEdgeId(null)}
                  aria-label={t('studyPlans.graph.closeEdgeDetail')}
                  className="p-0.5 rounded hover:opacity-80 cursor-pointer"
                  style={{ color: tokens.textMuted }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor: tokens.primaryContainer,
                    color: tokens.onPrimaryContainer,
                  }}
                >
                  {getEdgeSupportLabel(selectedEdge.support)}
                </span>
                {selectedEdge.sourceRefIds.length > 0 && (
                  <span className="text-[11px]" style={{ color: tokens.textMuted }}>
                    {t('studyPlans.graph.edgeEvidenceCount', {
                      var0: selectedEdge.sourceRefIds.length,
                    })}
                  </span>
                )}
              </div>

              <p className="text-[11px] leading-relaxed" style={{ color: tokens.textMuted }}>
                {selectedEdge.rationale || t('studyPlans.graph.edgeNoRationale')}
              </p>

              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() =>
                    handleRemovePrerequisite(
                      selectedEdge.prerequisiteNodeId,
                      selectedEdge.dependentNodeId
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer hover:opacity-90"
                  style={{
                    backgroundColor: tokens.errorContainer,
                    borderColor: tokens.errorAccent,
                    color: tokens.onErrorContainer,
                  }}
                >
                  <Trash size={12} aria-hidden="true" />
                  <span>{t('studyPlans.graph.edgeRemove')}</span>
                </button>
              )}
            </div>
          )}

          {/* Bottom-left Active Highlight Pill */}
          {highlightMode.kind !== 'none' && (
            <div
              data-testid="study-plan-graph-highlight-pill"
              className="absolute bottom-3 left-3 z-20 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-sm text-xs max-w-[90%]"
              style={{
                backgroundColor: tokens.panelElevatedSurface,
                borderColor: tokens.primary,
                color: tokens.textPrimary,
              }}
            >
              <span className="truncate font-medium">{renderHighlightStatusLabel()}</span>
              <button
                type="button"
                data-testid="study-plan-graph-clear-highlight"
                onClick={() => setHighlightMode({ kind: 'none' })}
                className="font-semibold underline cursor-pointer flex-shrink-0"
                style={{ color: tokens.primary }}
              >
                {t('studyPlans.graph.clearHighlight')}
              </button>
            </div>
          )}
        </div>

        {/* Collapsible Responsive Inspector Panel */}
        {isInspectorOpen && (selectedGraphNode || selectedSourceNode) && (
          <StudyPlanGraphInspector
            selectedNode={selectedSourceNode ? null : selectedGraphNode}
            selectedSourceNode={selectedSourceNode}
            allNodes={projection.nodes}
            nodeById={nodeById}
            edges={projection.edges}
            sourceRefs={planDetail.sourceRefs}
            highlightMode={highlightMode}
            isReadOnly={isReadOnly}
            onClose={() => {
              setIsInspectorOpen(false);
              setSelectedSourceNodeId(null);
            }}
            onSelectTopic={(id) => {
              onSelectNode(id);
              setSelectedSourceNodeId(null);
              setIsInspectorOpen(true);
              revealNodeIfNeeded(id);
            }}
            onChangeActivity={onChangeActivity}
            onOpenEditDrawer={(id) => setEditingNodeId(id)}
            onStartLesson={onStartLesson}
            onStartPractice={onStartPractice}
            onOpenSource={onOpenSource}
            onToggleHighlight={handleToggleHighlight}
            onAddPrerequisite={handleAddPrerequisite}
            onRemovePrerequisite={handleRemovePrerequisite}
          />
        )}
      </div>

      {/* Full Topic Editor Modal / Drawer reusing canonical PlanNodeEditor */}
      {editingRawNode && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('studyPlans.graph.editTopicDrawerTitle')}
          data-testid="study-plan-graph-edit-drawer"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--color-scrim, rgba(0, 0, 0, 0.5))' }}
          onClick={() => setEditingNodeId(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            style={{
              backgroundColor: tokens.panelSurface,
              borderColor: tokens.borderSubtle,
              color: tokens.textPrimary,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-2"
              style={{ borderColor: tokens.borderSubtle }}
            >
              <h3 className="text-sm font-bold" style={{ color: tokens.textPrimary }}>
                {t('studyPlans.graph.editTopicDrawerTitle')}
              </h3>
              <button
                type="button"
                data-testid="study-plan-graph-edit-drawer-done"
                onClick={() => setEditingNodeId(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                style={{
                  backgroundColor: tokens.primary,
                  color: tokens.onPrimary,
                }}
              >
                {t('studyPlans.graph.doneEditing')}
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <PlanNodeEditor
                node={editingRawNode}
                allNodes={nodes}
                prerequisites={prerequisites}
                activity={planDetail.activityByNodeId[editingRawNode.nodeId] || 'not-started'}
                sourceResolutions={planDetail.sourceRefs}
                onChangeNode={onChangeNode}
                onChangePrerequisites={onChangePrerequisites}
                onChangeActivity={(act) => onChangeActivity(editingRawNode.nodeId, act)}
                onOpenSource={onOpenSource}
                isReadOnly={isReadOnly}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
