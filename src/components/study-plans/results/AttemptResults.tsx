/**
 * Examination Results and Question Inspection View.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  GraduationCap,
  ArrowLeft,
  ArrowsCounterClockwise,
  Warning,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { calculateAttemptScoreSummary } from '../../../lib/study-plans/attempts/attemptScoring';
import { checkGradingRecoveryStatus } from '../../../lib/study-plans/grading/gradingRecovery';
import { startExamAttempt } from '../../../api/exam-sessions';
import { getAssessmentBlueprintRevision } from '../../../api/assessment-blueprints';
import { ObjectiveScoreSummary } from './ObjectiveScoreSummary';
import { QuestionResultCard } from './QuestionResultCard';
import { GradingRecoveryPanel } from '../grading/GradingRecoveryPanel';
import { ManualGradeReview } from '../grading/ManualGradeReview';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { GradeRecord, GradeSettlementOutcome } from '../../../types/assessmentSessions';

export interface AttemptResultsProps {
  detail: AttemptDetail;
  onBack: () => void;
  onRetake?: (newAttemptDetail: AttemptDetail) => void;
  onGradeRecorded?: (outcome: GradeSettlementOutcome) => void;
  className?: string;
}

type ResultFilter = 'all' | 'incorrect' | 'finalized' | 'pending';

export const AttemptResults: React.FC<AttemptResultsProps> = ({
  detail,
  onBack,
  onRetake,
  onGradeRecorded,
  className = '',
}) => {
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [isRetaking, setIsRetaking] = useState(false);
  const [isUnverifiedModelOnly, setIsUnverifiedModelOnly] = useState(false);
  const [reviewingItem, setReviewingItem] = useState<{
    question: AssessmentQuestionRevision;
    submissionId: string;
    studentResponse: string;
    grade: GradeRecord | null;
  } | null>(null);

  const { attempt, responses, submissions = [], currentGrades, questions = [] } = detail;

  useEffect(() => {
    let stale = false;
    if (!attempt.blueprintRevisionId) return;
    void getAssessmentBlueprintRevision(attempt.blueprintRevisionId).then(
      (blueprint) => {
        if (!stale && blueprint?.revision?.config?.knowledgePolicy === 'model-only') {
          setIsUnverifiedModelOnly(true);
        }
      },
      () => undefined
    );
    return () => { stale = true; };
  }, [attempt.blueprintRevisionId]);

  const scoreSummary = useMemo(
    () => calculateAttemptScoreSummary(attempt.id, questions, currentGrades),
    [attempt.id, questions, currentGrades]
  );

  const recoveryStatus = useMemo(
    () => checkGradingRecoveryStatus(detail),
    [detail]
  );

  // Pair each question with its response slot and current grade
  const questionResults = useMemo(() => {
    return questions.map((q, idx) => {
      const response = responses.find((r) => r.questionRevisionId === q.id);
      const grade = currentGrades.find((g) => g.questionRevisionId === q.id);
      return {
        number: idx + 1,
        question: q,
        responseDraft: response?.draft || { kind: 'short-answer', text: '' },
        responseMark: response?.mark || 'unanswered',
        grade: grade || null,
      };
    });
  }, [questions, responses, currentGrades]);

  const filteredResults = useMemo(() => {
    if (filter === 'incorrect') {
      return questionResults.filter((r) => r.grade?.outcome === 'incorrect');
    }
    if (filter === 'finalized') {
      return questionResults.filter((r) => r.grade?.state === 'final');
    }
    if (filter === 'pending') {
      return questionResults.filter((r) => !r.grade || r.grade.state !== 'final');
    }
    return questionResults;
  }, [questionResults, filter]);

  const handleRetake = async () => {
    if (!onRetake) return;
    setIsRetaking(true);
    try {
      const clientStartKey = `start_retake_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newAttempt = await startExamAttempt({
        blueprintRevisionId: attempt.blueprintRevisionId,
        clientStartKey,
      });
      onRetake(newAttempt);
    } catch {
      // Handled via UI alert or retry
    } finally {
      setIsRetaking(false);
    }
  };

  return (
    <div
      className={`max-w-4xl mx-auto flex flex-col gap-6 p-4 sm:p-6 bg-surface dark:bg-surface-dark min-h-screen ${className}`}
      role="main"
      aria-label="Examination Results"
    >
      {isUnverifiedModelOnly && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          <Warning size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Unverified model-only self-check — this result is displayed for practice only and never counts as demonstrated evidence.
          </span>
        </div>
      )}
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-outline-variant/30">        <div className="flex items-center gap-3">
          <Button
            variant="text"
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] p-2"
            aria-label="Back to examination list"
          >
            <ArrowLeft size={20} />
          </Button>

          <div>
            <h1 className="text-base sm:text-lg font-bold text-on-surface dark:text-on-surface-dark flex items-center gap-2">
              <GraduationCap size={20} className="text-primary dark:text-primary-dark" />
              {attempt.blueprintTitle || 'Assessment Paper'} — Results
            </h1>
            <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark capitalize">
              {attempt.mode} Assessment Completed
            </span>
          </div>
        </div>

        {onRetake && (
          <Button
            variant="filled"
            onClick={handleRetake}
            disabled={isRetaking}
            className="min-h-[44px] px-4 font-semibold shadow-sm"
          >
            <ArrowsCounterClockwise size={16} className={`mr-1.5 inline ${isRetaking ? 'animate-spin' : ''}`} />
            {isRetaking ? 'Preparing...' : 'Retake Paper'}
          </Button>
        )}
      </header>

      {/* Official Score Summary Card */}
      <ObjectiveScoreSummary
        scoreSummary={scoreSummary}
        status={attempt.status}
        startedAt={attempt.startedAt}
        completedAt={attempt.completedAt}
      />

      <div
        data-testid="results-evidence-note"
        className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark rounded-xl border border-outline-variant/30 p-3"
      >
        Official totals include Final grades only. Demonstrated evidence, coverage and activity are
        shown separately in the plan Evidence &amp; Gaps tab — no score here is a mastery
        probability.
      </div>

      {/* Subjective Grading Recovery & Review Banner */}
      <GradingRecoveryPanel status={recoveryStatus} />

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-outline-variant/30 pb-2">
        <Button
          variant={filter === 'all' ? 'filled' : 'text'}
          size="sm"
          onClick={() => setFilter('all')}
          className="min-h-[36px] text-xs font-semibold"
        >
          All Questions ({questionResults.length})
        </Button>

        <Button
          variant={filter === 'incorrect' ? 'filled' : 'text'}
          size="sm"
          onClick={() => setFilter('incorrect')}
          className="min-h-[36px] text-xs font-semibold"
        >
          Incorrect Only ({questionResults.filter((r) => r.grade?.outcome === 'incorrect').length})
        </Button>

        <Button
          variant={filter === 'finalized' ? 'filled' : 'text'}
          size="sm"
          onClick={() => setFilter('finalized')}
          className="min-h-[36px] text-xs font-semibold"
        >
          Finalized ({scoreSummary.finalQuestions})
        </Button>

        {scoreSummary.pendingQuestions > 0 && (
          <Button
            variant={filter === 'pending' ? 'filled' : 'text'}
            size="sm"
            onClick={() => setFilter('pending')}
            className="min-h-[36px] text-xs font-semibold"
          >
            Pending ({scoreSummary.pendingQuestions})
          </Button>
        )}
      </div>

      {/* Question Results List */}
      <div className="space-y-4">
        {filteredResults.length === 0 ? (
          <div className="p-8 text-center text-on-surface-variant dark:text-on-surface-variant-dark text-sm bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl">
            No questions match the selected filter.
          </div>
        ) : (
          filteredResults.map((item) => {
            const submission = submissions.find((s) => s.questionRevisionId === item.question.id);
            const submissionId = submission?.id || item.grade?.responseSubmissionId || '';
            const draft = item.responseDraft;
            const studentResponse = (draft as any)?.text || (draft as any)?.content || (typeof draft === 'string' ? draft : '');

            return (
              <QuestionResultCard
                key={item.question.id}
                questionNumber={item.number}
                questionRevision={item.question}
                responseDraft={item.responseDraft}
                responseMark={item.responseMark}
                grade={item.grade}
                onManualReviewClick={
                  submissionId
                    ? () =>
                        setReviewingItem({
                          question: item.question,
                          submissionId,
                          studentResponse,
                          grade: item.grade,
                        })
                    : undefined
                }
              />
            );
          })
        )}
      </div>

      {/* Manual Grade Review Modal */}
      {reviewingItem && (
        <ManualGradeReview
          isOpen={true}
          attemptId={attempt.id}
          responseSubmissionId={reviewingItem.submissionId}
          expectedAttemptRevision={attempt.revision}
          questionRevision={reviewingItem.question}
          studentResponse={reviewingItem.studentResponse}
          existingGrade={reviewingItem.grade}
          onClose={() => setReviewingItem(null)}
          onGradeRecorded={(outcome) => {
            setReviewingItem(null);
            if (onGradeRecorded) {
              onGradeRecorded(outcome);
            }
          }}
        />
      )}
    </div>
  );
};
