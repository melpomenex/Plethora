import { useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, WarningCircle } from '@phosphor-icons/react';
import { useI18n } from '../../lib/i18n';
import {
  coarseStudyJump, exitStudyTrail, finishStudyPassage, moveStudyPassage, nextStudyPassage,
  readingTopicComplete, retryStudyPassage, setGuidedPanelOpen, useStudyTrail,
} from '../../lib/study-plans/reading/trailController';
import { Button } from '../md3/Button';
import { Menu, type MenuItemSpec } from '../md3/Menu';

export function StudyTrailControls({ tabId, showStatus = false }: { tabId: string; showStatus?: boolean }) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const [open, setOpen] = useState(false);
  const request = useStudyTrail((state) => state.tabId === tabId ? state.request : null);
  const active = useStudyTrail((state) => state.active);
  const guided = useStudyTrail((state) => state.guidedSegment);
  const status = useStudyTrail((state) => state.status);
  const saving = useStudyTrail((state) => state.saving);
  const saveError = useStudyTrail((state) => state.saveError);
  if (!request) return null;

  const { assignment } = request;
  const session = active?.trail.session;
  const completed = session?.completedAssignmentIds.includes(assignment.id);
  const skipped = session?.skippedAssignmentIds.includes(assignment.id);
  const index = active?.assignments.findIndex((item) => item.id === assignment.id) ?? 0;
  const done = active?.assignments.filter((item) => session?.completedAssignmentIds.includes(item.id)).length ?? 0;
  const statusText = t(`studyPlans.reading.reader.${status}`);
  const recoverable = status !== 'loading' && status !== 'exact';
  const saveErrorText = saveError ? t('studyPlans.reading.saveFailed') : null;
  const warning = saveErrorText ?? (recoverable ? statusText : null);
  const label = t('studyPlans.reading.heading');
  const items: MenuItemSpec[] = [];

  if (active) {
    if (!completed) items.push({
      key: 'complete', label: t('studyPlans.reading.complete'), icon: Check,
      disabled: saving || status !== 'exact', onSelect: () => void finishStudyPassage(false),
    });
    items.push(
      { key: 'previous', label: t('studyPlans.reading.previous'), icon: ArrowLeft, disabled: saving || index <= 0,
        onSelect: () => void moveStudyPassage(-1) },
      { key: 'next', label: t('studyPlans.reading.next'), icon: ArrowRight, disabled: saving || !nextStudyPassage(active, assignment),
        onSelect: () => void moveStudyPassage(1) },
    );
    if (active.options.onPractice && readingTopicComplete(active, assignment.topicId)) items.push({
      key: 'practice', label: t('studyPlans.reading.quickCheck'), onSelect: () => exitStudyTrail(true, true),
    });
  }
  if (recoverable) {
    items.push({ key: 'retry', label: t('studyPlans.reading.retry'), disabled: saving, onSelect: () => void retryStudyPassage() });
    if (!request.coarse && status !== 'stale' && status !== 'missing' && coarseStudyJump(assignment)) items.push({
      key: 'nearby', label: t('studyPlans.reading.openNearby'), disabled: saving, onSelect: () => void retryStudyPassage(true),
    });
    if (active && !completed && !skipped) items.push({
      key: 'skip', label: t('studyPlans.reading.skip'), disabled: saving, onSelect: () => void finishStudyPassage(true),
    });
  }
  if (guided && !guided.panelOpen) {
    items.push({
      key: 'open-guided-panel',
      label: 'Show Guided Reading Panel',
      icon: BookOpen,
      onSelect: () => setGuidedPanelOpen(true),
    });
  }
  items.push(
    { key: 'return', label: t(active || guided ? 'studyPlans.reading.returnPlan' : 'studyPlans.reading.returnResults'),
      onSelect: () => exitStudyTrail(true) },
    { key: 'exit', label: t('studyPlans.reading.exit'), onSelect: () => exitStudyTrail() },
  );

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <Button ref={anchor} variant="tonal" size="iconSm" aria-label={label} aria-haspopup="menu"
        aria-expanded={open} aria-describedby={statusId} title={warning ?? label}
        data-chrome-control="true" onClick={() => setOpen((value) => !value)}>
        {warning ? <WarningCircle size={18} aria-hidden="true" /> : <BookOpen size={18} aria-hidden="true" />}
      </Button>
      <span id={statusId} role="status" className={showStatus ? 'text-sm text-on-surface-variant' : 'sr-only'}>{statusText}</span>
      {saveErrorText && <span role="alert" className="sr-only">{saveErrorText}</span>}
      <Menu items={items} anchorRef={anchor} open={open} onClose={() => setOpen(false)} label={label} dismissPriority={70}
        footer={
          <div className="mt-1 space-y-1 border-t border-outline-variant/50 px-3 py-2 text-xs text-on-surface-variant">
            {active && <>
              <p>{t('studyPlans.reading.passageNumber', { current: index + 1, total: active.assignments.length })}</p>
              <p>{t('studyPlans.reading.progress', { done, total: active.assignments.length })}</p>
            </>}
            {completed && <p>{t('studyPlans.reading.completed')}</p>}
            {skipped && <p>{t('studyPlans.reading.skipped')}</p>}
            <p>{statusText}</p>
            {saveErrorText && <p className="text-error">{saveErrorText}</p>}
          </div>
        }
      />
    </div>
  );
}
