/**
 * Plan Source List component for rendering grounded citations and navigation handles.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React from 'react';
import {
  FileText,
  ArrowSquareOut,
  Trash,
  CheckCircle,
  Warning,
  XCircle,
  Question,
} from '@phosphor-icons/react';
import type { StudySourceResolution } from '../../types/studySource';
import { Button } from '../md3/Button';

export interface PlanSourceListProps {
  sourceRefIds: string[];
  sourceResolutions?: Record<string, StudySourceResolution>;
  onOpenSource?: (sourceRefId: string, resolution?: StudySourceResolution) => void;
  onRemoveSource?: (sourceRefId: string) => void;
  isReadOnly?: boolean;
}

export const PlanSourceList: React.FC<PlanSourceListProps> = ({
  sourceRefIds,
  sourceResolutions = {},
  onOpenSource,
  onRemoveSource,
  isReadOnly = false,
}) => {
  if (sourceRefIds.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-surface-500 border border-dashed border-surface-200 dark:border-surface-700 rounded-xl">
        No source material linked to this topic.
      </div>
    );
  }

  const renderStatusBadge = (status?: StudySourceResolution['status']) => {
    switch (status) {
      case 'current':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle size={12} weight="fill" />
            Current
          </span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Warning size={12} weight="fill" />
            Stale revision
          </span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
            <XCircle size={12} weight="fill" />
            Document missing
          </span>
        );
      case 'ambiguous':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            <Question size={12} weight="fill" />
            Multiple matches
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
            Unverified
          </span>
        );
    }
  };

  return (
    <div className="space-y-2">
      {sourceRefIds.map((refId) => {
        const resolution = sourceResolutions[refId];
        const title = resolution?.ref?.documentTitle || `Source Ref ${refId.slice(0, 8)}`;
        const excerpt = resolution?.ref?.excerpt;
        const jump = resolution?.ref?.jump;
        let locatorLabel: string | null = null;
        if (jump) {
          if (jump.kind === 'pdf') {
            locatorLabel = `Page ${jump.pageNumber}`;
          } else if (jump.kind === 'epub') {
            locatorLabel = 'EPUB Section';
          } else if (jump.kind === 'youtube' || jump.kind === 'audio') {
            locatorLabel = `${Math.floor(jump.timeSeconds)}s`;
          } else if (jump.kind === 'markdown' || jump.kind === 'html') {
            if (jump.scrollPercent !== undefined) {
              locatorLabel = `${Math.round(jump.scrollPercent * 100)}%`;
            }
          }
        }

        return (
          <div
            key={refId}
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-surface-100 dark:bg-surface-800/80 border border-surface-200 dark:border-surface-700 text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <FileText size={15} className="text-primary-500 flex-shrink-0" />
                <span className="font-semibold text-surface-900 dark:text-surface-100 truncate">
                  {title}
                </span>
                {locatorLabel && (
                  <span className="text-[11px] text-surface-500 font-mono">
                    {locatorLabel}
                  </span>
                )}
                {renderStatusBadge(resolution?.status)}
              </div>

              {excerpt && (
                <p className="text-[11px] text-surface-600 dark:text-surface-400 line-clamp-2 italic pl-5 border-l-2 border-surface-300 dark:border-surface-600 my-1">
                  &ldquo;{excerpt}&rdquo;
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 self-end sm:self-center flex-shrink-0">
              {onOpenSource && resolution?.status !== 'missing' && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => onOpenSource(refId, resolution)}
                  title="Open source in reader"
                >
                  <ArrowSquareOut size={15} />
                  <span>Open</span>
                </Button>
              )}
              {!isReadOnly && onRemoveSource && (
                <Button
                  variant="text"
                  size="iconSm"
                  onClick={() => onRemoveSource(refId)}
                  title="Remove source link"
                  aria-label="Remove source link"
                >
                  <Trash size={15} className="text-red-500" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
