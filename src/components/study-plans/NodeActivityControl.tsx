/**
 * Node Activity Control component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React from 'react';
import { Circle, PlayCircle, CheckCircle, Prohibit } from '@phosphor-icons/react';
import type { NodeActivity } from '../../types/learningPaths';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface NodeActivityControlProps {
  activity: NodeActivity;
  onChange: (activity: NodeActivity) => void;
  disabled?: boolean;
}

const ACTIVITIES: Array<{
  id: NodeActivity;
  labelKey: string;
  icon: React.ReactNode;
  activeClass: string;
}> = [
  {
    id: 'not-started',
    labelKey: 'documentsView.notStarted',
    icon: <Circle size={15} />,
    activeClass: 'bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm font-semibold',
  },
  {
    id: 'in-progress',
    labelKey: 'studyPlans.ui.in-progress.3850f9d6',
    icon: <PlayCircle size={15} />,
    activeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 shadow-sm font-semibold',
  },
  {
    id: 'completed',
    labelKey: 'studyPlans.ui.completed.b0775abf',
    icon: <CheckCircle size={15} weight="fill" />,
    activeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm font-semibold',
  },
  {
    id: 'skipped',
    labelKey: 'studyPlans.ui.skipped.76bc3e23',
    icon: <Prohibit size={15} />,
    activeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-sm font-semibold',
  },
];

export const NodeActivityControl: React.FC<NodeActivityControlProps> = ({
  activity,
  onChange,
  disabled = false,
}) => {
        useI18n();
        return (
    <div
      role="group"
      aria-label={translateRecentFeature("studyPlans.ui.topic-study-activity-status.d371f32c")}
      className="inline-flex p-1 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 gap-1 flex-wrap"
    >
      {ACTIVITIES.map((act) => {
        const isSelected = activity === act.id;
        return (
          <button
            key={act.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(act.id)}
            aria-pressed={isSelected}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all select-none ${
              isSelected
                ? act.activeClass
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-200/50 dark:hover:bg-surface-700/50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {act.icon}
            <span>{translateRecentFeature(act.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
};
