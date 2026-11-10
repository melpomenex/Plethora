/**
 * Generation Privacy & AI Disclosure Summary Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2, §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React from 'react';
import {
  ShieldCheck,
  Cloud,
  Cpu,
  WifiHigh,
  CurrencyDollar,
  CheckCircle,
  Warning,
} from '@phosphor-icons/react';
import type { StudyAiPreflight } from '../../lib/study-plans/generation/types';

export interface GenerationPrivacySummaryProps {
  preflight: StudyAiPreflight | null;
  cloudDisclosureAccepted: boolean;
  onCloudDisclosureChange?: (accepted: boolean) => void;
  costConsentAccepted: boolean;
  onCostConsentChange?: (accepted: boolean) => void;
  disabled?: boolean;
}

export const GenerationPrivacySummary: React.FC<GenerationPrivacySummaryProps> = ({
  preflight,
  cloudDisclosureAccepted,
  onCloudDisclosureChange,
  costConsentAccepted,
  onCostConsentChange,
  disabled = false,
}) => {
  if (!preflight) {
    return (
      <div className="p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-xs text-surface-500">
        AI preflight details not calculated yet.
      </div>
    );
  }

  const isOffDevice =
    preflight.sendsSourceOffDevice ??
    (typeof preflight.generationDestination === 'object' && preflight.generationDestination !== null
      ? preflight.generationDestination.sendsOffDevice
      : false);

  const isBillable =
    preflight.billable ??
    (typeof preflight.generationDestination === 'object' && preflight.generationDestination !== null
      ? preflight.generationDestination.billable
      : false);

  const destLocality =
    typeof preflight.generationDestination === 'object' && preflight.generationDestination !== null
      ? preflight.generationDestination.locality
      : 'remote';

  return (
    <div
      aria-label="AI Privacy and Model Configuration Summary"
      className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 space-y-3.5 text-xs"
    >
      <div className="flex items-center justify-between pb-2 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2 font-bold text-surface-800 dark:text-surface-200">
          <ShieldCheck size={18} className="text-primary-500" />
          <span>AI Provider &amp; Privacy Summary</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
            !isOffDevice
              ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
              : 'border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/10'
          }`}
        >
          {!isOffDevice ? 'On-Device Private' : 'Cloud Route'}
        </span>
      </div>

      {/* Grid of properties */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Model & Destination */}
        <div className="p-2.5 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 space-y-1">
          <div className="text-[10px] font-bold text-surface-500 uppercase tracking-wider">
            Generation Model
          </div>
          <div className="flex items-center gap-1.5 font-semibold text-surface-900 dark:text-surface-100">
            {destLocality === 'device' || destLocality === 'loopback' ? (
              <Cpu size={15} className="text-emerald-500 flex-shrink-0" />
            ) : destLocality === 'lan' ? (
              <WifiHigh size={15} className="text-blue-500 flex-shrink-0" />
            ) : (
              <Cloud size={15} className="text-amber-500 flex-shrink-0" />
            )}
            <span className="truncate">{preflight.providerId}</span>
          </div>
          <div className="text-[11px] text-surface-500">
            {destLocality === 'device' || destLocality === 'loopback'
              ? 'Local on-device engine; no network egress.'
              : destLocality === 'lan'
                ? 'Local area network (Ollama server).'
                : 'Cloud API route.'}
          </div>
        </div>

        {/* Planned Model Calls */}
        <div className="p-2.5 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 space-y-1">
          <div className="text-[10px] font-bold text-surface-500 uppercase tracking-wider">
            Execution Budget
          </div>
          <div className="flex items-center gap-1.5 font-semibold text-surface-900 dark:text-surface-100">
            {isBillable ? (
              <CurrencyDollar size={15} className="text-amber-500 flex-shrink-0" />
            ) : (
              <CheckCircle size={15} className="text-emerald-500 flex-shrink-0" />
            )}
            <span>Up to {preflight.maximumModelCalls} Model Calls</span>
          </div>
          <div className="text-[11px] text-surface-500">
            2 steps (decompose &amp; prerequisites) with twin fallback reserve.
          </div>
        </div>
      </div>

      {/* Embedding Route if present */}
      {preflight.embeddingDestination && (
        <div className="text-[11px] text-surface-600 dark:text-surface-400 flex items-center gap-1.5">
          <span className="font-semibold">Embedding Destination:</span>
          <span className="capitalize">
            {typeof preflight.embeddingDestination === 'object'
              ? preflight.embeddingDestination.locality
              : String(preflight.embeddingDestination)}
          </span>
          {typeof preflight.embeddingDestination === 'object' &&
            preflight.embeddingDestination.sendsOffDevice &&
            ' (Off-device)'}
        </div>
      )}

      {/* Data Flow disclosure */}
      <div className="text-[11px] text-surface-600 dark:text-surface-400 space-y-1">
        <span className="font-semibold">Data processed: </span>
        <span>
          {isOffDevice
            ? 'Source excerpts and learning objectives are transmitted to the provider to decompose topics and infer prerequisites.'
            : 'All source excerpts and curriculum generation logic remain entirely on your local machine.'}
        </span>
      </div>

      {/* Required Consents if off-device or billable */}
      {(isOffDevice || isBillable) && (
        <div className="pt-2 border-t border-surface-200 dark:border-surface-700 space-y-2">
          {isOffDevice && onCloudDisclosureChange && (
            <label className="flex items-start gap-2.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={cloudDisclosureAccepted}
                onChange={(e) => onCloudDisclosureChange(e.target.checked)}
                disabled={disabled}
                aria-label="Cloud disclosure acceptance"
                className="mt-0.5 text-primary-600 focus:ring-primary-500 rounded"
              />
              <span className="text-surface-700 dark:text-surface-300">
                I understand and agree that selected source material will be sent to{' '}
                <span className="font-semibold text-surface-900 dark:text-surface-100">
                  {preflight.providerId}
                </span>{' '}
                for curriculum decomposition.
              </span>
            </label>
          )}

          {isBillable && onCostConsentChange && (
            <label className="flex items-start gap-2.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={costConsentAccepted}
                onChange={(e) => onCostConsentChange(e.target.checked)}
                disabled={disabled}
                aria-label="Cost consent acceptance"
                className="mt-0.5 text-primary-600 focus:ring-primary-500 rounded"
              />
              <span className="text-surface-700 dark:text-surface-300">
                I authorize up to{' '}
                <span className="font-semibold text-surface-900 dark:text-surface-100">
                  {preflight.maximumModelCalls} billable model calls
                </span>{' '}
                for this curriculum generation job.
              </span>
            </label>
          )}

          {(!cloudDisclosureAccepted && isOffDevice) && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <Warning size={14} className="flex-shrink-0" />
              <span>Cloud transmission disclosure must be accepted before generation can start.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
