/**
 * Curriculum Generation Progress & Stepper Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React, { useState } from 'react';
import {
  SpinnerGap,
  CheckCircle,
  Pause,
  Play,
  XCircle,
  Warning,
  Hourglass,
  ListNumbers,
  GitFork,
  FloppyDisk,
  TreeStructure,
} from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type { StudyJobProgress, StudyJobStatus } from '../../lib/study-plans/generation/types';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export type GeneratorStatus = StudyJobStatus | 'idle' | 'cancelling' | 'paused' | 'running';

export interface GenerationProgressProps {
  progress: StudyJobProgress | null;
  status: GeneratorStatus;
  topicCount?: number;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  isCancelling?: boolean;
}

interface StepInfo {
  index: number;
  labelKey: string;
  subtextKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const STAGES: StepInfo[] = [
  {
    index: 0,
    labelKey: 'studyPlans.ui.decomposing-topics.53033910',
    subtextKey: 'studyPlans.ui.extracting-grounded-core-top.9bdcbd64',
    icon: ListNumbers,
  },
  {
    index: 1,
    labelKey: 'studyPlans.ui.inferring-prerequisites.4a71ef60',
    subtextKey: 'studyPlans.ui.analyzing-prerequisite-depen.2dee0d8b',
    icon: GitFork,
  },
  {
    index: 2,
    labelKey: 'studyPlans.ui.validating-graph-ordering.801c8e18',
    subtextKey: 'studyPlans.ui.enforcing-kahn-cycle-pruning.f6a1e15a',
    icon: TreeStructure,
  },
  {
    index: 3,
    labelKey: 'studyPlans.ui.checkpointing-draft.56defb93',
    subtextKey: 'studyPlans.ui.merging-with-existing-draft-.0b44fe54',
    icon: FloppyDisk,
  },
];

const PROGRESS_LABEL_KEYS = new Set([
  'study_generation.progress.queued',
  'study_generation.step.decompose',
  'study_generation.step.prerequisites',
  'study_generation.progress.decomposing_complete',
  'study_generation.progress.prerequisites_complete',
  'study_generation.progress.prerequisites_unavailable',
]);

export const GenerationProgress: React.FC<GenerationProgressProps> = ({
  progress,
  status,
  topicCount,
  onCancel,
  onPause,
  onResume,
  isCancelling = false,
}) => {
        useI18n();
        const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const completedSteps = progress?.completed ?? (progress as any)?.completedSteps ?? 0;
  const totalSteps = Math.max(1, progress?.total ?? (progress as any)?.totalSteps ?? 2);
  const percent = Math.min(100, Math.round((completedSteps / totalSteps) * 100));
  const decompositionComplete = completedSteps > 0 && completedSteps >= totalSteps - 1;
  const allStepsComplete = completedSteps >= totalSteps;
  const activeStage = decompositionComplete ? 1 : 0;

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    onCancel?.();
  };

  return (
    <div
      aria-label={translateRecentFeature("studyPlans.ui.generation-progress-containe.88143e6d")}
      className="p-5 rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/80 space-y-5 text-xs"
    >
      {/* Header and status */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            {status === 'running' && (
              <SpinnerGap size={18} className="animate-spin text-primary-500" />
            )}
            {status === 'paused' && (
              <Pause size={18} className="text-amber-500" />
            )}
            {status === 'cancelling' && (
              <SpinnerGap size={18} className="animate-spin text-red-500" />
            )}
            {status === 'completed' && (
              <CheckCircle size={18} weight="fill" className="text-emerald-500" />
            )}
            {status === 'interrupted' && (
              <Hourglass size={18} className="text-amber-500" />
            )}
            {status === 'failed' && (
              <Warning size={18} className="text-red-500" />
            )}
            <span>
              {isCancelling || status === 'cancelling'
                ? translateRecentFeature("studyPlans.ui.cancelling-generation.37bb9b95")
                : status === 'paused'
                  ? translateRecentFeature("studyPlans.ui.generation-paused.70d03ddb")
                  : status === 'completed'
                    ? translateRecentFeature("studyPlans.ui.curriculum-generated-success.2dbee8f3")
                    : status === 'interrupted'
                      ? translateRecentFeature("studyPlans.ui.generation-interrupted.e78ea97e")
                      : status === 'failed'
                        ? translateRecentFeature("studyPlans.ui.generation-failed.7e231811")
                        : translateRecentFeature("studyPlans.ui.generating-curriculum.dcf10675")}
            </span>
          </h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {(progress?.labelKey && PROGRESS_LABEL_KEYS.has(progress.labelKey)
              ? translateRecentFeature(progress.labelKey)
              : null) ||
              (progress as any)?.message ||
              (status === 'paused' ? translateRecentFeature("studyPlans.ui.paused-by-user.a5f200b8") : translateRecentFeature("studyPlans.ui.executing-bounded-generation.892c0e9d"))}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {status === 'running' && onPause && (
            <Button
              variant="tonal"
              size="sm"
              onClick={onPause}
              disabled={isCancelling}
              aria-label={translateRecentFeature("studyPlans.ui.pause-generation.9fb4f90c")}
            >
              <Pause size={14} />
              <span>{translateRecentFeature("audio.pause")}</span>
            </Button>
          )}

          {status === 'paused' && onResume && (
            <Button
              variant="filled"
              size="sm"
              onClick={onResume}
              disabled={isCancelling}
              aria-label={translateRecentFeature("studyPlans.ui.resume-generation.2afbbf29")}
            >
              <Play size={14} />
              <span>{translateRecentFeature("aiLibrary.indexResume")}</span>
            </Button>
          )}

          {(status === 'running' || status === 'paused') && onCancel && (
            <Button
              variant="destructiveOutlined"
              size="sm"
              onClick={handleCancelClick}
              disabled={isCancelling}
              aria-label={translateRecentFeature("studyPlans.ui.cancel-generation.a48ebe85")}
            >
              <XCircle size={14} />
              <span>{isCancelling ? translateRecentFeature("studyPlans.ui.cancelling.5748af1e") : translateRecentFeature("common.cancel")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-surface-600 dark:text-surface-400">
          <span>{translateRecentFeature("studyPlans.ui.step-var0-of-var1.1fa277f9", {var0: Math.min(completedSteps + 1, totalSteps), var1: totalSteps})}</span>
          <span>{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={translateRecentFeature("studyPlans.ui.curriculum-generation-progre.4ca7061b")}
          className="w-full h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden"
        >
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              status === 'failed'
                ? 'bg-red-500'
                : status === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-primary-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Topic Count Pill if available */}
      {topicCount !== undefined && topicCount > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-surface-600 dark:text-surface-400">
          <span className="font-semibold">{translateRecentFeature("studyPlans.ui.proposed-topics-so-far.8738fc10")}</span>
          <span className="px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold border border-primary-500/20">{translateRecentFeature("studyPlans.ui.var0-topics.d382639b", {var0: topicCount})}</span>
        </div>
      )}

      {/* Stages Stepper */}
      <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-700">
        <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">
          {translateRecentFeature("studyPlans.ui.generation-pipeline-stages.a15feb8c")}</div>
        <div className="space-y-2">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const isDone = s.index === 0 ? decompositionComplete : allStepsComplete;
            const isCurrent = status === 'running' && !allStepsComplete && s.index === activeStage;
            const failed = status === 'failed' && !allStepsComplete && s.index === activeStage;

            return (
              <div
                key={s.index}
                className={`flex items-start gap-3 p-2.5 rounded-xl border transition-colors ${
                  isCurrent
                    ? 'bg-primary-500/10 border-primary-500/30 text-surface-900 dark:text-surface-100'
                    : isDone
                      ? 'bg-emerald-500/5 border-emerald-500/20 text-surface-700 dark:text-surface-300'
                      : 'bg-surface-100/50 dark:bg-surface-800/40 border-surface-200 dark:border-surface-700/60 text-surface-400'
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {isDone ? (
                    <CheckCircle size={16} weight="fill" className="text-emerald-500" />
                  ) : isCurrent ? (
                    <SpinnerGap size={16} className="animate-spin text-primary-500" />
                  ) : (
                    <Icon size={16} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{translateRecentFeature(s.labelKey)}</span>
                    <span className="text-[10px] font-semibold text-surface-400">
                      {isDone ? translateRecentFeature("studyPlans.ui.completed.b0775abf") : isCurrent ? translateRecentFeature("studyPlans.ui.in-progress.3850f9d6") : failed ? translateRecentFeature("common.failed") : translateRecentFeature("studyPlans.ui.pending.92e21aca")}
                    </span>
                  </div>
                  <p className="text-[11px] text-surface-500 line-clamp-1">{translateRecentFeature(s.subtextKey)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmation Dialog on Cancel */}
      <ConfirmDialog
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleConfirmCancel}
        title={translateRecentFeature("studyPlans.ui.stop-outstanding-model-work.60a2baa5")}
        message={translateRecentFeature("studyPlans.ui.are-you-sure-you-want-to-can.696bbbbc")}
        confirmLabel={translateRecentFeature("studyPlans.ui.cancel-generation.12d3ed5c")}
        cancelLabel={translateRecentFeature("studyPlans.ui.continue-generating.979fe91f")}
        variant="warning"
      />
    </div>
  );
};
