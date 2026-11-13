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
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
    useI18n();
    const handleAddCriterion = () => {
        const newCrit: RubricCriterion = {
      id: `crit_${Date.now()}`,
      title: translateRecentFeature("studyPlans.ui.new-evaluation-criterion.e1fe6559"),
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
          <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">{translateRecentFeature("studyPlans.ui.analytic-grading-rubric-var0.eeb6f714", {var0: rubric.criteria.length})}</h4>
        </div>
        {!disabled && (
          <Button variant="outlined" size="sm" onClick={handleAddCriterion} className="text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" />
            {translateRecentFeature("studyPlans.ui.add-criterion.e315b258")}</Button>
        )}
      </div>

      {hasCriterionError && (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          {translateRecentFeature("studyPlans.ui.essay-questions-require-at-l.38b71036")}</p>
      )}

      {/* Expected Concepts */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-surface-700 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.expected-concepts-comma-sepa.2029dd4c")}</label>
        <input
          type="text"
          value={rubric.expectedConcepts.join(', ')}
          disabled={disabled}
          onChange={(e) => handleExpectedConceptsChange(e.target.value)}
          placeholder={translateRecentFeature("studyPlans.ui.e-g-invariant-two-phase-lock.c00f085f")}
          className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30"
          aria-label={translateRecentFeature("studyPlans.ui.expected-concepts.0d5ddb96")}
        />
      </div>

      {/* Grading Constraints */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-surface-700 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.grading-constraints-one-per-.c868c38a")}</label>
        <textarea
          rows={2}
          value={rubric.gradingConstraints.join('\n')}
          disabled={disabled}
          onChange={(e) => handleGradingConstraintsChange(e.target.value)}
          placeholder={translateRecentFeature("studyPlans.ui.e-g-deduct-1-point-if-deadlo.12d77f76")}
          className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30 font-mono"
          aria-label={translateRecentFeature("studyPlans.ui.grading-constraints.76c25bb0")}
        />
      </div>

      {/* Criteria List */}
      <div className="space-y-3">
        {rubric.criteria.map((crit, cIdx) => {
                    return (
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
                  placeholder={translateRecentFeature("studyPlans.ui.criterion-title.cf094970")}
                  className="font-medium text-xs px-2 py-1 rounded border border-surface-200 dark:border-surface-700 flex-1"
                  aria-label={translateRecentFeature("studyPlans.ui.criterion-title.cf094970")}
                />
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-surface-500">{translateRecentFeature("studyPlans.ui.weight.0902d1f6")}</span>
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
                    aria-label={translateRecentFeature("studyPlans.ui.criterion-weight.2da0bf7a")}
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
                  aria-label={translateRecentFeature("studyPlans.ui.criterion-grounding.d1c89a5d")}
                >
                  <option value="reasoning">{translateRecentFeature("studyPlans.ui.reasoning.5a5c723f")}</option>
                  <option value="source">{translateRecentFeature("discoverSites.source")}</option>
                  <option value="presentation">{translateRecentFeature("studyPlans.ui.presentation.838e4ea3")}</option>
                </select>
              </div>

              {!disabled && rubric.criteria.length > 1 && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => handleRemoveCriterion(crit.id)}
                  aria-label={translateRecentFeature("studyPlans.ui.delete-criterion.d99000a1")}
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
              placeholder={translateRecentFeature("studyPlans.ui.detailed-assessment-instruct.5bc31ccc")}
              className="w-full p-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-700/30"
              aria-label={translateRecentFeature("studyPlans.ui.assessment-instructions.b87106cc")}
            />

            {/* Performance Levels 0 to 4 */}
            <div className="space-y-1.5 pl-2 border-l-2 border-surface-200 dark:border-surface-700">
              <span className="text-[11px] font-semibold text-surface-600 dark:text-surface-400 block">
                {translateRecentFeature("studyPlans.ui.performance-levels-0-4-scale.0e6976d8")}</span>
              <div className="space-y-1">
                {(['4', '3', '2', '1', '0'] as const).map((lvl) => (
                  <div key={lvl} className="flex items-center gap-2 text-[11px]">
                    <span className="w-12 font-mono font-bold text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.level-var0.af763f85", {var0: lvl})}</span>
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
                      aria-label={translateRecentFeature("studyPlans.ui.level-var0-description.9ec94616", {var0: lvl})}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
};
