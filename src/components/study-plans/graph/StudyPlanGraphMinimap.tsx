import React, { useRef } from 'react';
import type { StudyPlanGraphLayout } from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getActivityStyle, getGraphSurfaceTokens } from './theme';

export interface StudyPlanGraphMinimapProps {
  layout: StudyPlanGraphLayout;
  selectedNodeId: string | null;
  zoom: number;
  translateX: number;
  translateY: number;
  viewportWidth: number;
  viewportHeight: number;
  onCenterAtGraphPoint: (graphX: number, graphY: number) => void;
}

const MINIMAP_W = 196;
const MINIMAP_H = 112;

export const StudyPlanGraphMinimap: React.FC<StudyPlanGraphMinimapProps> = ({
  layout,
  selectedNodeId,
  zoom,
  translateX,
  translateY,
  viewportWidth,
  viewportHeight,
  onCenterAtGraphPoint,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const graphW = Math.max(layout.width, 1);
  const graphH = Math.max(layout.height, 1);

  // Visible viewport box in graph coordinate space
  const safeZoom = Math.max(zoom, 0.1);
  const viewLeft = -translateX / safeZoom;
  const viewTop = -translateY / safeZoom;
  const viewWidth = Math.max(40, viewportWidth / safeZoom);
  const viewHeight = Math.max(40, viewportHeight / safeZoom);

  const handlePointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const relX = (event.clientX - rect.left) / rect.width;
    const relY = (event.clientY - rect.top) / rect.height;
    onCenterAtGraphPoint(relX * graphW, relY * graphH);
  };

  return (
    <div
      data-testid="study-plan-graph-minimap"
      className="rounded-xl border shadow-sm overflow-hidden select-none"
      style={{
        width: MINIMAP_W + 16,
        backgroundColor: tokens.panelSurface,
        borderColor: tokens.borderSubtle,
      }}
    >
      <div
        className="px-2.5 py-1.5 border-b text-[11px] font-semibold"
        style={{
          color: tokens.textPrimary,
          borderColor: tokens.borderSubtle,
        }}
      >
        {t('studyPlans.graph.overviewTitle', { var0: layout.nodes.length })}
      </div>
      <div className="p-2">
        <svg
          ref={svgRef}
          width={MINIMAP_W}
          height={MINIMAP_H}
          viewBox={`0 0 ${graphW} ${graphH}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('studyPlans.graph.minimapAria')}
          onClick={handlePointer}
          className="cursor-crosshair block w-full h-auto rounded"
          style={{ backgroundColor: tokens.canvasBackground }}
        >
          {layout.edges.map((edge) => (
            <line
              key={edge.edge.id}
              x1={edge.sourceX}
              y1={edge.sourceY}
              x2={edge.targetX}
              y2={edge.targetY}
              style={{
                stroke: tokens.borderStrong,
                strokeWidth: Math.max(3, graphW * 0.003),
                opacity: 0.45,
              }}
            />
          ))}

          {layout.nodes.map((positioned) => {
            const isSelected = positioned.node.nodeId === selectedNodeId;
            const actStyle = getActivityStyle(positioned.node.activity);
            return (
              <rect
                key={positioned.node.nodeId}
                x={positioned.x}
                y={positioned.y}
                width={positioned.width}
                height={positioned.height}
                rx={14}
                style={{
                  fill: isSelected ? tokens.primary : actStyle.accentColor,
                  opacity: isSelected ? 0.95 : 0.65,
                  stroke: isSelected ? tokens.primary : 'none',
                  strokeWidth: isSelected ? Math.max(8, graphW * 0.008) : 0,
                }}
              />
            );
          })}

          {viewportWidth > 0 && viewportHeight > 0 && (
            <rect
              x={viewLeft}
              y={viewTop}
              width={viewWidth}
              height={viewHeight}
              fill="none"
              style={{
                stroke: tokens.primary,
                strokeWidth: Math.max(6, graphW * 0.006),
                strokeDasharray: `${Math.max(10, graphW * 0.01)} ${Math.max(6, graphW * 0.006)}`,
                opacity: 0.85,
              }}
            />
          )}
        </svg>
      </div>
    </div>
  );
};
