import React from 'react';
import type { NodeLearningProgress } from '../../../types/learningEvidence';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';

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
  return (
    <section
      aria-label={`Learning progress${nodeTitle ? ` for ${nodeTitle}` : ''}`}
      data-testid={`node-progress-${progress.nodeId}`}
      className="rounded-xl border border-outline-variant/30 p-4 space-y-3"
    >
      <h4 className="font-medium text-sm">{nodeTitle ?? progress.nodeId}</h4>
      <dl className="grid grid-cols-1 gap-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            Content coverage
          </dt>
          <dd data-testid="axis-coverage">
            {typeof progress.contentCoverage === 'string'
              ? progress.contentCoverage
              : 'Coverage computed — see library analysis'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            Study activity
          </dt>
          <dd data-testid="axis-activity">
            {typeof progress.activity === 'string' ? progress.activity : JSON.stringify(progress.activity)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            Demonstrated evidence
          </dt>
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
          {progress.sourceStatuses.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              data-testid={`source-status-${s}`}
              onClick={() => onOpenSource?.(s)}
              className="text-xs underline"
            >
              Source: {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
