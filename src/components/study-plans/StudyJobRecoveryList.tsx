/**
 * Interrupted Study Jobs Recovery List Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React from 'react';
import {
  Hourglass,
  Play,
  Trash,
  SpinnerGap,
  Clock,
  Warning,
} from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import type { StudyGenerationJob } from '../../lib/study-plans/generation/types';

export interface StudyJobRecoveryListProps {
  jobs: StudyGenerationJob[];
  onResumeJob: (job: StudyGenerationJob) => void;
  onCancelJob: (job: StudyGenerationJob) => void;
  isLoading?: boolean;
}

export const StudyJobRecoveryList: React.FC<StudyJobRecoveryListProps> = ({
  jobs,
  onResumeJob,
  onCancelJob,
  isLoading = false,
}) => {
  if (jobs.length === 0) return null;

  return (
    <div
      aria-label="Recoverable interrupted generation jobs"
      className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/5 space-y-3 text-xs"
    >
      <div className="flex items-center justify-between pb-2 border-b border-amber-500/20">
        <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
          <Hourglass size={18} className="text-amber-500 flex-shrink-0" />
          <span>Interrupted Generation Jobs ({jobs.length})</span>
        </div>
        <span className="text-[10px] text-amber-700 dark:text-amber-300">
          Recovered from interruption or restart
        </span>
      </div>

      <p className="text-[11px] text-amber-800 dark:text-amber-200">
        Review the model and privacy settings before resuming. If the source passages or model changed,
        open the saved draft and start a new run.
      </p>

      <div className="space-y-2">
        {jobs.map((job) => {
          const completedSteps = job.progress?.completed ?? job.nextStepIndex;
          const totalSteps = job.progress?.total ?? 0;
          const kindLabel = job.kind.replaceAll('-', ' ');

          return (
            <div
              key={job.id}
              className="p-3 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-surface-900 dark:text-surface-100 capitalize">
                    {kindLabel}
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    {job.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-surface-500">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    <span>{new Date(job.updatedAt).toLocaleTimeString()}</span>
                  </span>
                  <span>
                    Progress: Step {completedSteps} of {totalSteps}
                  </span>
                  {job.lastError && (
                    <span className="text-red-500 flex items-center gap-1">
                      <Warning size={12} />
                      <span className="truncate max-w-[200px]">Previous run stopped</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => onCancelJob(job)}
                  disabled={isLoading}
                  aria-label={`Discard interrupted job ${job.id}`}
                >
                  <Trash size={14} />
                  <span>Discard</span>
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={() => onResumeJob(job)}
                  disabled={isLoading}
                  aria-label={`Resume interrupted job ${job.id}`}
                >
                  {isLoading ? (
                    <SpinnerGap size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  <span>Resume Job</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
