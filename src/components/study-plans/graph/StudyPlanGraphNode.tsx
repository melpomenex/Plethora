import React from 'react';
import {
  CheckCircle,
  Circle,
  FileText,
  Lock,
  PlayCircle,
  Prohibit,
  Sparkle,
  Warning,
  WarningDiamond,
} from '@phosphor-icons/react';
import type { PositionedGraphNode, StudyPlanGraphNode as GraphNodeModel } from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getActivityStyle, getGraphSurfaceTokens, getSourceHealthStyle } from './theme';

export interface StudyPlanGraphNodeProps {
  positioned: PositionedGraphNode;
  zoom: number;
  isSelected: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
  isSearchMatch: boolean;
  isActiveSearchMatch: boolean;
  isConnectSource: boolean;
  isConnectCandidate: boolean;
  onSelect: (nodeId: string) => void;
  onDoubleClickNode?: (nodeId: string) => void;
}

function getActivityLabel(activity: GraphNodeModel['activity']): string {
  switch (activity) {
    case 'completed':
      return t('studyPlans.ui.completed.b0775abf');
    case 'in-progress':
      return t('studyPlans.ui.in-progress.3850f9d6');
    case 'skipped':
      return t('studyPlans.ui.skipped.76bc3e23');
    case 'not-started':
    default:
      return t('documentsView.notStarted');
  }
}

function renderActivityIcon(activity: GraphNodeModel['activity'], color: string) {
  switch (activity) {
    case 'completed':
      return <CheckCircle size={14} weight="fill" style={{ color }} aria-hidden="true" />;
    case 'in-progress':
      return <PlayCircle size={14} weight="fill" style={{ color }} aria-hidden="true" />;
    case 'skipped':
      return <Prohibit size={14} weight="bold" style={{ color }} aria-hidden="true" />;
    case 'not-started':
    default:
      return <Circle size={14} weight="regular" style={{ color }} aria-hidden="true" />;
  }
}

export const StudyPlanGraphNode: React.FC<StudyPlanGraphNodeProps> = React.memo(({
  positioned,
  zoom,
  isSelected,
  isHighlighted,
  isDimmed,
  isSearchMatch,
  isActiveSearchMatch,
  isConnectSource,
  isConnectCandidate,
  onSelect,
  onDoubleClickNode,
}) => {
  useI18n();
  const { node } = positioned;
  const tokens = getGraphSurfaceTokens();
  const activityStyle = getActivityStyle(node.activity);
  const sourceStyle = getSourceHealthStyle(node.sourceSummary.primaryStatus);
  const isCompactZoom = zoom < 0.34;

  const activityLabel = getActivityLabel(node.activity);
  const displayNumber = node.included ? node.curriculumNumber : node.position + 1;

  const borderColor = isConnectSource
    ? tokens.tertiary
    : isSelected || isActiveSearchMatch
      ? tokens.primary
      : isHighlighted
        ? tokens.primary
        : node.isRecommendedNext && !isDimmed
          ? tokens.primary
          : isSearchMatch
            ? tokens.tertiary
            : !node.included
              ? tokens.borderStrong
              : tokens.borderSubtle;

  const boxShadow = isSelected
    ? `0 0 0 2px ${tokens.primary}, 0 8px 20px -6px rgba(0, 0, 0, 0.25)`
    : isConnectSource
      ? `0 0 0 2px ${tokens.tertiary}, 0 6px 16px -6px rgba(0, 0, 0, 0.22)`
      : isActiveSearchMatch
        ? `0 0 0 2px ${tokens.primary}`
        : isHighlighted
          ? `0 0 0 1px ${tokens.primary}`
          : '0 2px 8px -2px rgba(0, 0, 0, 0.12)';

  const backgroundColor = !node.included
    ? tokens.nodeExcludedSurface
    : isSelected
      ? tokens.panelSurface
      : tokens.nodeSurface;

  const renderSourceBadge = () => {
    const summary = node.sourceSummary;
    if (summary.staleCount > 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate max-w-[116px]"
          style={{
            backgroundColor: sourceStyle.containerBg,
            color: sourceStyle.containerFg,
            border: `1px solid ${sourceStyle.accentColor}`,
          }}
        >
          <Warning size={11} weight="fill" aria-hidden="true" />
          <span className="truncate">{t('studyPlans.graph.staleSourceBadge')}</span>
        </span>
      );
    }
    if (summary.missingCount > 0 || summary.unsupportedCount > 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate max-w-[116px]"
          style={{
            backgroundColor: sourceStyle.containerBg,
            color: sourceStyle.containerFg,
            border: `1px solid ${sourceStyle.accentColor}`,
          }}
        >
          <WarningDiamond size={11} weight="fill" aria-hidden="true" />
          <span className="truncate">{t('studyPlans.graph.missingSourceBadge')}</span>
        </span>
      );
    }
    if (summary.ambiguousCount > 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate max-w-[116px]"
          style={{
            backgroundColor: sourceStyle.containerBg,
            color: sourceStyle.containerFg,
            border: `1px solid ${sourceStyle.accentColor}`,
          }}
        >
          <Warning size={11} weight="bold" aria-hidden="true" />
          <span className="truncate">{t('studyPlans.graph.ambiguousSourceBadge')}</span>
        </span>
      );
    }
    if (summary.totalCount === 0) {
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium truncate"
          style={{ color: tokens.textMuted }}
        >
          <FileText size={11} aria-hidden="true" />
          <span>{t('studyPlans.graph.noSourcesBadge')}</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium truncate"
        style={{ color: tokens.textMuted }}
      >
        <FileText size={11} aria-hidden="true" />
        <span>
          {summary.totalCount === 1
            ? t('studyPlans.graph.sourceCountSingle')
            : t('studyPlans.graph.sourceCountPlural', { var0: summary.totalCount })}
        </span>
      </span>
    );
  };

  return (
    <button
      type="button"
      data-graph-node-id={node.nodeId}
      data-selected={isSelected ? 'true' : 'false'}
      data-highlighted={isHighlighted ? 'true' : 'false'}
      data-activity={node.activity}
      aria-pressed={isSelected}
      aria-label={t('studyPlans.graph.nodeAriaLabel', {
        var0: displayNumber,
        var1: node.title,
        var2: activityLabel,
      })}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.nodeId);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClickNode?.(node.nodeId);
      }}
      className="absolute text-left rounded-xl px-3 py-2.5 flex flex-col justify-between transition-opacity select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2"
      style={{
        left: positioned.x,
        top: positioned.y,
        width: positioned.width,
        height: positioned.height,
        backgroundColor,
        color: tokens.textPrimary,
        borderWidth: isSelected || isConnectSource || node.isRecommendedNext ? '1.5px' : '1px',
        borderStyle: node.included ? 'solid' : 'dashed',
        borderColor,
        boxShadow,
        opacity: isDimmed ? 0.28 : !node.included ? 0.72 : 1,
        transitionDuration: 'var(--md-duration-short, 150ms)',
      }}
    >
      {/* Header Row: Number + Title + Right Icons */}
      <div className="flex items-start justify-between gap-2 w-full min-w-0">
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          <span
            className="flex-shrink-0 text-[11px] font-bold tabular-nums leading-5"
            style={{
              color: isSelected || node.isRecommendedNext ? tokens.primary : tokens.textMuted,
            }}
          >
            {displayNumber}.
          </span>
          <span
            className={`font-semibold leading-snug line-clamp-2 ${
              isCompactZoom ? 'text-xs' : 'text-[13px]'
            } ${!node.included ? 'line-through' : ''}`}
            style={{ color: tokens.textPrimary }}
          >
            {node.title}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
          {node.isRecommendedNext && !isCompactZoom && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
              style={{
                backgroundColor: tokens.primaryContainer,
                color: tokens.onPrimaryContainer,
              }}
              title={t('studyPlans.graph.recommendedNext')}
            >
              <Sparkle size={9} weight="fill" aria-hidden="true" />
              <span>{t('studyPlans.graph.recommendedNext')}</span>
            </span>
          )}
          {node.activeGapCount > 0 && !isCompactZoom && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold"
              style={{
                backgroundColor: tokens.errorContainer,
                color: tokens.onErrorContainer,
              }}
            >
              {t('studyPlans.graph.gapCountBadge', { var0: node.activeGapCount })}
            </span>
          )}
          {node.locked && (
            <span
              className="inline-flex items-center justify-center p-0.5 rounded"
              style={{ color: tokens.textMuted }}
              title={t('studyPlans.graph.authoredLockHint')}
            >
              <Lock size={12} weight="fill" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>

      {/* Footer Metadata Row (hidden in compact macro LOD zoom < 0.55) */}
      {!isCompactZoom && (
        <div className="flex items-center justify-between gap-2 w-full pt-1.5 mt-auto">
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium truncate"
            style={{ color: activityStyle.textColor }}
          >
            {renderActivityIcon(node.activity, activityStyle.accentColor)}
            <span className="truncate">{activityLabel}</span>
          </span>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!node.included ? (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: tokens.secondaryContainer,
                  color: tokens.onSecondaryContainer,
                }}
              >
                {t('studyPlans.graph.removedBadge')}
              </span>
            ) : isConnectCandidate ? (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  backgroundColor: tokens.primaryContainer,
                  color: tokens.onPrimaryContainer,
                }}
              >
                +
              </span>
            ) : (
              renderSourceBadge()
            )}
          </div>
        </div>
      )}
    </button>
  );
});

StudyPlanGraphNode.displayName = 'StudyPlanGraphNode';
