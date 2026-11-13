/**
 * Rules-Only / No-AI Generation Notice Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2, §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T08, C2-T09)
 */

import React from 'react';
import { Sparkle, ShieldCheck, CheckCircle, X } from '@phosphor-icons/react';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface RulesOnlyNoticeProps {
  conceptCount?: number;
  edgeCount?: number;
  sourceCount?: number;
  onDismiss?: () => void;
}

export const RulesOnlyNotice: React.FC<RulesOnlyNoticeProps> = ({
  conceptCount = 0,
  edgeCount = 0,
  sourceCount = 0,
  onDismiss,
}) => {
        useI18n();
        return (
    <div
      role="region"
      aria-label={translateRecentFeature("studyPlans.ui.rules-only-generation-notice.5323bf49")}
      className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/5 text-blue-900 dark:text-blue-100 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-blue-800 dark:text-blue-200">
          <ShieldCheck size={18} className="text-blue-500 flex-shrink-0" />
          <span>{translateRecentFeature("studyPlans.ui.deterministic-source-outline.3d094308")}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={translateRecentFeature("studyPlans.ui.dismiss-rules-only-notice.be02fdcc")}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-white p-1 rounded-md"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-blue-800 dark:text-blue-200">
        {translateRecentFeature("studyPlans.ui.this-outline-uses-confirmed-.fc5161f0")}</p>

      {/* Metrics chips */}
      <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold flex-wrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <CheckCircle size={14} className="text-blue-500" />
          <span>{translateRecentFeature("studyPlans.ui.var0-confirmed-concepts.7224e6b0", {var0: conceptCount})}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <CheckCircle size={14} className="text-blue-500" />
          <span>{translateRecentFeature("studyPlans.ui.var0-verified-prerequisite-l.046887ba", {var0: edgeCount})}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <Sparkle size={14} className="text-blue-500" />
          <span>{translateRecentFeature("studyPlans.ui.var0-source-documents.647fc39e", {var0: sourceCount})}</span>
        </div>
      </div>
    </div>
  );
};
