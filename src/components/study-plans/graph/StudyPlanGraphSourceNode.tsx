import React from 'react';
import { BookOpen, CheckCircle, Warning, WarningDiamond } from '@phosphor-icons/react';
import type { PositionedSourceGraphNode } from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getGraphSurfaceTokens, getSourceHealthStyle } from './theme';

export interface StudyPlanGraphSourceNodeProps {
  positioned: PositionedSourceGraphNode;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (sourceNodeId: string) => void;
}

export const StudyPlanGraphSourceNode: React.FC<StudyPlanGraphSourceNodeProps> = React.memo(({
  positioned,
  isSelected,
  isDimmed,
  onSelect,
}) => {
  useI18n();
  const { sourceNode } = positioned;
  const tokens = getGraphSurfaceTokens();
  const healthStyle = getSourceHealthStyle(sourceNode.status);

  const renderStatusIcon = () => {
    switch (sourceNode.status) {
      case 'current':
        return <CheckCircle size={13} weight="fill" style={{ color: healthStyle.accentColor }} aria-hidden="true" />;
      case 'missing':
      case 'unsupported':
        return <WarningDiamond size={13} weight="fill" style={{ color: healthStyle.accentColor }} aria-hidden="true" />;
      default:
        return <Warning size={13} weight="fill" style={{ color: healthStyle.accentColor }} aria-hidden="true" />;
    }
  };

  return (
    <button
      type="button"
      data-graph-source-id={sourceNode.id}
      data-selected={isSelected ? 'true' : 'false'}
      aria-pressed={isSelected}
      aria-label={t('studyPlans.graph.sourceNodeAriaLabel', {
        var0: sourceNode.title,
        var1: sourceNode.linkedNodeIds.length,
        var2: sourceNode.status,
      })}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(sourceNode.id);
      }}
      className="absolute text-left rounded-lg px-2.5 py-2 flex flex-col justify-between transition-opacity select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2"
      style={{
        left: positioned.x,
        top: positioned.y,
        width: positioned.width,
        height: positioned.height,
        backgroundColor: tokens.panelSurface,
        color: tokens.textPrimary,
        borderWidth: isSelected ? '1.5px' : '1px',
        borderStyle: 'dashed',
        borderColor: isSelected ? tokens.primary : healthStyle.hasWarning ? healthStyle.accentColor : tokens.borderSubtle,
        boxShadow: isSelected ? `0 0 0 2px ${tokens.primary}` : 'none',
        opacity: isDimmed ? 0.25 : 1,
        transitionDuration: 'var(--md-duration-short, 150ms)',
      }}
    >
      <div className="flex items-start gap-1.5 w-full min-w-0">
        <BookOpen size={13} className="mt-0.5 flex-shrink-0" style={{ color: tokens.textMuted }} aria-hidden="true" />
        <span className="text-[11px] font-semibold leading-snug line-clamp-2" style={{ color: tokens.textPrimary }}>
          {sourceNode.title}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 w-full text-[10px]" style={{ color: tokens.textMuted }}>
        <span>{t('studyPlans.graph.sourceSupportsTopics', { var0: sourceNode.linkedNodeIds.length })}</span>
        <span className="inline-flex items-center gap-1" style={{ color: healthStyle.accentColor }}>
          {renderStatusIcon()}
        </span>
      </div>
    </button>
  );
});

StudyPlanGraphSourceNode.displayName = 'StudyPlanGraphSourceNode';
