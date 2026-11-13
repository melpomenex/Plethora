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
import { getDiagnosticPriorEvidence, type CurriculumPriorEvidence } from '../../../api/learning-evidence';
import { applyDiagnosticAdaptation } from '../../../lib/study-plans/diagnostics/diagnosticAdaptation';
import { DiagnosticResultsAdapter } from '../diagnostics/DiagnosticResultsAdapter';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { AttemptResults } from './AttemptResults';
import { RubricGradingControls } from '../grading/RubricGradingControls';
import { studyErrorMessage } from '../../../lib/study-plans/studyErrorMessage';
import type { ReassessmentReturnContext } from '../remediation/returnContext';
import { StudyPlansScrollContainer } from '../StudyPlansScrollContainer';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
    useI18n();
    const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagEvidence, setDiagEvidence] = useState<CurriculumPriorEvidence | null>(null);
  const [diagPending, setDiagPending] = useState(false);
  const [, setDiagApplying] = useState(false);
  const [diagApplied, setDiagApplied] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
            setLoading(true);
      setError(null);
      try {
        const res = await getExamAttempt(attemptId);
        if (active) {
          setDetail(res);
          if (res.attempt.mode === 'diagnostic') {
            try {
              const evidence: CurriculumPriorEvidence = await getDiagnosticPriorEvidence(attemptId);
              if (active) setDiagEvidence(evidence);
            } catch {
              if (active) setDiagEvidence(null);
            }
            const pending = (res.currentGrades ?? []).some((g) => g.state !== 'final');
            if (active) setDiagPending(pending);
          }
        }
      } catch (err: any) {
        if (active) {
          setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.could-not-load-examination-r.aac5a5da")));
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
      <StudyPlansScrollContainer className={`p-4 ${className}`} data-study-plans-scroll="attempt-results">
      <div className="p-12 text-center text-on-surface-variant dark:text-on-surface-variant-dark">
        <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">{translateRecentFeature("studyPlans.ui.loading-examination-results.38422528")}</p>
      </div>
      </StudyPlansScrollContainer>
    );
  }

  if (error || !detail) {
    return (
      <StudyPlansScrollContainer className={`p-4 ${className}`} data-study-plans-scroll="attempt-results">
      <div className="max-w-md mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl text-center space-y-4 my-4">
        <p className="text-sm text-error">{error || translateRecentFeature("i18nAudit.ui.examination-results-not-foun.9896fab8")}</p>
        <Button variant="text" onClick={onBack} className="min-h-[44px]">
          <ArrowLeft size={16} className="mr-1.5 inline" />
          {translateRecentFeature("studyPlans.ui.go-back.a4138c28")}</Button>
      </div>
      </StudyPlansScrollContainer>
    );
  }

  return (
    <StudyPlansScrollContainer className={`p-4 ${className}`} data-study-plans-scroll="attempt-results">
    <div className="space-y-3">
      {returnContext && (
        <p data-testid="results-return-context" className="text-xs text-on-surface-variant">
          {translateRecentFeature("studyPlans.ui.return-context-plan.fa789fc6")}{returnContext.planId ?? '—'} {translateRecentFeature("studyPlans.ui.node.a011c4f1")}{returnContext.nodeId ?? '—'} {translateRecentFeature("studyPlans.ui.gap.2af2aaf1")}{' '}
          {returnContext.gapId ?? '—'}{translateRecentFeature("studyPlans.ui.reassessment-recomputes-c6-e.3c5f9584")}</p>
      )}
      <AttemptResults
        detail={detail}
        onBack={onBack}
        onRetake={onRetake}
        className={className}
        onGradeRecorded={() => {
          void getExamAttempt(attemptId).then(setDetail, () => {
                        return setError(translateRecentFeature("studyPlans.ui.could-not-reload-examination.65430937"));
          });
        }}
      />
      {detail.attempt.mode === 'diagnostic' && returnContext?.planId && (
        <DiagnosticResultsAdapter
          priorEvidence={diagEvidence as never}
          hasPendingGrading={diagPending}
          applyDisabledReason={diagApplied ? 'Adaptation already applied to this draft.' : null}
          onApply={async () => {
                        if (!diagEvidence) return;
            setDiagApplying(true);
            setError(null);
            try {
              await applyDiagnosticAdaptation(returnContext.planId!, undefined, diagEvidence as never);
              setDiagApplied(true);
            } catch (err) {
              setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.could-not-apply-the-diagnost.141f3c86")));
            } finally {
              setDiagApplying(false);
            }
          }}
          onReject={() => setDiagEvidence(null)}
        />
      )}
      <RubricGradingControls key={attemptId} detail={detail} onUpdate={setDetail} />
    </div>
    </StudyPlansScrollContainer>
  );
};
