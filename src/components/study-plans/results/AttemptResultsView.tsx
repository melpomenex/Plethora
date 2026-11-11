/**
 * Attempt Results View Loader.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { getExamAttempt } from '../../../api/exam-sessions';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { AttemptResults } from './AttemptResults';
import type { ReassessmentReturnContext } from '../remediation/returnContext';

export interface AttemptResultsViewProps {
  attemptId: string;
  onBack: () => void;
  onRetake: (newDetail: AttemptDetail) => void;
  className?: string;
  /** C7-T07 return context; results recompute C6 evidence/history on reassessment finish. */
  returnContext?: ReassessmentReturnContext | null;
}

export const AttemptResultsView: React.FC<AttemptResultsViewProps> = ({
  attemptId,
  onBack,
  onRetake,
  className = '',
  returnContext = null,
}) => {
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getExamAttempt(attemptId);
        if (active) {
          setDetail(res);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.messageKey || err?.message || 'Failed to load examination results');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [attemptId]);

  if (loading) {
    return (
      <div className={`p-12 text-center text-on-surface-variant dark:text-on-surface-variant-dark ${className}`}>
        <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Loading examination results...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={`max-w-md mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl text-center space-y-4 my-12 ${className}`}>
        <p className="text-sm text-error">{error || 'Examination results not found'}</p>
        <Button variant="text" onClick={onBack} className="min-h-[44px]">
          <ArrowLeft size={16} className="mr-1.5 inline" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {returnContext && (
        <p data-testid="results-return-context" className="text-xs text-on-surface-variant">
          Return context: plan {returnContext.planId ?? '—'} · node {returnContext.nodeId ?? '—'} · gap{' '}
          {returnContext.gapId ?? '—'}. Reassessment recomputes C6 evidence/history; published plan unchanged.
        </p>
      )}
      <AttemptResults
        detail={detail}
        onBack={onBack}
        onRetake={onRetake}
        className={className}
      />
    </div>
  );
};
