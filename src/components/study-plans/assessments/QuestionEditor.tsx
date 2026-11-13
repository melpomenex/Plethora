/**
 * Master Question Authoring & Editing Modal Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React, { useState, useMemo } from 'react';
import {
  Pencil,
  FloppyDisk,
  X,
  Lightbulb,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { ChoiceQuestionEditor } from './ChoiceQuestionEditor';
import { ClozeQuestionEditor } from './ClozeQuestionEditor';
import { FreeResponseEditor } from './FreeResponseEditor';
import { QuestionSourceEditor } from './QuestionSourceEditor';
import { QuestionValidationIssues } from './QuestionValidationIssues';
import { validateAssessmentQuestion } from '../../../lib/study-plans/assessments/questionValidation';
import type {
  AssessmentQuestion,
  Difficulty,
  ApplicationLevel,
} from '../../../types/assessmentQuestions';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { ExternalSnapshot } from '../../../lib/study-plans/webresearch/snapshots';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface QuestionEditorProps {
  initialQuestion: AssessmentQuestion;
  availableSourceRefs?: StudySourceRefV1[];
  availableExternalSnapshots?: ExternalSnapshot[];
  onSave: (question: AssessmentQuestion) => Promise<void>;
  onClose: () => void;
  isSaving?: boolean;
}

const APPLICATION_LEVELS: ApplicationLevel[] = [
  'recall',
  'comprehension',
  'application',
  'multi-step-reasoning',
];

export const QuestionEditor: React.FC<QuestionEditorProps> = ({
  initialQuestion,
  availableSourceRefs,
  availableExternalSnapshots = [],
  onSave,
  onClose,
  isSaving = false,
}) => {
    useI18n();
    const [question, setQuestionState] = useState<AssessmentQuestion>(initialQuestion);
  const setQuestion: React.Dispatch<React.SetStateAction<AssessmentQuestion>> = (update) => {
    setQuestionState((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      const hasExternalEvidence = (current.externalSnapshotIds?.length ?? 0) > 0 ||
        (next.externalSnapshotIds?.length ?? 0) > 0;
      const evidenceBasis = (value: AssessmentQuestion) => JSON.stringify({
        ...value,
        externalEvidenceReviewed: false,
        externalSnapshotIds: [],
        sourceRefIds: [],
      });
      if (
        hasExternalEvidence &&
        current.externalEvidenceReviewed &&
        evidenceBasis(current) !== evidenceBasis(next)
      ) {
        return { ...next, externalEvidenceReviewed: false };
      }
      return next;
    });
  };
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Live validation
  const validationResult = useMemo(
    () => validateAssessmentQuestion(question),
    [question]
  );

  const handlePromptChange = (prompt: string) => {
    setQuestion((prev) => ({ ...prev, prompt }));
  };

  const handleExplanationChange = (explanation: string) => {
    setQuestion((prev) => ({ ...prev, explanation }));
  };

  const handleDifficultyChange = (difficulty: Difficulty) => {
    setQuestion((prev) => ({ ...prev, difficulty }));
  };

  const handleMaxPointsChange = (maxPoints: number) => {
    setQuestion((prev) => ({ ...prev, maxPoints: Math.max(1, Math.min(20, maxPoints)) }));
  };

  const handleApplicationLevelChange = (applicationLevel: ApplicationLevel) => {
    setQuestion((prev) => ({ ...prev, applicationLevel }));
  };

  // Hints Management (0..3 hints)
  const handleAddHint = () => {
    if (question.hints.length >= 3) return;
    setQuestion((prev) => ({
      ...prev,
      hints: [...prev.hints, 'New precommitted hint'],
    }));
  };

  const handleRemoveHint = (index: number) => {
    setQuestion((prev) => ({
      ...prev,
      hints: prev.hints.filter((_, i) => i !== index),
    }));
  };

  const handleHintChange = (index: number, text: string) => {
    const nextHints = [...question.hints];
    nextHints[index] = text;
    setQuestion((prev) => ({ ...prev, hints: nextHints }));
  };

  const handleSourcesChange = (sourceRefIds: string[]) => {
    setQuestion((prev) => ({ ...prev, sourceRefIds }));
  };

  const handleExternalSourcesChange = (externalSnapshotIds: string[]) => {
    setQuestion((prev) => ({ ...prev, externalSnapshotIds, externalEvidenceReviewed: false }));
  };

  const handleSaveClick = async () => {
    if (!validationResult.valid) {
      setErrorBanner(translateRecentFeature("studyPlans.ui.please-resolve-all-validatio.0491fc5d"));
      return;
    }
    if ((question.externalSnapshotIds ?? []).some((snapshotId) => {
      const snapshot = availableExternalSnapshots.find((item) => item.id === snapshotId);
      return snapshot?.status !== 'accepted';
    })) {
      setErrorBanner(translateRecentFeature("studyPlans.ui.a-cited-web-source-is-stale-.b1337eb5"));
      return;
    }
    if ((question.externalSnapshotIds?.length ?? 0) > 0 && !question.externalEvidenceReviewed) {
      setErrorBanner(translateRecentFeature("studyPlans.ui.review-the-saved-web-excerpt.376c88a8"));
      return;
    }
    setErrorBanner(null);
    try {
      await onSave(question);
      onClose();
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  return (
    <div
      className="adaptive-dialog-layer bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={translateRecentFeature("studyPlans.ui.question-editor.91ccdabb")}
    >
      <div className="adaptive-dialog-panel adaptive-dialog-centered study-plans-dialog-wide w-full max-w-3xl flex flex-col rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">
              {translateRecentFeature("studyPlans.ui.edit-question.df2c5705")}<span className="uppercase text-xs font-mono ml-1 px-2 py-0.5 rounded bg-surface-200 dark:bg-surface-700">{question.kind}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
            aria-label={translateRecentFeature("studyPlans.ui.close-question-editor.510e7f11")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="adaptive-dialog-body flex-1 p-4 sm:p-6 space-y-6">
          {errorBanner && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {errorBanner}
            </div>
          )}

          {/* Validation Issues Alert */}
          <QuestionValidationIssues issues={validationResult.issues} />

          {/* 1. Prompt */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {translateRecentFeature("studyPlans.ui.question-prompt-1-2000-chars.02020d65")}</label>
              <span className="text-xs text-surface-400 font-mono">{translateRecentFeature("studyPlans.ui.var0-2000.338b3d13", {var0: question.prompt.length})}</span>
            </div>
            <textarea
              rows={3}
              value={question.prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder={translateRecentFeature("studyPlans.ui.enter-the-question-text-prob.d8603420")}
              className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label={translateRecentFeature("studyPlans.ui.question-prompt.ef3be8d2")}
            />
          </div>

          {/* 2. Metadata Grid: Difficulty, Max Points, Application Level */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">{translateRecentFeature("tagSuggestions.category.difficulty")}</label>
              <select
                value={question.difficulty}
                onChange={(e) => handleDifficultyChange(Number(e.target.value) as Difficulty)}
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                aria-label={translateRecentFeature("studyPlans.ui.question-difficulty.23d6b78b")}
              >
                <option value={1}>{translateRecentFeature("studyPlans.ui.1-introductory.6c5fe8d5")}</option>
                <option value={2}>{translateRecentFeature("studyPlans.ui.2-easy.477202db")}</option>
                <option value={3}>{translateRecentFeature("studyPlans.ui.3-medium.a687f6c2")}</option>
                <option value={4}>{translateRecentFeature("studyPlans.ui.4-hard.c0dece3c")}</option>
                <option value={5}>{translateRecentFeature("studyPlans.ui.5-expert.bd2a56b6")}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">{translateRecentFeature("studyPlans.ui.max-points-1-20.e76ff571")}</label>
              <input
                type="number"
                min={1}
                max={20}
                value={question.maxPoints}
                onChange={(e) => handleMaxPointsChange(Number(e.target.value))}
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                aria-label={translateRecentFeature("studyPlans.ui.question-max-points.9d3c4c2c")}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">{translateRecentFeature("studyPlans.ui.cognitive-level.93deb07e")}</label>
              <select
                value={question.applicationLevel}
                onChange={(e) =>
                  handleApplicationLevelChange(e.target.value as ApplicationLevel)
                }
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 capitalize"
                aria-label={translateRecentFeature("studyPlans.ui.cognitive-level.d03a2582")}
              >
                {APPLICATION_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl.replace('-', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Kind-Specific Editor */}
          <div className="pt-2">
            {(question.kind === 'single-select' || question.kind === 'multi-select') && (
              <ChoiceQuestionEditor
                question={question}
                onChange={(updated) => setQuestion(updated)}
              />
            )}

            {question.kind === 'cloze' && (
              <ClozeQuestionEditor
                question={question}
                onChange={(updated) => setQuestion(updated)}
              />
            )}

            {(question.kind === 'short-answer' || question.kind === 'essay') && (
              <FreeResponseEditor
                question={question}
                onChange={(updated) => setQuestion(updated)}
              />
            )}
          </div>

          {/* 4. Grounding Sources */}
          <QuestionSourceEditor
            selectedSourceRefIds={question.sourceRefIds}
            availableSourceRefs={availableSourceRefs}
            onChange={handleSourcesChange}
            selectedExternalSnapshotIds={question.externalSnapshotIds ?? []}
            availableExternalSnapshots={availableExternalSnapshots}
            externalEvidenceReviewed={question.externalEvidenceReviewed ?? false}
            onExternalChange={handleExternalSourcesChange}
            onExternalEvidenceReviewedChange={(externalEvidenceReviewed) =>
              setQuestion((prev) => ({ ...prev, externalEvidenceReviewed }))
            }
          />

          {/* 5. Precommitted Hints (0..3) */}
          <div className="space-y-2 p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.precommitted-hints-var0-3-ma.da235934", {var0: question.hints.length})}</span>
              </div>
              {question.hints.length < 3 && (
                <button
                  type="button"
                  onClick={handleAddHint}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {translateRecentFeature("studyPlans.ui.add-hint.48d19d21")}</button>
              )}
            </div>

            {question.hints.length === 0 ? (
              <span className="text-[11px] text-surface-400 block italic">
                {translateRecentFeature("studyPlans.ui.no-hints-precommitted-hints-.4f2362a6")}</span>
            ) : (
              <div className="space-y-2">
                {question.hints.map((hint, hIdx) => {
                                    return (
                  <div key={`hint-${hIdx}`} className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-400 w-12 font-mono">{translateRecentFeature("studyPlans.ui.hint-var0.0b06f8d9", {var0: hIdx + 1})}</span>
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => handleHintChange(hIdx, e.target.value)}
                      placeholder={translateRecentFeature("studyPlans.ui.hint-text-up-to-500-characte.df8bcd0b")}
                      className="flex-1 h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                      aria-label={translateRecentFeature("studyPlans.ui.hint-var0.6962d5e7", {var0: hIdx + 1})}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveHint(hIdx)}
                      className="p-1 text-surface-400 hover:text-red-600"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
                })}
              </div>
            )}
          </div>

          {/* 6. Explanation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {translateRecentFeature("studyPlans.ui.pedagogical-explanation-rati.ee10ab78")}</label>
              <span className="text-xs text-surface-400 font-mono">{translateRecentFeature("studyPlans.ui.var0-4000.a8b9b2aa", {var0: question.explanation.length})}</span>
            </div>
            <textarea
              rows={3}
              value={question.explanation}
              onChange={(e) => handleExplanationChange(e.target.value)}
              placeholder={translateRecentFeature("studyPlans.ui.explain-why-the-answer-is-co.fe643269")}
              className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label={translateRecentFeature("studyPlans.ui.pedagogical-explanation.ae788e85")}
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="adaptive-dialog-footer flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
          <Button variant="text" size="sm" onClick={onClose}>
            {translateRecentFeature("common.cancel")}</Button>

          <Button
            variant="filled"
            size="sm"
            onClick={handleSaveClick}
            disabled={!validationResult.valid || isSaving}
          >
            <FloppyDisk className="w-4 h-4 mr-1.5" />
            {isSaving ? translateRecentFeature("studyPlans.ui.saving.24ab8181") : translateRecentFeature("studyPlans.ui.save-question.9fba4e26")}
          </Button>
        </div>
      </div>
    </div>
  );
};
