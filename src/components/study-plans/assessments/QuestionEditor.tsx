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

export interface QuestionEditorProps {
  initialQuestion: AssessmentQuestion;
  availableSourceRefs?: StudySourceRefV1[];
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
  onSave,
  onClose,
  isSaving = false,
}) => {
  const [question, setQuestion] = useState<AssessmentQuestion>(initialQuestion);
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

  const handleSaveClick = async () => {
    if (!validationResult.valid) {
      setErrorBanner('Please resolve all validation constraints before saving.');
      return;
    }
    setErrorBanner(null);
    try {
      await onSave(question);
      onClose();
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to save question');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Question Editor"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">
              Edit Question: <span className="uppercase text-xs font-mono ml-1 px-2 py-0.5 rounded bg-surface-200 dark:bg-surface-700">{question.kind}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
            aria-label="Close question editor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
                Question Prompt (1–2000 chars)
              </label>
              <span className="text-xs text-surface-400 font-mono">
                {question.prompt.length} / 2000
              </span>
            </div>
            <textarea
              rows={3}
              value={question.prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="Enter the question text / problem statement…"
              className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label="Question prompt"
            />
          </div>

          {/* 2. Metadata Grid: Difficulty, Max Points, Application Level */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">Difficulty</label>
              <select
                value={question.difficulty}
                onChange={(e) => handleDifficultyChange(Number(e.target.value) as Difficulty)}
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                aria-label="Question difficulty"
              >
                <option value={1}>1 — Introductory</option>
                <option value={2}>2 — Easy</option>
                <option value={3}>3 — Medium</option>
                <option value={4}>4 — Hard</option>
                <option value={5}>5 — Expert</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">Max Points (1–20)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={question.maxPoints}
                onChange={(e) => handleMaxPointsChange(Number(e.target.value))}
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                aria-label="Question max points"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-surface-500 block">Cognitive Level</label>
              <select
                value={question.applicationLevel}
                onChange={(e) =>
                  handleApplicationLevelChange(e.target.value as ApplicationLevel)
                }
                className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 capitalize"
                aria-label="Cognitive level"
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
          />

          {/* 5. Precommitted Hints (0..3) */}
          <div className="space-y-2 p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-300">
                  Precommitted Hints ({question.hints.length} / 3 max)
                </span>
              </div>
              {question.hints.length < 3 && (
                <button
                  type="button"
                  onClick={handleAddHint}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Hint
                </button>
              )}
            </div>

            {question.hints.length === 0 ? (
              <span className="text-[11px] text-surface-400 block italic">
                No hints precommitted. Hints can only be revealed in Practice mode.
              </span>
            ) : (
              <div className="space-y-2">
                {question.hints.map((hint, hIdx) => (
                  <div key={`hint-${hIdx}`} className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-400 w-12 font-mono">
                      HINT {hIdx + 1}:
                    </span>
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => handleHintChange(hIdx, e.target.value)}
                      placeholder="Hint text (up to 500 characters, do not leak answer)…"
                      className="flex-1 h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                      aria-label={`Hint ${hIdx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveHint(hIdx)}
                      className="p-1 text-surface-400 hover:text-red-600"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6. Explanation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                Pedagogical Explanation &amp; Rationale (0–4000 chars)
              </label>
              <span className="text-xs text-surface-400 font-mono">
                {question.explanation.length} / 4000
              </span>
            </div>
            <textarea
              rows={3}
              value={question.explanation}
              onChange={(e) => handleExplanationChange(e.target.value)}
              placeholder="Explain why the answer is correct and cite key concepts…"
              className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label="Pedagogical explanation"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
          <Button variant="text" size="sm" onClick={onClose}>
            Cancel
          </Button>

          <Button
            variant="filled"
            size="sm"
            onClick={handleSaveClick}
            disabled={!validationResult.valid || isSaving}
          >
            <FloppyDisk className="w-4 h-4 mr-1.5" />
            {isSaving ? 'Saving…' : 'Save Question'}
          </Button>
        </div>
      </div>
    </div>
  );
};
