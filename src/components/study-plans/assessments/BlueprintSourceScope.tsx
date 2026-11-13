/**
 * Blueprint Source Scope Inspector Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.1
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React from 'react';
import { Files, FileText, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import type { StudySourceScopeV1 } from '../../../types/studySource';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface BlueprintSourceScopeProps {
  sourceScope: StudySourceScopeV1;
  snapshotHash?: string;
  className?: string;
}

export const BlueprintSourceScope: React.FC<BlueprintSourceScopeProps> = ({
  sourceScope,
  snapshotHash,
  className = '',
}) => {
        useI18n();
        const docIds = sourceScope.selected?.documentIds || [];
  const extractIds = sourceScope.selected?.extractIds || [];
  const resolvedDocs = sourceScope.resolvedDocuments || [];
  const hasSources = docIds.length > 0 || extractIds.length > 0 || resolvedDocs.length > 0;

  return (
    <div
      className={`rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 p-4 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Files className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {translateRecentFeature("studyPlans.ui.grounding-source-scope.0f2b2d95")}</h3>
        </div>
        {hasSources ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
            <CheckCircle className="w-3.5 h-3.5" />
            {translateRecentFeature("studyPlans.ui.verified-grounding.e1081fd1")}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
            <WarningCircle className="w-3.5 h-3.5" />
            {translateRecentFeature("studyPlans.ui.no-sources-selected.f668de09")}</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
          <span className="text-surface-500 dark:text-surface-400 block">{translateRecentFeature("nav.documents")}</span>
          <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
            {resolvedDocs.length || docIds.length}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
          <span className="text-surface-500 dark:text-surface-400 block">{translateRecentFeature("audio.extracts")}</span>
          <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
            {extractIds.length}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50 col-span-2 sm:col-span-1">
          <span className="text-surface-500 dark:text-surface-400 block">{translateRecentFeature("studyPlans.ui.snapshot-hash.585479a9")}</span>
          <span className="font-mono text-[11px] text-surface-700 dark:text-surface-300 truncate block">
            {snapshotHash ? `${snapshotHash.slice(0, 16)}…` : translateRecentFeature("studyPlans.ui.dynamic-live-scope.e242dc81")}
          </span>
        </div>
      </div>

      {resolvedDocs.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <span className="text-xs font-medium text-surface-600 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.grounding-documents.11bfca90")}</span>
          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
            {resolvedDocs.map((doc) => (
              <div
                key={doc.documentId}
                className="flex items-center justify-between text-xs py-1 px-2 rounded bg-surface-100 dark:bg-surface-700/30 text-surface-800 dark:text-surface-200"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0 text-surface-400" />
                  <span className="truncate">{doc.title}</span>
                </div>
                <span className="text-[10px] text-surface-400 uppercase font-mono ml-2 flex-shrink-0">
                  {doc.sourceType}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
