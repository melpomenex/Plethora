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
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        const batchSize = resolveBatchSize(isMobile);
  const callBudget = calculateModelCallBudget(requestedCount, batchSize);

  if (!preflight) {
    return (
      <div
        className={`p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 flex items-center gap-3 text-amber-800 dark:text-amber-200 text-xs ${className}`}
      >
        <WarningCircle className="w-5 h-5 flex-shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold block">{translateRecentFeature("studyPlans.ui.ai-provider-unavailable.187627bc")}</span>
          {translateRecentFeature("studyPlans.ui.no-local-or-configured-ai-pr.a20ed7a1")}</div>
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
            {translateRecentFeature("studyPlans.ui.ai-execution-call-budget.98e7c487")}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
            isLocal
              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
              : 'text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40 border-primary-300 dark:border-primary-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          {isLocal ? translateRecentFeature("studyPlans.ui.local-only-private.34409e88") : translateRecentFeature("studyPlans.ui.remote-provider.41928ffe")}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">{translateRecentFeature("notebooklm.provider")}</span>
          <span className="font-mono text-surface-800 dark:text-surface-200 truncate block">
            {preflight.providerId || translateRecentFeature("i18nAudit.ui.default.b8844e3d")}
          </span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.batch-size.7c3b92cc")}</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">{translateRecentFeature("studyPlans.ui.var0-items-call.c48d4065", {var0: batchSize})}</span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.call-budget-cap.44fe0acd")}</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">{translateRecentFeature("studyPlans.ui.max-var0-calls.81202816", {var0: callBudget})}</span>
        </div>
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700/40">
          <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.cost-tier.d0413c98")}</span>
          <span className="font-semibold text-surface-800 dark:text-surface-200 block">
            {preflight.billable ? translateRecentFeature("studyPlans.ui.billable.8f34e60e") : translateRecentFeature("studyPlans.ui.free-local.d7391ff1")}
          </span>
        </div>
      </div>
    </div>
  );
};
