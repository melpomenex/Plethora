/**
 * Question Grounding Sources Editor Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Files, Trash, FileText } from '@phosphor-icons/react';
import type { StudySourceRefV1 } from '../../../types/studySource';

export interface QuestionSourceEditorProps {
  selectedSourceRefIds: string[];
  availableSourceRefs: StudySourceRefV1[];
  onChange: (sourceRefIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export const QuestionSourceEditor: React.FC<QuestionSourceEditorProps> = ({
  selectedSourceRefIds = [],
  availableSourceRefs = [],
  onChange,
  disabled = false,
  className = '',
}) => {
  const handleAddSource = (sourceRefId: string) => {
    if (selectedSourceRefIds.length >= 4 || selectedSourceRefIds.includes(sourceRefId)) {
      return;
    }
    onChange([...selectedSourceRefIds, sourceRefId]);
  };

  const handleRemoveSource = (sourceRefId: string) => {
    onChange(selectedSourceRefIds.filter((id) => id !== sourceRefId));
  };

  const unselectedRefs = availableSourceRefs.filter(
    (ref) => !selectedSourceRefIds.includes(ref.id)
  );

  return (
    <div
      className={`p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Files className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            Grounding Sources ({selectedSourceRefIds.length} / 4 max)
          </h4>
        </div>
        <span className="text-xs text-surface-400">At least 1 required for valid questions</span>
      </div>

      {selectedSourceRefIds.length === 0 ? (
        <div className="p-3 text-center text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800/50">
          No grounding source attached. Questions must cite at least one source excerpt.
        </div>
      ) : (
        <div className="space-y-2">
          {selectedSourceRefIds.map((sourceId, index) => {
            const ref = availableSourceRefs.find((r) => r.id === sourceId);
            const role = index === 0 ? 'Primary Source' : 'Supporting Source';

            return (
              <div
                key={sourceId}
                className="p-2.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 flex items-start justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 flex-shrink-0 text-surface-400" />
                    <span className="font-semibold text-surface-900 dark:text-surface-100 truncate">
                      {ref?.documentTitle || sourceId}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 font-mono">
                      {role}
                    </span>
                  </div>
                  {ref?.excerpt && (
                    <p className="text-surface-500 line-clamp-2 italic text-[11px] pl-6">
                      "{ref.excerpt}"
                    </p>
                  )}
                </div>

                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(sourceId)}
                    title="Remove Source"
                    className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-surface-100 dark:hover:bg-surface-700 flex-shrink-0"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!disabled && selectedSourceRefIds.length < 4 && unselectedRefs.length > 0 && (
        <div className="pt-2 flex items-center gap-2">
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAddSource(e.target.value);
                e.target.value = '';
              }
            }}
            defaultValue=""
            className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-200"
            aria-label="Add grounding source"
          >
            <option value="" disabled>
              + Attach verified source excerpt…
            </option>
            {unselectedRefs.map((ref) => (
              <option key={ref.id} value={ref.id}>
                {ref.documentTitle} — {ref.excerpt.slice(0, 50)}…
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
