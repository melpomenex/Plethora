/**
 * Rules-Only / No-AI Generation Notice Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2, §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T08, C2-T09)
 */

import React from 'react';
import { Sparkle, ShieldCheck, CheckCircle, X } from '@phosphor-icons/react';

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
  return (
    <div
      role="region"
      aria-label="Rules-only generation notice"
      className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/5 text-blue-900 dark:text-blue-100 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-blue-800 dark:text-blue-200">
          <ShieldCheck size={18} className="text-blue-500 flex-shrink-0" />
          <span>Deterministic Source Outline (No AI Inference)</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss rules-only notice"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-white p-1 rounded-md"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-blue-800 dark:text-blue-200">
        This outline uses confirmed library concepts and document titles. Document entries are a coarse
        inventory. The outline uses no AI, document passage search, or table-of-contents parsing.
      </p>

      {/* Metrics chips */}
      <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold flex-wrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <CheckCircle size={14} className="text-blue-500" />
          <span>{conceptCount} Confirmed Concepts</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <CheckCircle size={14} className="text-blue-500" />
          <span>{edgeCount} Verified Prerequisite Links</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-900 dark:text-blue-100">
          <Sparkle size={14} className="text-blue-500" />
          <span>{sourceCount} Source Documents</span>
        </div>
      </div>
    </div>
  );
};
