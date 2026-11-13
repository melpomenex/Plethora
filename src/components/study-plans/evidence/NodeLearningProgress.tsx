import React from 'react';
import type { NodeLearningProgress } from '../../../types/learningEvidence';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface NodeLearningProgressProps {
  progress: NodeLearningProgress;
  nodeTitle?: string;
  onOpenSource?: (status: string) => void;
}

export const NodeLearningProgressView: React.FC<NodeLearningProgressProps> = ({
  progress,
  nodeTitle,
  onOpenSource,
}) => {
        useI18n();
        return (
    <section
      aria-label={translateRecentFeature("studyPlans.ui.learning-progress-var0.b564bf35", {var0: nodeTitle ? ` for ${nodeTitle}` : ''})}
      data-testid={`node-progress-${progress.nodeId}`}
      className="rounded-xl border border-outline-variant/30 p-4 space-y-3"
    >
      <h4 className="font-medium text-sm">{nodeTitle ?? progress.nodeId}</h4>
      <dl className="grid grid-cols-1 gap-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            {translateRecentFeature("studyPlans.ui.content-coverage.ba917d5a")}</dt>
          <dd data-testid="axis-coverage">
            {typeof progress.contentCoverage === 'string'
              ? progress.contentCoverage
              : translateRecentFeature("studyPlans.ui.coverage-computed-see-librar.c4e71df5")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            {translateRecentFeature("studyPlans.ui.study-activity.cfeaf39a")}</dt>
          <dd data-testid="axis-activity">
            {typeof progress.activity === 'string' ? progress.activity : JSON.stringify(progress.activity)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            {translateRecentFeature("studyPlans.ui.demonstrated-evidence.c7f9323b")}</dt>
          <dd data-testid="axis-demonstrated">
            {progress.demonstrated ? (
              <EvidenceSummaryCard summary={progress.demonstrated} />
            ) : (
              'No assessment evidence yet — coverage and activity are not mastery.'
            )}
          </dd>
        </div>
      </dl>
      {progress.sourceStatuses.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {progress.sourceStatuses.map((s, i) => {
                        return (
            <button
              key={`${s}-${i}`}
              type="button"
              data-testid={`source-status-${s}`}
              onClick={() => onOpenSource?.(s)}
              className="text-xs underline"
            >{translateRecentFeature("studyPlans.ui.source-var0.8b166fbd", {var0: s})}</button>
          );
          })}
        </div>
      )}
    </section>
  );
};
