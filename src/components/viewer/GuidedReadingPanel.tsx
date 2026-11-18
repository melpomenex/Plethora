import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChatsCircle,
  CheckCircle,
  FloppyDisk,
  NotePencil,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import {
  exitStudyTrail,
  getGuidedQueueNeighbors,
  moveGuidedSegment,
  setGuidedPanelOpen,
  updateGuidedProgress,
  useStudyTrail,
} from '../../lib/study-plans/reading/trailController';
import { formatEstimatedMinutes } from '../../lib/study-plans/trail/queueProjection';
import { FormativeCheckDrawer } from '../study-plans/queue/FormativeCheckDrawer';

export interface GuidedReadingPanelProps {
  tabId: string;
  isMobile?: boolean;
  onOpenNotes?: () => void;
  onOpenTutor?: () => void;
}

function formatBoundary(locator: Record<string, unknown> | undefined): string {
  if (!locator) return 'Start of section';
  if (typeof locator.pageNumber === 'number') return `Page ${locator.pageNumber}`;
  if (typeof locator.timeSeconds === 'number') {
    const secs = Math.max(0, Math.floor(locator.timeSeconds));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }
  if (typeof locator.scrollPercent === 'number') return `${Math.round(locator.scrollPercent)}%`;
  if (typeof locator.textQuote === 'string' && locator.textQuote.trim()) {
    return `“${locator.textQuote.trim().slice(0, 60)}…”`;
  }
  return 'Section boundary';
}

export const GuidedReadingPanel: React.FC<GuidedReadingPanelProps> = ({
  tabId,
  isMobile = false,
  onOpenNotes,
  onOpenTutor,
}) => {
  const activeTabId = useStudyTrail((s) => s.tabId);
  const guided = useStudyTrail((s) => s.guidedSegment);
  const status = useStudyTrail((s) => s.status);
  const saving = useStudyTrail((s) => s.saving);
  const [showCheck, setShowCheck] = useState(false);

  useEffect(() => {
    setShowCheck(false);
  }, [guided?.entry.item.id]);

  if (activeTabId !== tabId || !guided || !guided.panelOpen) return null;

  const { entry, detail, overview } = guided;
  const seg = entry.segment;
  const progressPct = Math.round(entry.item.readingProgress * 100);
  const neighbors = getGuidedQueueNeighbors(detail, overview, entry.item.id);

  const containerClass = isMobile
    ? 'fixed inset-x-0 bottom-0 z-40 max-h-[65vh] overflow-y-auto rounded-t-2xl border-t border-outline-variant bg-card p-4 shadow-xl'
    : 'w-80 shrink-0 border-l border-border bg-card overflow-y-auto p-4 space-y-4';

  return (
    <aside aria-label="Guided Reading Study Trail" data-testid="guided-reading-panel" className={containerClass}>
      <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkle size={13} />
            <span>Guided Reading Mode</span>
          </div>
          <h3 className="text-sm font-bold text-foreground mt-0.5 truncate">{entry.node.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{entry.objectiveText}</p>
        </div>
        <Button
          variant="text"
          size="iconSm"
          aria-label="Minimize Guided Reading panel"
          onClick={() => setGuidedPanelOpen(false)}
        >
          <X size={16} />
        </Button>
      </div>

      {seg && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2 text-xs">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <BookOpen size={14} className="text-primary shrink-0" />
            <span className="truncate">{seg.parentSectionLabel ?? seg.title}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Starts:</span>{' '}
              {formatBoundary(seg.startLocator as Record<string, unknown>)}
            </div>
            <div>
              <span className="font-medium text-foreground">Ends:</span>{' '}
              {formatBoundary(seg.endLocator as Record<string, unknown>)}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ~{formatEstimatedMinutes(seg.estimatedDurationSeconds)} min · Navigator status: {status}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">Guidance & Context</p>
        <p className="text-xs text-muted-foreground">{entry.item.plannerRationale}</p>
        <p className="text-[11px] text-muted-foreground">
          You may continue reading beyond the assigned boundaries at any time.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">Assignment Progress</span>
          <span className="text-muted-foreground">{progressPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={progressPct}
          aria-label="Reading progress within assigned range"
          onChange={(e) => {
            const val = Number(e.target.value) / 100;
            void updateGuidedProgress(val);
          }}
          className="w-full accent-primary"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {onOpenNotes && (
          <Button variant="outlined" size="sm" onClick={onOpenNotes}>
            <NotePencil size={14} />
            <span>Notes & Extracts</span>
          </Button>
        )}
        {onOpenTutor && (
          <Button variant="outlined" size="sm" onClick={onOpenTutor}>
            <ChatsCircle size={14} />
            <span>Socratic Tutor</span>
          </Button>
        )}
      </div>

      <div className="space-y-2 pt-2 border-t border-border">
        {neighbors.total > 1 && (
          <div className="flex items-center justify-between gap-2 pb-1">
            <Button
              variant="outlined"
              size="sm"
              disabled={saving || !neighbors.previous}
              onClick={() => void moveGuidedSegment(-1)}
              aria-label="Previous reading assignment"
            >
              <ArrowLeft size={14} />
              <span>Prev</span>
            </Button>
            <span className="text-[11px] font-medium text-muted-foreground">
              {neighbors.currentIndex >= 0
                ? `${neighbors.currentIndex + 1} of ${neighbors.total}`
                : `${neighbors.total} items`}
            </span>
            <Button
              variant="outlined"
              size="sm"
              disabled={saving || !neighbors.next}
              onClick={() => void moveGuidedSegment(1)}
              aria-label="Next reading assignment"
            >
              <span>Next</span>
              <ArrowRight size={14} />
            </Button>
          </div>
        )}
        <Button
          variant="filled"
          size="sm"
          className="w-full justify-center"
          disabled={saving}
          onClick={() => {
            void updateGuidedProgress(1, 'reading_completed');
            setShowCheck(true);
          }}
        >
          <CheckCircle size={15} />
          <span>Finish Reading → Check Understanding</span>
        </Button>
        {neighbors.next && (
          <Button
            variant="tonal"
            size="sm"
            className="w-full justify-center"
            disabled={saving}
            onClick={() => {
              void moveGuidedSegment(1);
            }}
          >
            <span className="truncate">Next: {neighbors.next.node.title}</span>
            <ArrowRight size={15} className="shrink-0" />
          </Button>
        )}
        <Button
          variant="text"
          size="sm"
          className="w-full justify-center"
          onClick={() => exitStudyTrail(true)}
        >
          <FloppyDisk size={15} />
          <span>Save & Return to Study Queue</span>
        </Button>
      </div>

      {showCheck && (
        <FormativeCheckDrawer
          entry={entry}
          onClose={() => setShowCheck(false)}
          onCompleted={() => {
            guided.onRefreshPlan?.();
          }}
          onReturnToReading={() => setShowCheck(false)}
          onNextAssignment={
            neighbors.next
              ? () => {
                  setShowCheck(false);
                  void moveGuidedSegment(1);
                }
              : undefined
          }
          nextAssignmentTitle={neighbors.next?.node.title}
        />
      )}
    </aside>
  );
};
