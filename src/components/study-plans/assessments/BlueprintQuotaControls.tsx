/**
 * Assessment Blueprint Quota & Parameter Controls Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.2
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React, { useMemo } from 'react';
import {
  Sliders,
  Timer,
  BookOpen,
  GraduationCap,
  Sparkle,
} from '@phosphor-icons/react';
import type {
  AssessmentConfigV1,
  AssessmentMode,
  Difficulty,
  QuestionKind,
} from '../../../types/assessmentQuestions';
import {
  allocateLargestRemainder,
  KIND_STABLE_ORDER,
  DIFFICULTY_STABLE_ORDER,
  type AllocationDimension,
} from '../../../lib/study-plans/assessments/quotaPlanner';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface BlueprintQuotaControlsProps {
  config: AssessmentConfigV1;
  onChange: (updated: AssessmentConfigV1) => void;
  disabled?: boolean;
}

const KIND_LABELS: Record<QuestionKind, string> = {
  'single-select': 'studyPlans.ui.single-choice.2df25485',
  'multi-select': 'studyPlans.ui.multi-choice.9e905ca2',
  cloze: 'studyPlans.ui.cloze-fill-in-blank.54e91d0d',
  'short-answer': 'studyPlans.ui.short-answer.514e62aa',
  essay: 'studyPlans.ui.essay-long-form.ac24f40b',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'studyPlans.ui.introductory-1.46ebf45c',
  2: 'studyPlans.ui.easy-2.5f50e294',
  3: 'studyPlans.ui.medium-3.ae91dbbb',
  4: 'studyPlans.ui.hard-4.37e122dd',
  5: 'studyPlans.ui.expert-5.091e5eaa',
};

export const BlueprintQuotaControls: React.FC<BlueprintQuotaControlsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
        useI18n();
        // Live normalized calculation
  const normalizedPreview = useMemo(() => {
    try {
      const typeEntries: Array<AllocationDimension<QuestionKind>> = [];
      for (const kind of KIND_STABLE_ORDER) {
        const weight = config.typeWeights[kind] ?? 0;
        if (weight > 0) typeEntries.push({ key: kind, weight });
      }
      const typeAlloc = allocateLargestRemainder(
        config.requestedCount,
        typeEntries,
        KIND_STABLE_ORDER
      );

      const diffEntries: Array<AllocationDimension<Difficulty>> = [];
      for (const diff of DIFFICULTY_STABLE_ORDER) {
        const weight = config.difficultyWeights[diff] ?? 0;
        if (weight > 0) diffEntries.push({ key: diff, weight });
      }
      const diffAlloc = allocateLargestRemainder(
        config.requestedCount,
        diffEntries,
        DIFFICULTY_STABLE_ORDER
      );

      return { typeAlloc, diffAlloc };
    } catch {
      return null;
    }
  }, [config]);

  const handleModeChange = (mode: AssessmentMode) => {
    onChange({
      ...config,
      mode,
      timeLimitSeconds: mode === 'exam' ? config.timeLimitSeconds || 1800 : null,
    });
  };

  const handleCountChange = (count: number) => {
    const validCount = Math.max(1, Math.min(40, count));
    onChange({ ...config, requestedCount: validCount });
  };

  const handleTypeWeightChange = (kind: QuestionKind, weight: number) => {
    onChange({
      ...config,
      typeWeights: {
        ...config.typeWeights,
        [kind]: Math.max(0, weight),
      },
    });
  };

  const handleDiffWeightChange = (diff: Difficulty, weight: number) => {
    onChange({
      ...config,
      difficultyWeights: {
        ...config.difficultyWeights,
        [diff]: Math.max(0, weight),
      },
    });
  };

  const handlePointsChange = (kind: QuestionKind, points: number) => {
    onChange({
      ...config,
      pointsByKind: {
        ...config.pointsByKind,
        [kind]: Math.max(1, Math.min(20, points)),
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. Mode Selection */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
          {translateRecentFeature("studyPlans.ui.assessment-mode.088ad919")}</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleModeChange('exam')}
            className={`min-h-11 p-3 rounded-xl border text-left transition-all ${
              config.mode === 'exam'
                ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 ring-1 ring-primary-500'
                : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 hover:bg-surface-100 dark:hover:bg-surface-700/50'
            }`}
          >
            <div className="flex items-center gap-2 font-medium text-surface-900 dark:text-surface-100 text-sm">
              <GraduationCap className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              {translateRecentFeature("studyPlans.ui.examination.4be2c338")}</div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
              {translateRecentFeature("studyPlans.ui.timed-strict-scoring-no-hint.1d001347")}</p>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => handleModeChange('practice')}
            className={`p-3 rounded-xl border text-left transition-all ${
              config.mode === 'practice'
                ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 ring-1 ring-primary-500'
                : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 hover:bg-surface-100 dark:hover:bg-surface-700/50'
            }`}
          >
            <div className="flex items-center gap-2 font-medium text-surface-900 dark:text-surface-100 text-sm">
              <BookOpen className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              {translateRecentFeature("studyPlans.ui.practice.e7940d9b")}</div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
              {translateRecentFeature("studyPlans.ui.untimed-hints-available-targ.444b8b38")}</p>
          </button>

          <button
            type="button"
            disabled
            className="p-3 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-100/50 dark:bg-surface-800/20 text-left opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center justify-between text-sm font-medium text-surface-500">
              <span>{translateRecentFeature("studyPlans.ui.diagnostic.891ca684")}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 font-normal">
                {translateRecentFeature("studyPlans.ui.change-7.d2dbac31")}</span>
            </div>
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
              {translateRecentFeature("studyPlans.ui.curriculum-placement-prerequ.8684b697")}</p>
          </button>
        </div>
      </div>

      {/* 2. Question Quota Count */}
      <div className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">{translateRecentFeature("studyPlans.ui.total-questions-quota-var0.d3b45757", {var0: config.requestedCount})}</span>
          </div>
          <span className="text-xs text-surface-500 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.allowed-range-1-to-40.dd594d92")}</span>
        </div>
        <input
          type="range"
          min={1}
          max={40}
          value={config.requestedCount}
          disabled={disabled}
          onChange={(e) => handleCountChange(Number(e.target.value))}
          className="w-full h-2 bg-surface-200 dark:bg-surface-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
          aria-label={translateRecentFeature("studyPlans.ui.question-count-slider.85fbfba4")}
        />
      </div>

      {/* 3. Question Formats & Points */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.format-distribution-max-poin.6c1e2dc0")}</h4>
          <span className="text-xs text-surface-400">{translateRecentFeature("studyPlans.ui.relative-weights-points-per-.26a7d54c")}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {KIND_STABLE_ORDER.map((kind) => {
                        const weight = config.typeWeights[kind] ?? 0;
            const points = config.pointsByKind[kind] ?? 1;
            const allocatedCount = normalizedPreview?.typeAlloc.get(kind) ?? 0;

            return (
              <div
                key={kind}
                className="p-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium text-surface-900 dark:text-surface-100 block truncate">
                    {translateRecentFeature(KIND_LABELS[kind])}
                  </span>
                  <span className="text-[11px] text-primary-600 dark:text-primary-400 font-mono">{translateRecentFeature("studyPlans.ui.allocated-var0-questions.04a6c86e", {var0: allocatedCount})}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1" title={translateRecentFeature("studyPlans.ui.relative-weight.1fe821d9")}>
                    <span className="text-[10px] text-surface-400">{translateRecentFeature("studyPlans.ui.wt.ea407251")}</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={weight}
                      disabled={disabled}
                      onChange={(e) => handleTypeWeightChange(kind, Number(e.target.value))}
                      className="w-12 h-7 px-1.5 text-xs text-center rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                      aria-label={translateRecentFeature("studyPlans.ui.var0-weight.d32922c4", {var0: translateRecentFeature(KIND_LABELS[kind])})}
                    />
                  </div>
                  <div className="flex items-center gap-1" title={translateRecentFeature("studyPlans.ui.points-1-20.5bae3cf6")}>
                    <span className="text-[10px] text-surface-400">{translateRecentFeature("studyPlans.ui.pts.22bb2ac1")}</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={points}
                      disabled={disabled}
                      onChange={(e) => handlePointsChange(kind, Number(e.target.value))}
                      className="w-12 h-7 px-1.5 text-xs text-center rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                      aria-label={translateRecentFeature("studyPlans.ui.var0-points.0bcbc704", {var0: translateRecentFeature(KIND_LABELS[kind])})}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Difficulties Distribution */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
          {translateRecentFeature("studyPlans.ui.difficulty-distribution.c12b3242")}</h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {DIFFICULTY_STABLE_ORDER.map((diff) => {
                        const weight = config.difficultyWeights[diff] ?? 0;
            const allocatedCount = normalizedPreview?.diffAlloc.get(diff) ?? 0;

            return (
              <div
                key={diff}
                className="p-2.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 text-center"
              >
                <span className="text-xs font-medium text-surface-800 dark:text-surface-200 block">
                  {translateRecentFeature(DIFFICULTY_LABELS[diff])}
                </span>
                <span className="text-[11px] text-primary-600 dark:text-primary-400 font-mono block mt-0.5">{translateRecentFeature("studyPlans.ui.var0-items.54ffb798", {var0: allocatedCount})}</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={weight}
                  disabled={disabled}
                  onChange={(e) => handleDiffWeightChange(diff, Number(e.target.value))}
                  className="w-14 h-6 text-xs text-center mt-1.5 rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                  aria-label={translateRecentFeature("studyPlans.ui.difficulty-var0-weight.ab0892b3", {var0: diff})}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Exam Timer & Knowledge Policy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        {config.mode === 'exam' && (
          <div className="p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-2">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">
                {translateRecentFeature("studyPlans.ui.exam-time-limit-minutes.a11298ef")}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={240}
                value={Math.round((config.timeLimitSeconds ?? 1800) / 60)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...config,
                    timeLimitSeconds: Math.max(300, Math.min(14400, Number(e.target.value) * 60)),
                  })
                }
                className="w-20 h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                aria-label={translateRecentFeature("studyPlans.ui.exam-time-limit-in-minutes.bec455e9")}
              />
              <span className="text-xs text-surface-500">{translateRecentFeature("studyPlans.ui.var0-mins-range-5-to-240-min.29acc34e", {var0: Math.round((config.timeLimitSeconds ?? 1800) / 60)})}</span>
            </div>
          </div>
        )}

        <div className="p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkle className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">
              {translateRecentFeature("studyPlans.ui.knowledge-policy.e386ba3b")}</span>
          </div>
          <select
            value={config.knowledgePolicy}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...config,
                knowledgePolicy: e.target.value as 'source-only' | 'source-plus-model-knowledge' | 'model-only',
              })
            }
            className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
            aria-label={translateRecentFeature("studyPlans.ui.knowledge-policy-selector.11b39538")}
          >
            <option value="source-only">{translateRecentFeature("studyPlans.ui.source-only-strict-grounding.7511baad")}</option>
            <option value="source-plus-model-knowledge">
              {translateRecentFeature("studyPlans.ui.source-plus-model-knowledge-.72a1e588")}</option>
            {config.mode !== 'exam' && (
              <option value="model-only">
                {translateRecentFeature("studyPlans.ui.model-only-unverified-self-c.b132c8e3")}</option>
            )}
          </select>
          {config.knowledgePolicy === 'model-only' && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {translateRecentFeature("studyPlans.ui.unverified-results-never-bec.7dd1c06a")}</p>
          )}
        </div>
      </div>
    </div>
  );
};
