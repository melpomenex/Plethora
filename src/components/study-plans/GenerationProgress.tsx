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
  label: string;
  subtext: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const STAGES: StepInfo[] = [
  {
    index: 0,
    label: 'Decomposing Topics',
    subtext: 'Extracting grounded core topics and learning objectives from sources',
    icon: ListNumbers,
  },
  {
    index: 1,
    label: 'Inferring Prerequisites',
    subtext: 'Analyzing prerequisite dependencies and concept relationships',
    icon: GitFork,
  },
  {
    index: 2,
    label: 'Validating Graph & Ordering',
    subtext: 'Enforcing Kahn cycle-pruning and topological sequence invariants',
    icon: TreeStructure,
  },
  {
    index: 3,
    label: 'Checkpointing Draft',
    subtext: 'Merging with existing draft, preserving locks and user modifications',
    icon: FloppyDisk,
  },
];

const PROGRESS_LABELS: Record<string, string> = {
  'study_generation.progress.queued': 'Waiting to generate topics.',
  'study_generation.step.decompose': 'Building the source outline.',
  'study_generation.step.prerequisites': 'Inferring prerequisites from saved topics.',
  'study_generation.progress.decomposing_complete': 'Topics saved to the draft.',
  'study_generation.progress.prerequisites_complete': 'Draft ready for review.',
  'study_generation.progress.prerequisites_unavailable': 'Draft ready for review. Prerequisite inference was unavailable.',
};

export const GenerationProgress: React.FC<GenerationProgressProps> = ({
  progress,
  status,
  topicCount,
  onCancel,
  onPause,
  onResume,
  isCancelling = false,
}) => {
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
      aria-label="Generation progress container"
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
                ? 'Cancelling Generation…'
                : status === 'paused'
                  ? 'Generation Paused'
                  : status === 'completed'
                    ? 'Curriculum Generated Successfully'
                    : status === 'interrupted'
                      ? 'Generation Interrupted'
                      : status === 'failed'
                        ? 'Generation Failed'
                        : 'Generating Curriculum…'}
            </span>
          </h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {(progress && PROGRESS_LABELS[progress.labelKey]) ||
              (progress as any)?.message ||
              (status === 'paused' ? 'Paused by user.' : 'Executing bounded generation steps.')}
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
              aria-label="Pause generation"
            >
              <Pause size={14} />
              <span>Pause</span>
            </Button>
          )}

          {status === 'paused' && onResume && (
            <Button
              variant="filled"
              size="sm"
              onClick={onResume}
              disabled={isCancelling}
              aria-label="Resume generation"
            >
              <Play size={14} />
              <span>Resume</span>
            </Button>
          )}

          {(status === 'running' || status === 'paused') && onCancel && (
            <Button
              variant="destructiveOutlined"
              size="sm"
              onClick={handleCancelClick}
              disabled={isCancelling}
              aria-label="Cancel generation"
            >
              <XCircle size={14} />
              <span>{isCancelling ? 'Cancelling…' : 'Cancel'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-surface-600 dark:text-surface-400">
          <span>
            Step {Math.min(completedSteps + 1, totalSteps)} of {totalSteps}
          </span>
          <span>{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Curriculum generation progress"
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
          <span className="font-semibold">Proposed topics so far:</span>
          <span className="px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold border border-primary-500/20">
            {topicCount} topics
          </span>
        </div>
      )}

      {/* Stages Stepper */}
      <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-700">
        <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">
          Generation Pipeline Stages
        </div>
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
                    <span className="font-bold text-xs">{s.label}</span>
                    <span className="text-[10px] font-semibold text-surface-400">
                      {isDone ? 'Completed' : isCurrent ? 'In progress' : failed ? 'Failed' : 'Pending'}
                    </span>
                  </div>
                  <p className="text-[11px] text-surface-500 line-clamp-1">{s.subtext}</p>
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
        title="Stop Outstanding Model Work?"
        message="Are you sure you want to cancel curriculum generation? Completed steps and partial checkpoints will be preserved."
        confirmLabel="Cancel Generation"
        cancelLabel="Continue Generating"
        variant="warning"
      />
    </div>
  );
};
