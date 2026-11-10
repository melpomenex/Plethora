/**
 * Choice Question Editor (Single-Select and Multi-Select).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Plus, Trash, CheckSquare, RadioButton } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type {
  SingleSelectQuestion,
  MultiSelectQuestion,
  QuestionOption,
} from '../../../types/assessmentQuestions';

export interface ChoiceQuestionEditorProps {
  question: SingleSelectQuestion | MultiSelectQuestion;
  onChange: (updated: SingleSelectQuestion | MultiSelectQuestion) => void;
  disabled?: boolean;
  className?: string;
}

export const ChoiceQuestionEditor: React.FC<ChoiceQuestionEditorProps> = ({
  question,
  onChange,
  disabled = false,
  className = '',
}) => {
  const isMulti = question.kind === 'multi-select';

  const handleAddOption = () => {
    if (question.options.length >= 8) return;
    const newId = `opt_${Date.now()}`;
    const newOption: QuestionOption = {
      id: newId,
      text: `Option ${question.options.length + 1}`,
    };
    onChange({
      ...question,
      options: [...question.options, newOption],
    });
  };

  const handleRemoveOption = (optId: string) => {
    if (question.options.length <= 2) return;
    const nextOptions = question.options.filter((o) => o.id !== optId);

    if (isMulti) {
      const multiQ = question as MultiSelectQuestion;
      onChange({
        ...multiQ,
        options: nextOptions,
        correctOptionIds: multiQ.correctOptionIds.filter((id) => id !== optId),
      });
    } else {
      const singleQ = question as SingleSelectQuestion;
      const nextCorrect =
        singleQ.correctOptionId === optId
          ? nextOptions[0]?.id || ''
          : singleQ.correctOptionId;
      onChange({
        ...singleQ,
        options: nextOptions,
        correctOptionId: nextCorrect,
      });
    }
  };

  const handleOptionTextChange = (optId: string, text: string) => {
    const nextOptions = question.options.map((o) =>
      o.id === optId ? { ...o, text } : o
    );
    onChange({ ...question, options: nextOptions });
  };

  const handleToggleCorrectSingle = (optId: string) => {
    onChange({
      ...(question as SingleSelectQuestion),
      correctOptionId: optId,
    });
  };

  const handleToggleCorrectMulti = (optId: string) => {
    const multiQ = question as MultiSelectQuestion;
    const exists = multiQ.correctOptionIds.includes(optId);
    const nextCorrect = exists
      ? multiQ.correctOptionIds.filter((id) => id !== optId)
      : [...multiQ.correctOptionIds, optId].sort();

    onChange({
      ...multiQ,
      correctOptionIds: nextCorrect,
    });
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
          Options &amp; Correct Answer Key (2–8 options)
        </label>
        {!disabled && question.options.length < 8 && (
          <Button variant="outlined" size="sm" onClick={handleAddOption} className="text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Option
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {question.options.map((opt, index) => {
          const isCorrect = isMulti
            ? (question as MultiSelectQuestion).correctOptionIds.includes(opt.id)
            : (question as SingleSelectQuestion).correctOptionId === opt.id;

          return (
            <div
              key={opt.id}
              className={`p-2.5 rounded-lg border transition-all flex items-center gap-3 text-xs ${
                isCorrect
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
              }`}
            >
              {/* Correct answer toggle button */}
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  isMulti
                    ? handleToggleCorrectMulti(opt.id)
                    : handleToggleCorrectSingle(opt.id)
                }
                title={isCorrect ? 'Correct option' : 'Mark as correct'}
                className="p-1 text-surface-400 hover:text-emerald-600 focus:outline-none"
              >
                {isMulti ? (
                  <CheckSquare
                    className={`w-5 h-5 ${isCorrect ? 'text-emerald-600' : 'text-surface-300'}`}
                  />
                ) : (
                  <RadioButton
                    className={`w-5 h-5 ${isCorrect ? 'text-emerald-600' : 'text-surface-300'}`}
                  />
                )}
              </button>

              <span className="font-mono text-[11px] text-surface-400 font-semibold w-4">
                {String.fromCharCode(65 + index)}.
              </span>

              <input
                type="text"
                value={opt.text}
                disabled={disabled}
                onChange={(e) => handleOptionTextChange(opt.id, e.target.value)}
                placeholder={`Option text…`}
                className="flex-1 h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-transparent text-surface-900 dark:text-surface-100"
                aria-label={`Option ${String.fromCharCode(65 + index)} text`}
              />

              {!disabled && question.options.length > 2 && (
                <button
                  type="button"
                  onClick={() => handleRemoveOption(opt.id)}
                  title="Remove option"
                  className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-surface-100 dark:hover:bg-surface-700"
                >
                  <Trash className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isMulti && (question as MultiSelectQuestion).correctOptionIds.length < 2 && (
        <span className="text-[11px] text-amber-600 dark:text-amber-400 block">
          Multi-select questions must have at least 2 correct options selected.
        </span>
      )}
    </div>
  );
};
