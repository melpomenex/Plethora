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
import { getAssessmentBlueprintRevision } from '../../../api/assessment-blueprints';
import { getStudyPlan } from '../../../api/study-plans';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import type { StudySourceResolution } from '../../../types/studySource';
import { AttemptRunner } from './AttemptRunner';
import type { ReassessmentReturnContext } from '../remediation/returnContext';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface AttemptRunnerViewProps {
  attemptId: string;
  onComplete: (detail: AttemptDetail) => void;
  onExit: () => void;
  className?: string;
  /** C7-T07 return context carried through runner → results → plan. */
  returnContext?: ReassessmentReturnContext | null;
}

export const AttemptRunnerView: React.FC<AttemptRunnerViewProps> = ({
  attemptId,
  onComplete,
  onExit,
  className = '',
  returnContext = null,
}) => {
        useI18n();
        const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [sourceRefs, setSourceRefs] = useState<Record<string, StudySourceResolution> | null>(null);
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
          setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
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

  useEffect(() => {
    const blueprintRevisionId = detail?.attempt.blueprintRevisionId;
    if (!blueprintRevisionId) return;

    let active = true;
    setSourceRefs(null);

    async function loadQuestionSources() {
      try {
        const blueprint = await getAssessmentBlueprintRevision(blueprintRevisionId);
        const planId = blueprint.blueprint.planId;
        const planVersionId = blueprint.revision.planVersionId;
        if (!planId || !planVersionId) {
          if (active) setSourceRefs({});
          return;
        }
        const plan = await getStudyPlan(planId, planVersionId);
        if (active) setSourceRefs(plan.sourceRefs);
      } catch {
        if (active) setSourceRefs({});
      }
    }

    void loadQuestionSources();
    return () => {
      active = false;
    };
  }, [detail?.attempt.blueprintRevisionId]);

  if (loading) {
    return (
      <div className={`p-12 text-center text-on-surface-variant dark:text-on-surface-variant-dark ${className}`}>
        <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">{translateRecentFeature("studyPlans.ui.loading-examination-session.50892e1f")}</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={`max-w-md mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl text-center space-y-4 my-12 ${className}`}>
        <p className="text-sm text-error">{error || translateRecentFeature("i18nAudit.ui.examination-session-not-foun.8d00487e")}</p>
        <Button variant="text" onClick={onExit} className="min-h-[44px]">
          <ArrowLeft size={16} className="mr-1.5 inline" />
          {translateRecentFeature("studyPlans.ui.go-back.a4138c28")}</Button>
      </div>
    );
  }

  return (
    <AttemptRunner
      detail={detail}
      onComplete={onComplete}
      onExit={onExit}
      className={className}
      returnContext={returnContext}
      onReturnToPlan={undefined}
      sourceRefs={sourceRefs ?? {}}
      sourceRefsLoading={sourceRefs === null}
    />
  );
};
