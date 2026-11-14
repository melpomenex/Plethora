import React from 'react';
import type {
  PositionedGraphEdge,
  PositionedSourceGraphEdge,
  StudyPlanGraphNode,
} from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getEdgeStyle, getSourceHealthStyle } from './theme';

export interface StudyPlanGraphEdgesLayerProps {
  width: number;
  height: number;
  edges: PositionedGraphEdge[];
  sourceEdges: PositionedSourceGraphEdge[];
  nodeById: Readonly<Record<string, StudyPlanGraphNode>>;
  selectedEdgeId: string | null;
  highlightedEdgeIds: ReadonlySet<string> | null;
  highlightedSourceEdgeIds: ReadonlySet<string> | null;
  onSelectEdge: (edgeId: string) => void;
}

export function getEdgeSupportLabel(support: PositionedGraphEdge['edge']['support']): string {
  switch (support) {
    case 'user':
      return t('studyPlans.graph.supportUser');
    case 'confirmed-concept-link':
      return t('studyPlans.graph.supportConfirmed');
    case 'unsupported':
      return t('studyPlans.graph.supportUnsupported');
    case 'inferred':
    default:
      return t('studyPlans.graph.supportInferred');
  }
}

const MARKER_IDS = {
  primary: 'sp-graph-arrow-primary',
  tertiary: 'sp-graph-arrow-tertiary',
  muted: 'sp-graph-arrow-muted',
  warning: 'sp-graph-arrow-warning',
} as const;

export const StudyPlanGraphEdgesLayer: React.FC<StudyPlanGraphEdgesLayerProps> = React.memo(({
  width,
  height,
  edges,
  sourceEdges,
  nodeById,
  selectedEdgeId,
  highlightedEdgeIds,
  highlightedSourceEdgeIds,
  onSelectEdge,
}) => {
  useI18n();

  const handleEdgeKeyDown = (event: React.KeyboardEvent, edgeId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onSelectEdge(edgeId);
    }
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 overflow-visible pointer-events-none"
      aria-hidden={edges.length === 0 && sourceEdges.length === 0}
    >
      <defs>
        <marker
          id={MARKER_IDS.primary}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0.8 L 7.5 4 L 0 7.2 z" style={{ fill: 'var(--color-primary, #3b82f6)' }} />
        </marker>
        <marker
          id={MARKER_IDS.tertiary}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 0 0.8 L 7.5 4 L 0 7.2 z"
            style={{ fill: 'var(--color-tertiary, var(--color-primary, #3b82f6))' }}
          />
        </marker>
        <marker
          id={MARKER_IDS.muted}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 0 0.8 L 7.5 4 L 0 7.2 z"
            style={{ fill: 'var(--color-outline, var(--color-on-surface-variant, #64748b))' }}
          />
        </marker>
        <marker
          id={MARKER_IDS.warning}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 0 0.8 L 7.5 4 L 0 7.2 z"
            style={{ fill: 'var(--color-warning, var(--color-error, #f59e0b))' }}
          />
        </marker>
      </defs>

      {/* Supporting Source Grounding Links (no prerequisite arrowheads) */}
      {sourceEdges.map((positionedSourceEdge) => {
        const { edge, pathD } = positionedSourceEdge;
        const healthStyle = getSourceHealthStyle(edge.status);
        const isHighlighted =
          highlightedSourceEdgeIds !== null && highlightedSourceEdgeIds.has(edge.id);
        const isDimmed =
          (highlightedSourceEdgeIds !== null && !isHighlighted) ||
          (highlightedEdgeIds !== null && highlightedEdgeIds.size > 0 && highlightedSourceEdgeIds === null);

        return (
          <path
            key={edge.id}
            d={pathD}
            fill="none"
            data-source-edge-id={edge.id}
            style={{
              stroke: healthStyle.accentColor,
              strokeWidth: isHighlighted ? 1.8 : 1.25,
              strokeDasharray: '3 4',
              opacity: isDimmed ? 0.16 : isHighlighted ? 0.92 : 0.45,
              transition: 'opacity var(--md-duration-short, 150ms) ease',
            }}
          />
        );
      })}

      {/* Directed Prerequisite Edges (A -> B) */}
      {edges.map((positionedEdge) => {
        const { edge, pathD } = positionedEdge;
        const sourceTitle = nodeById[edge.prerequisiteNodeId]?.title ?? edge.prerequisiteNodeId;
        const targetTitle = nodeById[edge.dependentNodeId]?.title ?? edge.dependentNodeId;
        const isSelected = selectedEdgeId === edge.id;
        const isHighlighted = highlightedEdgeIds !== null && highlightedEdgeIds.has(edge.id);
        const isDimmed =
          (highlightedEdgeIds !== null && !isHighlighted && !isSelected) ||
          (highlightedSourceEdgeIds !== null && !isSelected);

        const style = getEdgeStyle(edge.support, {
          highlighted: isHighlighted,
          selected: isSelected,
          dimmed: isDimmed,
        });

        return (
          <g
            key={edge.id}
            role="button"
            tabIndex={0}
            data-graph-edge-id={edge.id}
            data-support={edge.support}
            data-highlighted={isHighlighted ? 'true' : 'false'}
            aria-label={t('studyPlans.graph.edgeAriaLabel', {
              var0: sourceTitle,
              var1: targetTitle,
              var2: getEdgeSupportLabel(edge.support),
            })}
            className="pointer-events-auto cursor-pointer focus:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              onSelectEdge(edge.id);
            }}
            onKeyDown={(e) => handleEdgeKeyDown(e, edge.id)}
          >
            {/* Invisible generous hit target for smooth clicking */}
            <path d={pathD} fill="none" stroke="transparent" strokeWidth={14} />
            <path
              d={pathD}
              fill="none"
              markerEnd={`url(#${MARKER_IDS[style.markerVariant]})`}
              style={{
                stroke: style.stroke,
                strokeWidth: style.strokeWidth,
                strokeDasharray: style.strokeDasharray,
                opacity: style.opacity,
                strokeLinecap: 'round',
                transition: 'opacity var(--md-duration-short, 150ms) ease, stroke-width var(--md-duration-short, 150ms) ease',
              }}
            />
          </g>
        );
      })}
    </svg>
  );
});

StudyPlanGraphEdgesLayer.displayName = 'StudyPlanGraphEdgesLayer';
