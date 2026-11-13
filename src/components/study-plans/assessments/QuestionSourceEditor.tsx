/**
 * Question Grounding Sources Editor Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Files, Trash, FileText, ArrowSquareOut } from '@phosphor-icons/react';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { ExternalSnapshot } from '../../../lib/study-plans/webresearch/snapshots';

export interface QuestionSourceEditorProps {
  selectedSourceRefIds: string[];
  availableSourceRefs: StudySourceRefV1[];
  onChange: (sourceRefIds: string[]) => void;
  selectedExternalSnapshotIds?: string[];
  availableExternalSnapshots?: ExternalSnapshot[];
  externalEvidenceReviewed?: boolean;
  onExternalChange?: (snapshotIds: string[]) => void;
  onExternalEvidenceReviewedChange?: (reviewed: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const QuestionSourceEditor: React.FC<QuestionSourceEditorProps> = ({
  selectedSourceRefIds = [],
  availableSourceRefs = [],
  onChange,
  selectedExternalSnapshotIds = [],
  availableExternalSnapshots = [],
  externalEvidenceReviewed = false,
  onExternalChange,
  onExternalEvidenceReviewedChange,
  disabled = false,
  className = '',
}) => {
  const handleAddSource = (sourceRefId: string) => {
    if (selectedSourceRefIds.length + selectedExternalSnapshotIds.length >= 4 || selectedSourceRefIds.includes(sourceRefId)) {
      return;
    }
    onChange([...selectedSourceRefIds, sourceRefId]);
  };

  const handleRemoveSource = (sourceRefId: string) => {
    onChange(selectedSourceRefIds.filter((id) => id !== sourceRefId));
  };

  const handleAddExternalSnapshot = (snapshotId: string) => {
    if (!snapshotId || selectedSourceRefIds.length + selectedExternalSnapshotIds.length >= 4 || selectedExternalSnapshotIds.includes(snapshotId)) return;
    onExternalChange?.([...selectedExternalSnapshotIds, snapshotId]);
  };

  const handleRemoveExternalSnapshot = (snapshotId: string) => {
    onExternalChange?.(selectedExternalSnapshotIds.filter((id) => id !== snapshotId));
  };

  const unselectedRefs = availableSourceRefs.filter(
    (ref) => !selectedSourceRefIds.includes(ref.id)
  );
  const unselectedExternalSnapshots = availableExternalSnapshots.filter(
    (snapshot) => snapshot.status === 'accepted' && !selectedExternalSnapshotIds.includes(snapshot.id)
  );
  const totalSelected = selectedSourceRefIds.length + selectedExternalSnapshotIds.length;

  return (
    <div
      className={`p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Files className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            Grounding Sources ({totalSelected} / 4 max)
          </h4>
        </div>
        <span className="text-xs text-surface-400">At least 1 required for valid questions</span>
      </div>

      {totalSelected === 0 ? (
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

      {selectedExternalSnapshotIds.length > 0 && (
        <div className="space-y-2">
          {selectedExternalSnapshotIds.map((snapshotId) => {
            const snapshot = availableExternalSnapshots.find((item) => item.id === snapshotId);
            return (
              <div key={snapshotId} className="space-y-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 flex-shrink-0 text-primary-600 dark:text-primary-400" />
                      <span className="font-semibold text-surface-900 dark:text-surface-100">{snapshot?.title || snapshotId}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${snapshot?.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                        {snapshot?.status === 'accepted' ? 'Accepted web source' : snapshot?.status === 'stale' ? 'Stale web source' : 'Unavailable web source'}
                      </span>
                    </div>
                    {snapshot && <p className="text-[11px] text-surface-600 dark:text-surface-300">{snapshot.publisher} · {new Date(snapshot.fetchedAt).toLocaleDateString()} · {snapshot.revisionHash}</p>}
                  </div>
                  {!disabled && (
                    <button type="button" onClick={() => handleRemoveExternalSnapshot(snapshotId)} title="Remove web source" className="rounded p-1 text-surface-500 hover:bg-surface-100 hover:text-red-700 dark:hover:bg-surface-700 dark:hover:text-red-300">
                      <Trash className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {snapshot?.status !== 'accepted' && <p className="text-[11px] text-amber-900 dark:text-amber-200">Replace this citation with an accepted current snapshot before saving.</p>}
                {snapshot && <blockquote className="rounded-md bg-surface-50 dark:bg-surface-900/70 p-2 text-[11px] leading-relaxed text-surface-700 dark:text-surface-200">{snapshot.excerpt}</blockquote>}
                {snapshot && <a href={snapshot.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 underline underline-offset-2 dark:text-primary-300">Open captured source <ArrowSquareOut className="h-3 w-3" /></a>}
              </div>
            );
          })}
        </div>
      )}

      {!disabled && totalSelected < 4 && (unselectedRefs.length > 0 || unselectedExternalSnapshots.length > 0) && (
        <div className="pt-2 flex items-center gap-2">
          {unselectedRefs.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) handleAddSource(e.target.value);
                e.target.value = '';
              }}
              defaultValue=""
              className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-200"
              aria-label="Add library grounding source"
            >
              <option value="" disabled>+ Attach library source excerpt…</option>
              {unselectedRefs.map((ref) => (
                <option key={ref.id} value={ref.id}>{ref.documentTitle} — {ref.excerpt.slice(0, 50)}…</option>
              ))}
            </select>
          )}
          {unselectedExternalSnapshots.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) handleAddExternalSnapshot(e.target.value);
                e.target.value = '';
              }}
              defaultValue=""
              className="w-full h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-200"
              aria-label="Add accepted web source"
            >
              <option value="" disabled>+ Attach accepted web source…</option>
              {unselectedExternalSnapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>{snapshot.title} — {snapshot.publisher}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {selectedExternalSnapshotIds.length > 0 && (
        <label className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/25 p-3 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
          <input
            type="checkbox"
            checked={externalEvidenceReviewed}
            disabled={disabled}
            onChange={(event) => onExternalEvidenceReviewedChange?.(event.target.checked)}
            className="mt-0.5 rounded border-amber-500 text-amber-700 focus:ring-amber-500"
          />
          <span>I reviewed each saved excerpt and confirm it supports this question, its answer key, and its rubric.</span>
        </label>
      )}
    </div>
  );
};
