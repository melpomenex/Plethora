import React, { useMemo, useRef, useState } from "react";
import {
  ArrowsIn,
  Exam,
  LinkSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Sparkle,
  Stack,
} from "@phosphor-icons/react";
import {
  buildConceptMapGraph,
  getPrerequisitesForNode,
  type ConceptMapNodeView,
  type ConceptNodeMasteryBadge,
} from "../../../lib/study-plans/studyMode/conceptMapGraph";
import type { ConceptProgressBreakdown } from "../../../lib/study-plans/studyMode/evidenceProgress";

export interface InteractiveConceptMapProps {
  payload: Record<string, unknown>;
  evidenceConcepts: ConceptProgressBreakdown[];
  onJumpToAnchor: (quote?: string) => void;
  onExplainConcept: (conceptLabel: string) => void;
  onPracticeConcept: (conceptLabel: string) => void;
  onPromoteFlashcard?: (prompt: string, explanation: string) => void;
}

const MASTERY_LABELS: Record<ConceptNodeMasteryBadge, string> = {
  demonstrated: "Demonstrated understanding",
  needs_practice: "Needs practice",
  not_assessed: "Not assessed",
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;

export const InteractiveConceptMap: React.FC<InteractiveConceptMapProps> = ({
  payload,
  evidenceConcepts,
  onJumpToAnchor,
  onExplainConcept,
  onPracticeConcept,
  onPromoteFlashcard,
}) => {
  const model = useMemo(
    () => buildConceptMapGraph(payload, evidenceConcepts),
    [evidenceConcepts, payload]
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    model.nodes[0]?.id ?? null
  );
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );

  const selectedNode: ConceptMapNodeView | null = useMemo(
    () => model.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [model.nodes, selectedNodeId]
  );

  const prerequisites = useMemo(
    () => (selectedNode ? getPrerequisitesForNode(model, selectedNode.id) : []),
    [model, selectedNode]
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, ConceptMapNodeView>();
    for (const n of model.nodes) map.set(n.id, n);
    return map;
  }, [model.nodes]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest("[data-concept-node='true']")) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  if (model.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        No concept nodes available in this map.
      </div>
    );
  }

  return (
    <div
      data-testid="interactive-concept-map"
      className="rounded-lg border border-border bg-card overflow-hidden space-y-0"
    >
      {/* Toolbar & Mastery Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-card/80 text-xs">
        <div className="font-semibold truncate">{model.title}</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Number((z - 0.15).toFixed(2))))}
            className="p-1 rounded border border-border hover:bg-muted"
          >
            <MagnifyingGlassMinus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="text-[11px] text-muted-foreground min-w-[38px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Number((z + 0.15).toFixed(2))))}
            className="p-1 rounded border border-border hover:bg-muted"
          >
            <MagnifyingGlassPlus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset graph view"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="p-1 rounded border border-border hover:bg-muted"
          >
            <ArrowsIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Graph Canvas */}
      <div className="relative h-[280px] w-full bg-background/60 overflow-hidden">
        <svg
          role="img"
          aria-label={`Interactive concept map for ${model.title}`}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          viewBox={`0 0 ${model.width} ${model.height}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <defs>
            <marker
              id="concept-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Directional Edges */}
            {model.edges.map((edge) => {
              const fromNode = nodeById.get(edge.from);
              const toNode = nodeById.get(edge.to);
              if (!fromNode || !toNode) return null;
              const x1 = fromNode.x + fromNode.width;
              const y1 = fromNode.y + fromNode.height / 2;
              const x2 = toNode.x;
              const y2 = toNode.y + toNode.height / 2;
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2 - 6;
              const isHighlighted =
                selectedNodeId === edge.from || selectedNodeId === edge.to;

              return (
                <g key={edge.id} data-concept-edge="true">
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    markerEnd="url(#concept-arrow)"
                    className={
                      isHighlighted
                        ? "stroke-primary stroke-[2]"
                        : "stroke-border stroke-[1.5]"
                    }
                  />
                  <text
                    x={midX}
                    y={midY}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {edge.relation.replace(/_/g, " ")}
                  </text>
                </g>
              );
            })}

            {/* Concept Nodes */}
            {model.nodes.map((node) => {
              const isSelected = node.id === selectedNodeId;
              const strokeClass =
                node.mastery === "demonstrated"
                  ? "stroke-primary"
                  : node.mastery === "needs_practice"
                  ? "stroke-destructive"
                  : "stroke-border";
              return (
                <g
                  key={node.id}
                  data-concept-node="true"
                  data-mastery={node.mastery}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${node.label} (${MASTERY_LABELS[node.mastery]})`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedNodeId(node.id);
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx={10}
                    className={`fill-card ${strokeClass} ${
                      isSelected ? "stroke-[2.5]" : "stroke-[1.5]"
                    }`}
                  />
                  <text
                    x={12}
                    y={24}
                    className="fill-foreground text-[12px] font-semibold"
                  >
                    {node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label}
                  </text>
                  <text
                    x={12}
                    y={44}
                    className={
                      node.mastery === "needs_practice"
                        ? "fill-destructive text-[10px]"
                        : node.mastery === "demonstrated"
                        ? "fill-primary text-[10px]"
                        : "fill-muted-foreground text-[10px]"
                    }
                  >
                    {MASTERY_LABELS[node.mastery]}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Contextual Node Inspector */}
      {selectedNode && (
        <div
          data-testid="concept-map-inspector"
          className="border-t border-border bg-card p-3.5 space-y-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-sm text-foreground">{selectedNode.label}</div>
            <span
              data-testid="concept-inspector-mastery"
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                selectedNode.mastery === "demonstrated"
                  ? "bg-primary text-primary-foreground"
                  : selectedNode.mastery === "needs_practice"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {MASTERY_LABELS[selectedNode.mastery]}
            </span>
          </div>

          {selectedNode.definition && (
            <p className="text-muted-foreground leading-relaxed">{selectedNode.definition}</p>
          )}

          {prerequisites.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Prerequisites:</span>
              {prerequisites.map((pre) => (
                <button
                  key={pre.id}
                  type="button"
                  onClick={() => setSelectedNodeId(pre.id)}
                  className="px-2 py-0.5 rounded-full text-[11px] border border-border bg-background hover:bg-muted"
                >
                  {pre.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onJumpToAnchor(selectedNode.citations[0]?.quote)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
            >
              <LinkSimple className="w-3.5 h-3.5" aria-hidden="true" />
              Jump to Source
            </button>
            <button
              type="button"
              onClick={() => onExplainConcept(selectedNode.label)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
            >
              <Sparkle className="w-3.5 h-3.5" aria-hidden="true" />
              Explain
            </button>
            <button
              type="button"
              onClick={() => onPracticeConcept(selectedNode.label)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
            >
              <Exam className="w-3.5 h-3.5" aria-hidden="true" />
              Practice Concept
            </button>
            {onPromoteFlashcard && (
              <button
                type="button"
                onClick={() =>
                  onPromoteFlashcard(
                    `Explain ${selectedNode.label}`,
                    selectedNode.definition || selectedNode.label
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
              >
                <Stack className="w-3.5 h-3.5" aria-hidden="true" />
                Promote Flashcard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
