/**
 * Examination Attempt Runner View Loader.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { getExamAttempt } from '../../../api/exam-sessions';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { AttemptRunner } from './AttemptRunner';

export interface AttemptRunnerViewProps {
  attemptId: string;
  onComplete: (detail: AttemptDetail) => void;
  onExit: () => void;
  className?: string;
}

export const AttemptRunnerView: React.FC<AttemptRunnerViewProps> = ({
  attemptId,
  onComplete,
  onExit,
  className = '',
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
          setError(err?.messageKey || err?.message || 'Failed to load exam session');
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
        <p className="text-sm">Loading examination session...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={`max-w-md mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl text-center space-y-4 my-12 ${className}`}>
        <p className="text-sm text-error">{error || 'Examination session not found'}</p>
        <Button variant="text" onClick={onExit} className="min-h-[44px]">
          <ArrowLeft size={16} className="mr-1.5 inline" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <AttemptRunner
      detail={detail}
      onComplete={onComplete}
      onExit={onExit}
      className={className}
    />
  );
};
