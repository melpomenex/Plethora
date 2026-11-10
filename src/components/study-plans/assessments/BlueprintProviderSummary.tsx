/**
 * Assessment AI Provider & Call Budget Summary Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React from 'react';
import { ShieldCheck, HardDrives, Cloud, WarningCircle } from '@phosphor-icons/react';
import type { StudyAiPreflight } from '../../../lib/study-plans/generation/types';
import { calculateModelCallBudget, resolveBatchSize } from '../../../lib/study-plans/assessments/evidencePlanner';

export interface BlueprintProviderSummaryProps {
  preflight: StudyAiPreflight | null;
  requestedCount: number;
  isMobile?: boolean;
  className?: string;
}

export const BlueprintProviderSummary: React.FC<BlueprintProviderSummaryProps> = ({
  preflight,
  requestedCount,
  isMobile,
  className = '',
}) => {
  const batchSize = resolveBatchSize(isMobile);
  const callBudget = calculateModelCallBudget(requestedCount, batchSize);

  if (!preflight) {
    return (
      <div
        className={`p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 flex items-center gap-3 text-amber-800 dark:text-amber-200 text-xs ${className}`}
      >
        <WarningCircle className="w-5 h-5 flex-shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold block">AI Provider Unavailable</span>
          No local or configured AI provider is available. Manual authoring is supported offline.
        </div>
      </div>
    );
  }

  const isLocal = !preflight.sendsSourceOffDevice;

  return (
    <div
      className={`p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLocal ? (
            <HardDrives className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Cloud className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          )}
          <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">
            AI Execution & Call Budget
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
            isLocal
              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
              : 'text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40 border-primary-300 dark:border-primary-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          {isLocal ? 'Local-Only (Private)' : 'Remote Provider'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">Provider</span>
          <span className="font-mono text-surface-800 dark:text-surface-200 truncate block">
            {preflight.providerId || 'Default'}
          </span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">Batch Size</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">
            {batchSize} items / call
          </span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">Call Budget Cap</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">
            Max {callBudget} calls
          </span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">Cost / Tier</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">
            {preflight.billable ? 'Billable' : 'Free / Local'}
          </span>
        </div>
      </div>
    </div>
  );
};
