import React from 'react';
import {
  CheckCircle,
  Circle,
  FileText,
  Lock,
  PlayCircle,
  Prohibit,
  Warning,
} from '@phosphor-icons/react';
import type { NodeActivity } from '../../../types/learningPaths';
import type { GraphViewLayer } from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getActivityStyle, getGraphSurfaceTokens, getSourceHealthStyle } from './theme';

export interface StudyPlanGraphLegendProps {
  statusCounts: Record<NodeActivity, number>;
  lockedCount: number;
  staleOrMissingSourceNodeCount: number;
  viewLayer: GraphViewLayer;
}

export const StudyPlanGraphLegend: React.FC<StudyPlanGraphLegendProps> = ({
  statusCounts,
  lockedCount,
  staleOrMissingSourceNodeCount,
  viewLayer,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();
  const staleStyle = getSourceHealthStyle('stale');

  return (
    <div
      data-testid="study-plan-graph-legend"
      className="rounded-xl border shadow-sm p-3 text-[11px] space-y-2.5 w-[212px]"
      style={{
        backgroundColor: tokens.panelSurface,
        borderColor: tokens.borderSubtle,
        color: tokens.textPrimary,
      }}
    >
      <div className="font-semibold text-xs" style={{ color: tokens.textPrimary }}>
        {t('studyPlans.graph.legendTitle')}
      </div>

      {/* Topic Status */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
          {t('studyPlans.graph.legendTopicStatus')}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Circle size={12} style={{ color: getActivityStyle('not-started').accentColor }} aria-hidden="true" />
            <span>{t('documentsView.notStarted')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({statusCounts['not-started']})</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <PlayCircle size={12} weight="fill" style={{ color: getActivityStyle('in-progress').accentColor }} aria-hidden="true" />
            <span>{t('studyPlans.ui.in-progress.3850f9d6')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({statusCounts['in-progress']})</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle size={12} weight="fill" style={{ color: getActivityStyle('completed').accentColor }} aria-hidden="true" />
            <span>{t('studyPlans.ui.completed.b0775abf')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({statusCounts.completed})</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Prohibit size={12} weight="bold" style={{ color: getActivityStyle('skipped').accentColor }} aria-hidden="true" />
            <span>{t('studyPlans.ui.skipped.76bc3e23')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({statusCounts.skipped})</span>
        </div>
      </div>

      {/* Other Indicators */}
      <div className="space-y-1 pt-1.5 border-t" style={{ borderColor: tokens.borderSubtle }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
          {t('studyPlans.graph.legendOther')}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={12} weight="fill" style={{ color: tokens.textMuted }} aria-hidden="true" />
            <span>{t('studyPlans.graph.legendLockedAuthored')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({lockedCount})</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <FileText size={12} style={{ color: tokens.textMuted }} aria-hidden="true" />
            <span>{t('studyPlans.graph.legendSourcesExample')}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Warning size={12} weight="fill" style={{ color: staleStyle.accentColor }} aria-hidden="true" />
            <span>{t('studyPlans.graph.legendStaleOrMissing')}</span>
          </span>
          <span className="tabular-nums" style={{ color: tokens.textMuted }}>({staleOrMissingSourceNodeCount})</span>
        </div>
      </div>

      {/* Prerequisite Confidence */}
      <div className="space-y-1 pt-1.5 border-t" style={{ borderColor: tokens.borderSubtle }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
          {t('studyPlans.graph.legendEdgeConfidence')}
        </div>
        <div className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="26" y2="4" style={{ stroke: tokens.primary, strokeWidth: 2 }} />
          </svg>
          <span>{t('studyPlans.graph.supportUser')}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="26" y2="4" style={{ stroke: tokens.tertiary, strokeWidth: 1.8 }} />
          </svg>
          <span>{t('studyPlans.graph.supportConfirmed')}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="26"
              y2="4"
              strokeDasharray="5 3"
              style={{ stroke: tokens.borderStrong, strokeWidth: 1.5 }}
            />
          </svg>
          <span>{t('studyPlans.graph.supportInferred')}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="26"
              y2="4"
              strokeDasharray="2.5 3"
              style={{ stroke: tokens.warning, strokeWidth: 1.5 }}
            />
          </svg>
          <span>{t('studyPlans.graph.supportUnsupported')}</span>
        </div>
        {viewLayer === 'sources' && (
          <div className="flex items-center gap-2 pt-0.5">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="26"
                y2="4"
                strokeDasharray="3 4"
                style={{ stroke: tokens.success, strokeWidth: 1.4 }}
              />
            </svg>
            <span>{t('studyPlans.graph.legendSourceGrounding')}</span>
          </div>
        )}
      </div>
    </div>
  );
};
