import React from 'react';
import type { ReassessmentReturnContext } from './returnContext';

export interface ReassessmentChoiceProps {
  readyRevisionId: string | null;
  excludedFingerprints: string[];
  weakTopics: string[];
  sourceState?: 'ok' | 'deleted' | 'stale';
  returnContext?: ReassessmentReturnContext | null;
  onRetakeSame?: (revisionId: string) => void | Promise<void>;
  onCreateNewPaper?: () => void | Promise<void>;
}

export const ReassessmentChoice: React.FC<ReassessmentChoiceProps> = ({
  readyRevisionId,
  excludedFingerprints,
  weakTopics,
  sourceState = 'ok',
  returnContext = null,
  onRetakeSame,
  onCreateNewPaper,
}) => {
  return (
    <section aria-label="Follow-up reassessment choice" data-testid="reassessment-choice" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <h3 className="font-medium text-sm">Follow-up: retake or new paper</h3>
      <p className="text-xs text-on-surface-variant" data-testid="reassessment-scope">
        Targets {weakTopics.length} weak topic(s); excludes {excludedFingerprints.length} prior fingerprint(s).
        No attempt auto-starts.
      </p>
      {sourceState !== 'ok' && (
        <p role="alert" data-testid="reassessment-source-state" className="text-xs">
          Source {sourceState} — historical excerpts remain readable; new generation is blocked until resolved.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="reassessment-retake"
          disabled={!readyRevisionId || !onRetakeSame}
          onClick={() => readyRevisionId && void onRetakeSame?.(readyRevisionId)}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          Retake same Ready paper
        </button>
        <button
          type="button"
          data-testid="reassessment-new-paper"
          disabled={!onCreateNewPaper}
          onClick={() => void onCreateNewPaper?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          New paper (weak topics, exclusions)
        </button>
      </div>
      {returnContext && (
        <p className="text-xs" data-testid="reassessment-return">
          Returns to plan {returnContext.planId ?? '—'} after results; published plan unchanged unless a reviewed
          Plan Adjustment draft is published.
        </p>
      )}
    </section>
  );
};
