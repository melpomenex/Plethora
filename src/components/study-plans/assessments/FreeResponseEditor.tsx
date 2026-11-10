/**
 * Free Response Question Editor (Short-Answer and Essay).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { RubricEditor } from './RubricEditor';
import type {
  ShortAnswerQuestion,
  EssayQuestion,
  KeyFact,
  AnalyticRubric,
} from '../../../types/assessmentQuestions';

export interface FreeResponseEditorProps {
  question: ShortAnswerQuestion | EssayQuestion;
  onChange: (updated: ShortAnswerQuestion | EssayQuestion) => void;
  disabled?: boolean;
  className?: string;
}

export const FreeResponseEditor: React.FC<FreeResponseEditorProps> = ({
  question,
  onChange,
  disabled = false,
  className = '',
}) => {
  const isEssay = question.kind === 'essay';

  const handleRubricChange = (updatedRubric: AnalyticRubric) => {
    onChange({
      ...question,
      rubric: updatedRubric,
    });
  };

  // Short-Answer Specific Handlers
  const handleReferenceAnswerChange = (referenceAnswer: string) => {
    onChange({
      ...(question as ShortAnswerQuestion),
      referenceAnswer,
    });
  };

  const handleAcceptedAnswersChange = (answersStr: string) => {
    const acceptedAnswers = answersStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onChange({
      ...(question as ShortAnswerQuestion),
      acceptedAnswers,
    });
  };

  const handleAddKeyFact = () => {
    const shortQ = question as ShortAnswerQuestion;
    const newFact: KeyFact = {
      id: `kf_${Date.now()}`,
      text: 'New essential fact',
      required: true,
    };
    onChange({
      ...shortQ,
      keyFacts: [...shortQ.keyFacts, newFact],
    });
  };

  const handleRemoveKeyFact = (kfId: string) => {
    const shortQ = question as ShortAnswerQuestion;
    onChange({
      ...shortQ,
      keyFacts: shortQ.keyFacts.filter((f) => f.id !== kfId),
    });
  };

  const handleUpdateKeyFact = (index: number, updated: KeyFact) => {
    const shortQ = question as ShortAnswerQuestion;
    const nextKeyFacts = [...shortQ.keyFacts];
    nextKeyFacts[index] = updated;
    onChange({
      ...shortQ,
      keyFacts: nextKeyFacts,
    });
  };

  // Essay Specific Handler
  const handleExpectedReasoningChange = (expectedReasoning: string) => {
    onChange({
      ...(question as EssayQuestion),
      expectedReasoning,
    });
  };

  return (
    <div className={`space-y-5 ${className}`}>
      {/* 1. Answer Key / Expected Reasoning */}
      {isEssay ? (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
            Expected Model Reasoning / Standard Solution
          </label>
          <textarea
            rows={4}
            value={(question as EssayQuestion).expectedReasoning}
            disabled={disabled}
            onChange={(e) => handleExpectedReasoningChange(e.target.value)}
            placeholder="Comprehensive description of the expected reasoning, core steps, and conceptual argument…"
            className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
            aria-label="Expected reasoning"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
              Reference Model Answer
            </label>
            <textarea
              rows={3}
              value={(question as ShortAnswerQuestion).referenceAnswer}
              disabled={disabled}
              onChange={(e) => handleReferenceAnswerChange(e.target.value)}
              placeholder="Canonical model answer…"
              className="w-full p-2.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label="Reference answer"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
              Exact Accepted Short Answers (Comma-separated)
            </label>
            <input
              type="text"
              value={(question as ShortAnswerQuestion).acceptedAnswers?.join(', ') || ''}
              disabled={disabled}
              onChange={(e) => handleAcceptedAnswersChange(e.target.value)}
              placeholder="e.g. Raft, Raft Consensus, AppendEntries"
              className="w-full h-8 px-2.5 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              aria-label="Accepted short answers"
            />
          </div>

          {/* Key Facts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                Key Facts Checklist ({(question as ShortAnswerQuestion).keyFacts.length})
              </span>
              {!disabled && (
                <Button variant="outlined" size="sm" onClick={handleAddKeyFact} className="text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Fact
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {(question as ShortAnswerQuestion).keyFacts.map((fact, fIdx) => (
                <div
                  key={fact.id}
                  className="p-2.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 flex items-center gap-3 text-xs"
                >
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={fact.required}
                      disabled={disabled}
                      onChange={(e) =>
                        handleUpdateKeyFact(fIdx, { ...fact, required: e.target.checked })
                      }
                      className="rounded border-surface-300"
                    />
                    <span>Required</span>
                  </label>

                  <input
                    type="text"
                    value={fact.text}
                    disabled={disabled}
                    onChange={(e) =>
                      handleUpdateKeyFact(fIdx, { ...fact, text: e.target.value })
                    }
                    placeholder="Fact description…"
                    className="flex-1 h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                    aria-label={`Key fact ${fIdx + 1} text`}
                  />

                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyFact(fact.id)}
                      className="p-1 text-surface-400 hover:text-red-600"
                      title="Remove fact"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Analytic Rubric */}
      <RubricEditor
        rubric={question.rubric}
        onChange={handleRubricChange}
        isEssay={isEssay}
        disabled={disabled}
      />
    </div>
  );
};
