/**
 * Responsive Accessible Examination Runner Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  Flag,
  ArrowLeft,
  CheckCircle,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { StudySourceResolution } from '../../../types/studySource';
import { useAttemptLifecycle } from '../../../lib/study-plans/attempts/useAttemptLifecycle';
import { AttemptTimer } from './AttemptTimer';
import { AttemptProgress } from './AttemptProgress';
import { AttemptSaveStatus } from './AttemptSaveStatus';
import { QuestionNavigation } from './QuestionNavigation';
import { SingleSelectInput } from './SingleSelectInput';
import { MultiSelectInput } from './MultiSelectInput';
import { ClozeInput } from './ClozeInput';
import { FreeResponseInput } from './FreeResponseInput';
import { SubmitAttemptPanel } from './SubmitAttemptPanel';
import { PracticeCheckPanel } from './PracticeCheckPanel';
import { PracticeHintControl } from '../practice/PracticeHintControl';
import { PracticeGuidancePanel } from '../practice/PracticeGuidancePanel';
import { PracticeContextReturn, type PracticeReturnContext } from '../practice/PracticeContextReturn';

export interface AttemptRunnerProps {
  detail: AttemptDetail;
  onComplete: (detail: AttemptDetail) => void;
  onExit: () => void;
  className?: string;
  /** C7-T05 optional return context + tutor hook (practice-only UI). */
  returnContext?: PracticeReturnContext | null;
  onOpenTutor?: () => void;
  onReturnToPlan?: () => void;
  sourceRefs?: Record<string, StudySourceResolution>;
  sourceRefsLoading?: boolean;
}

export const AttemptRunner: React.FC<AttemptRunnerProps> = ({
  detail,
  onComplete,
  onExit,
  className = '',
  returnContext = null,
  onOpenTutor,
  onReturnToPlan,
  sourceRefs = {},
  sourceRefsLoading = false,
}) => {
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [hintLevels, setHintLevels] = useState<Record<string, number>>({});
  const [sourceMaterialOpen, setSourceMaterialOpen] = useState(detail.attempt.mode === 'practice');

  const {
    state,
    selectQuestion,
    updateDraft,
    updateConfidence,
    markQuestion,
    flushResponse,
    acknowledgePracticeCheck,
    submitAttempt,
  } = useAttemptLifecycle({
    detail,
    onAutoSubmit: (completed) => {
      setShowSubmitModal(false);
      onComplete(completed);
    },
  });

  const {
    attempt,
    questions,
    slots,
    selectedIndex,
    remainingSeconds,
    isReadOnly,
    isSubmitting,
    submitError,
    hasUnsavedChanges,
  } = state;

  const currentQuestion: AssessmentQuestionRevision | undefined = questions[selectedIndex];
  const currentSlot = currentQuestion ? slots[currentQuestion.id] : undefined;

  const isExam = attempt.mode === 'exam';
  const isPractice = attempt.mode === 'practice';
  useEffect(() => {
    setSourceMaterialOpen(isPractice);
  }, [currentQuestion?.id, isPractice]);
  const currentHintLevel = currentQuestion ? (hintLevels[currentQuestion.id] ?? 0) : 0;

  const handleFinalSubmit = async () => {
    try {
      const completed = await submitAttempt('user');
      setShowSubmitModal(false);
      onComplete(completed);
    } catch {
      // Error reflected in state.submitError
    }
  };

  const handleToggleSkip = () => {
    if (!currentQuestion || isReadOnly) return;
    const isCurrentlySkipped = currentSlot?.mark === 'skipped';
    markQuestion(currentQuestion.id, isCurrentlySkipped ? 'answered' : 'skipped');
  };

  if (!currentQuestion) {
    return (
      <div className="p-8 text-center text-on-surface-variant dark:text-on-surface-variant-dark">
        No questions available for this assessment.
      </div>
    );
  }

  const qData = currentQuestion.question;
  const questionSourceIds = qData.sourceRefIds ?? [];
  const currentQuestionSources = questionSourceIds
    .map((sourceRefId) => sourceRefs[sourceRefId])
    .filter((source): source is StudySourceResolution => source?.status === 'current');

  return (
    <div
      className={`max-w-4xl mx-auto flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain p-4 sm:p-6 bg-surface dark:bg-surface-dark ${className}`}
      role="main"
      aria-label="Examination Session"
    >
      {/* Top App Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <Button
            variant="text"
            onClick={onExit}
            className="min-h-[44px] min-w-[44px] p-2"
            aria-label="Exit assessment"
          >
            <ArrowLeft size={20} />
          </Button>

          <div>
            <h1 className="text-base sm:text-lg font-bold text-on-surface dark:text-on-surface-dark flex items-center gap-2">
              {isExam ? <GraduationCap size={20} className="text-primary dark:text-primary-dark" /> : <BookOpen size={20} className="text-secondary dark:text-secondary-dark" />}
              {attempt.blueprintTitle || 'Examination Paper'}
            </h1>
            <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark capitalize">
              {attempt.mode} Mode
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <AttemptSaveStatus
            isSaving={currentSlot?.isSaving || false}
            hasUnsavedChanges={hasUnsavedChanges}
            error={currentSlot?.error || null}
            onRetry={currentQuestion ? () => flushResponse(currentQuestion.id) : undefined}
          />

          <AttemptTimer remainingSeconds={remainingSeconds} />

          <Button
            variant="filled"
            onClick={() => setShowSubmitModal(true)}
            disabled={isReadOnly || isSubmitting}
            className="min-h-[44px] min-w-[44px] px-4 font-semibold shadow-sm"
          >
            <CheckCircle size={18} className="mr-1.5 inline" />
            Submit
          </Button>
        </div>
      </header>

      {/* Progress Bar */}
      <AttemptProgress
        currentIndex={selectedIndex}
        totalQuestions={questions.length}
        slots={slots}
      />

      {/* Question Card */}
      <div className="flex-1 bg-surface-container-lowest dark:bg-surface-container-lowest-dark border border-outline-variant/40 rounded-2xl p-5 sm:p-8 shadow-sm space-y-6">
        {/* Question Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-outline-variant/30">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-1 bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark font-bold text-xs rounded-lg">
              Question {selectedIndex + 1}
            </span>
            <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark font-medium">
              {qData.maxPoints} {qData.maxPoints === 1 ? 'Point' : 'Points'}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant capitalize">
              Diff: {qData.difficulty}
            </span>
          </div>

          {/* Skip / Revisit Action */}
          <Button
            variant={currentSlot?.mark === 'skipped' ? 'tonal' : 'text'}
            onClick={handleToggleSkip}
            disabled={isReadOnly}
            className={`min-h-[44px] text-xs font-medium ${
              currentSlot?.mark === 'skipped'
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'text-on-surface-variant'
            }`}
            aria-label={currentSlot?.mark === 'skipped' ? 'Unmark skip' : 'Mark as skipped to review later'}
          >
            <Flag size={16} weight={currentSlot?.mark === 'skipped' ? 'fill' : 'regular'} className="mr-1.5 inline text-amber-500" />
            {currentSlot?.mark === 'skipped' ? 'Skipped (Click to unskip)' : 'Skip for now'}
          </Button>
        </div>

        {questionSourceIds.length > 0 && (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-semibold text-on-surface"
              aria-expanded={sourceMaterialOpen}
              onClick={() => setSourceMaterialOpen((open) => !open)}
            >
              <span className="flex items-center gap-2">
                <BookOpen size={17} className="text-primary" />
                Provided text
                <span className="text-xs font-normal text-on-surface-variant">
                  {currentQuestionSources.length > 0
                    ? `${currentQuestionSources.length} passage${currentQuestionSources.length === 1 ? '' : 's'}`
                    : ''}
                </span>
              </span>
              <span className="text-xs text-primary">
                {sourceMaterialOpen ? 'Hide' : 'Show'}
              </span>
            </button>
            {sourceMaterialOpen && (
              <div className="mt-3 space-y-3 border-t border-outline-variant/30 pt-3">
                {currentQuestionSources.map(({ ref }) => (
                  <article key={ref.id} className="space-y-1.5">
                    <h2 className="text-xs font-semibold text-on-surface">
                      {ref.documentTitle}
                      {ref.sectionLabel ? ` · ${ref.sectionLabel}` : ''}
                    </h2>
                    <blockquote className="whitespace-pre-wrap border-l-2 border-primary/50 pl-3 text-sm leading-relaxed text-on-surface-variant">
                      {ref.excerpt}
                    </blockquote>
                  </article>
                ))}
                {sourceRefsLoading && currentQuestionSources.length === 0 && (
                  <p className="text-sm text-on-surface-variant">Loading the verified passage…</p>
                )}
                {!sourceRefsLoading && currentQuestionSources.length === 0 && (
                  <p className="text-sm text-on-surface-variant">
                    The passage could not be loaded or verified. Check the source in the study plan before answering.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Dynamic Question Input by Kind */}
        {qData.kind === 'single-select' && (
          <SingleSelectInput
            question={qData}
            selectedOptionId={currentSlot?.draft.kind === 'single-select' ? currentSlot.draft.optionId : null}
            confidence={currentSlot?.draft.confidence}
            onChangeOption={(optId) => {
              updateDraft(currentQuestion.id, (prev) => ({
                ...prev,
                kind: 'single-select',
                optionId: optId,
              }));
            }}
            onChangeConfidence={(conf) => updateConfidence(currentQuestion.id, conf)}
            disabled={isReadOnly}
          />
        )}

        {qData.kind === 'multi-select' && (
          <MultiSelectInput
            question={qData}
            selectedOptionIds={currentSlot?.draft.kind === 'multi-select' ? currentSlot.draft.optionIds : []}
            confidence={currentSlot?.draft.confidence}
            onToggleOption={(optId) => {
              updateDraft(currentQuestion.id, (prev) => {
                const prevIds = prev.kind === 'multi-select' ? prev.optionIds : [];
                const nextIds = prevIds.includes(optId)
                  ? prevIds.filter((id) => id !== optId)
                  : [...prevIds, optId];
                return {
                  ...prev,
                  kind: 'multi-select',
                  optionIds: nextIds,
                };
              });
            }}
            onChangeConfidence={(conf) => updateConfidence(currentQuestion.id, conf)}
            disabled={isReadOnly}
          />
        )}

        {qData.kind === 'cloze' && (
          <ClozeInput
            question={qData}
            answers={currentSlot?.draft.kind === 'cloze' ? currentSlot.draft.answers : {}}
            confidence={currentSlot?.draft.confidence}
            onChangeBlank={(blankId, val) => {
              updateDraft(currentQuestion.id, (prev) => {
                const prevAnswers = prev.kind === 'cloze' ? prev.answers : {};
                return {
                  ...prev,
                  kind: 'cloze',
                  answers: {
                    ...prevAnswers,
                    [blankId]: val,
                  },
                };
              });
            }}
            onChangeConfidence={(conf) => updateConfidence(currentQuestion.id, conf)}
            disabled={isReadOnly}
          />
        )}

        {(qData.kind === 'short-answer' || qData.kind === 'essay') && (
          <FreeResponseInput
            question={qData}
            text={
              currentSlot?.draft.kind === 'short-answer' || currentSlot?.draft.kind === 'essay'
                ? currentSlot.draft.text
                : ''
            }
            confidence={currentSlot?.draft.confidence}
            onChangeText={(txt) => {
              updateDraft(currentQuestion.id, (prev) => ({
                ...prev,
                kind: qData.kind as 'short-answer' | 'essay',
                text: txt,
              }));
            }}
            onChangeConfidence={(conf) => updateConfidence(currentQuestion.id, conf)}
            disabled={isReadOnly}
          />
        )}

        {/* Practice Mode Instant Check Panel (Concealed during Exam) */}
        {!isExam && currentSlot && (
          <>
            {isPractice && (
              <>
                <PracticeHintControl
                  hints={qData.hints ?? []}
                  revealed={currentHintLevel}
                  mode={attempt.mode}
                  onReveal={(next) => setHintLevels((prev) => ({ ...prev, [currentQuestion.id]: next }))}
                />
                <PracticeGuidancePanel mode={attempt.mode} onOpenTutor={onOpenTutor} />
              </>
            )}
            <PracticeCheckPanel
              questionRevision={currentQuestion}
              attemptId={attempt.id}
              attemptRevision={attempt.revision}
              slot={currentSlot}
              hintLevel={currentHintLevel}
              onCheckSuccess={acknowledgePracticeCheck}
              disabled={isReadOnly}
            />
          </>
        )}
      </div>

      {/* Navigation Controls and Question Map */}
      <QuestionNavigation
        questions={questions}
        slots={slots}
        selectedIndex={selectedIndex}
        onSelectIndex={selectQuestion}
      />

      <PracticeContextReturn context={returnContext} onReturn={onReturnToPlan} />

      {/* Submit Confirmation Dialog Modal */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
          role="presentation"
        >
          <SubmitAttemptPanel
            totalQuestions={questions.length}
            slots={slots}
            onSubmit={handleFinalSubmit}
            onCancel={() => setShowSubmitModal(false)}
            isSubmitting={isSubmitting}
            submitError={submitError}
          />
        </div>
      )}
    </div>
  );
};
