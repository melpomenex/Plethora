/**
 * Attempt Question Source Navigation Action.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React, { useState } from 'react';
import { BookOpen, WarningCircle } from '@phosphor-icons/react';
import { openStudySource } from '../../../lib/study-plans/openStudySource';
import type { StudySourceRefV1 } from '../../../types/studySource';

export interface AttemptSourceActionProps {
  sourceRef: StudySourceRefV1;
  className?: string;
}

export const AttemptSourceAction: React.FC<AttemptSourceActionProps> = ({
  sourceRef,
  className = '',
}) => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setErrorMsg(null);
    setOpening(true);

    try {
      const outcome = await openStudySource(sourceRef);
      if (!outcome.success && 'message' in outcome) {
        setErrorMsg(outcome.message);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to open source document');
    } finally {
      setOpening(false);
    }
  };

  const docTitle = sourceRef.documentTitle || 'Source Document';
  let locationLabel: string | null = null;
  if (sourceRef.jump) {
    if (sourceRef.jump.kind === 'pdf') {
      locationLabel = `p. ${sourceRef.jump.pageNumber}`;
    } else if (sourceRef.jump.kind === 'youtube' || sourceRef.jump.kind === 'audio') {
      const mins = Math.floor(sourceRef.jump.timeSeconds / 60);
      const secs = (sourceRef.jump.timeSeconds % 60).toString().padStart(2, '0');
      locationLabel = `${mins}:${secs}`;
    } else if (sourceRef.jump.kind === 'epub') {
      locationLabel = 'EPUB';
    }
  } else if (sourceRef.sectionLabel) {
    locationLabel = sourceRef.sectionLabel;
  }

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container-high dark:bg-surface-container-high-dark hover:bg-surface-container-highest border border-outline-variant/40 text-xs font-medium text-primary dark:text-primary-dark transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Open source: ${docTitle}${locationLabel ? ` (${locationLabel})` : ''}`}
      >
        <BookOpen size={14} className="shrink-0" />
        <span className="truncate max-w-[200px]">{docTitle}</span>
        {locationLabel && (
          <span className="text-on-surface-variant dark:text-on-surface-variant-dark font-normal">
            ({locationLabel})
          </span>
        )}
      </button>

      {errorMsg && (
        <span className="text-[11px] text-error flex items-center gap-1">
          <WarningCircle size={12} className="shrink-0" />
          {errorMsg}
        </span>
      )}
    </div>
  );
};
