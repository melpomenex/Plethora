/**
 * Analytic Grading Rubric Editor Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §6
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Scales, Plus, Trash } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type {
  AnalyticRubric,
  RubricCriterion,
} from '../../../types/assessmentQuestions';

export interface RubricEditorProps {
  rubric: AnalyticRubric;
  onChange: (updated: AnalyticRubric) => void;
  isEssay?: boolean;
  disabled?: boolean;
  className?: string;
}

export const RubricEditor: React.FC<RubricEditorProps> = ({
  rubric,
  onChange,
  isEssay = false,
  disabled = false,
  className = '',
}) => {
  const handleAddCriterion = () => {
    const newCrit: RubricCriterion = {
      id: `crit_${Date.now()}`,
      title: 'New Evaluation Criterion',
      assessmentInstruction: 'Evaluate candidate response thoroughly against this dimension.',
      weight: 1,
      grounding: 'reasoning',
      sourceRefIds: [],
      keyFactIds: [],
      levels: {
        '0': 'No evidence or incorrect reasoning.',
        '1': 'Minimal evidence with major misconceptions.',
        '2': 'Partial demonstration with notable gaps.',
        '3': 'Competent explanation addressing core aspects.',
        '4': 'Exemplary reasoning with clear, rigorous detail.',
      },
    };
    onChange({
      ...rubric,
      criteria: [...rubric.criteria, newCrit],
    });
  };

  const handleRemoveCriterion = (critId: string) => {
    onChange({
      ...rubric,
      criteria: rubric.criteria.filter((c) => c.id !== critId),
    });
  };

  const handleUpdateCriterion = (index: number, updated: RubricCriterion) => {
    const nextCriteria = [...rubric.criteria];
    nextCriteria[index] = updated;
    onChange({ ...rubric, criteria: nextCriteria });
  };

  const handleExpectedConceptsChange = (val: string) => {
    const concepts = val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onChange({ ...rubric, expectedConcepts: concepts });
  };

  const handleGradingConstraintsChange = (val: string) => {
    const constraints = val
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onChange({ ...rubric, gradingConstraints: constraints });
  };

  const hasCriterionError = isEssay && rubric.criteria.length < 2;

  return (
    <div
      className={`p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-4 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scales className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            Analytic Grading Rubric ({rubric.criteria.length} Criteria)
          </h4>
        </div>
        {!disabled && (
          <Button variant="outlined" size="sm" onClick={handleAddCriterion} className="text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Criterion
          </Button>
        )}
      </div>

      {hasCriterionError && (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          Essay questions require at least 2 rubric criteria.
        </p>
      )}

      {/* Expected Concepts */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-surface-700 dark:text-surface-300">
          Expected Concepts (comma separated)
        </label>
        <input
          type="text"
          value={rubric.expectedConcepts.join(', ')}
          disabled={disabled}
          onChange={(e) => handleExpectedConceptsChange(e.target.value)}
          placeholder="e.g. Invariant, Two-phase locking, Serializability"
          className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30"
          aria-label="Expected Concepts"
        />
      </div>

      {/* Grading Constraints */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-surface-700 dark:text-surface-300">
          Grading Constraints (one per line)
        </label>
        <textarea
          rows={2}
          value={rubric.gradingConstraints.join('\n')}
          disabled={disabled}
          onChange={(e) => handleGradingConstraintsChange(e.target.value)}
          placeholder="e.g. Deduct 1 point if deadlock risk is not mentioned."
          className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30 font-mono"
          aria-label="Grading Constraints"
        />
      </div>

      {/* Criteria List */}
      <div className="space-y-3">
        {rubric.criteria.map((crit, cIdx) => (
          <div
            key={crit.id}
            className="p-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={crit.title}
                  disabled={disabled}
                  onChange={(e) =>
                    handleUpdateCriterion(cIdx, { ...crit, title: e.target.value })
                  }
                  placeholder="Criterion title"
                  className="font-medium text-xs px-2 py-1 rounded border border-surface-200 dark:border-surface-700 flex-1"
                  aria-label="Criterion title"
                />
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-surface-500">Weight:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={crit.weight}
                    disabled={disabled}
                    onChange={(e) =>
                      handleUpdateCriterion(cIdx, {
                        ...crit,
                        weight: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)),
                      })
                    }
                    className="w-14 px-1.5 py-0.5 text-xs text-center rounded border border-surface-200 dark:border-surface-700"
                    aria-label="Criterion weight"
                  />
                </div>
                <select
                  value={crit.grounding}
                  disabled={disabled}
                  onChange={(e) =>
                    handleUpdateCriterion(cIdx, {
                      ...crit,
                      grounding: e.target.value as 'source' | 'reasoning' | 'presentation',
                    })
                  }
                  className="px-2 py-1 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700"
                  aria-label="Criterion grounding"
                >
                  <option value="reasoning">Reasoning</option>
                  <option value="source">Source</option>
                  <option value="presentation">Presentation</option>
                </select>
              </div>

              {!disabled && rubric.criteria.length > 1 && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => handleRemoveCriterion(crit.id)}
                  aria-label="Delete criterion"
                  className="text-rose-500 hover:text-rose-600 p-1"
                >
                  <Trash className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            <textarea
              rows={2}
              value={crit.assessmentInstruction}
              disabled={disabled}
              onChange={(e) =>
                handleUpdateCriterion(cIdx, { ...crit, assessmentInstruction: e.target.value })
              }
              placeholder="Detailed assessment instructions for grading this criterion..."
              className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30"
              aria-label="Assessment instructions"
            />

            {/* Performance Levels 0 to 4 */}
            <div className="space-y-1.5 pl-2 border-l-2 border-surface-200 dark:border-surface-700">
              <span className="text-[11px] font-semibold text-surface-600 dark:text-surface-400 block">
                Performance Levels (0–4 scale):
              </span>
              <div className="space-y-1">
                {(['4', '3', '2', '1', '0'] as const).map((lvl) => (
                  <div key={lvl} className="flex items-center gap-2 text-[11px]">
                    <span className="w-12 font-mono font-bold text-surface-600 dark:text-surface-300">
                      Level {lvl}:
                    </span>
                    <input
                      type="text"
                      value={crit.levels?.[lvl] ?? ''}
                      disabled={disabled}
                      onChange={(e) => {
                        const nextLevels = {
                          ...(crit.levels || {
                            '0': '',
                            '1': '',
                            '2': '',
                            '3': '',
                            '4': '',
                          }),
                          [lvl]: e.target.value,
                        };
                        handleUpdateCriterion(cIdx, { ...crit, levels: nextLevels });
                      }}
                      className="flex-1 h-6 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/20"
                      aria-label={`Level ${lvl} description`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
