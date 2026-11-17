import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen } from '@phosphor-icons/react';
import { getStudyReadingTrail, saveStudyReadingManifest } from '../../../api/study-reading';
import { getStudyPlan } from '../../../api/study-plans';
import { useI18n } from '../../../lib/i18n';
import { addManualReadingAssignment, generateReadingManifest } from '../../../lib/study-plans/reading/generateReadingManifest';
import { startStudyTrail } from '../../../lib/study-plans/reading/trailController';
import { studyErrorMessage } from '../../../lib/study-plans/studyErrorMessage';
import type { StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { StudyReadingTrail } from '../../../types/studyReading';
import { Button } from '../../md3/Button';
import { StudyTrailControls } from '../../viewer/StudyTrailControls';
import { AssignedReadingText } from './AssignedReadingText';
import { useIsActiveTab } from '../../common/Tabs/TabContent';

export function useStudyReading(detail: StudyPlanDetail, originTabId?: string, onPractice?: (topicId: string) => void) {
  const { t } = useI18n();
  const isActiveTab = useIsActiveTab();
  const [storedTrail, setTrail] = useState<StudyReadingTrail | null>(null);
  const [status, setStatus] = useState<'loading' | 'building' | 'saving' | 'opening' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const { plan, version } = detail;
  const planId = plan.id;
  const versionId = version.id;
  const available = plan.status === 'active' && version.state === 'published' &&
    version.knowledgeAuthority?.kind !== 'model-only' &&
    (Boolean(version.sourceScope?.resolvedDocuments.length) || version.nodes.some((node) => node.sourceRefIds.length > 0));
  const trail = storedTrail?.versionId === versionId ? storedTrail : null;

  function refresh() {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setError(null);
    setStatus('loading');
    void getStudyReadingTrail(planId, versionId).then((result) => {
      if (!request.signal.aborted) setTrail(result);
    }, (cause: unknown) => {
      if (!request.signal.aborted) setError(studyErrorMessage(cause, t('studyPlans.reading.loadFailed')));
    }).finally(() => {
      if (pending.current === request) {
        pending.current = null;
        setStatus(null);
      }
    });
  }

  useEffect(() => {
    setError(null);
    setStatus(null);
    if (available && isActiveTab) refresh();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
    // Reload only when the saved authority changes.
  }, [available, isActiveTab, planId, versionId]);

  async function build(topicId?: string, sourceRefId?: string, passage?: string) {
    if (!trail || pending.current) return false;
    const request = new AbortController();
    pending.current = request;
    setError(null);
    setStatus('building');
    try {
      const current = await getStudyPlan(planId, versionId);
      request.signal.throwIfAborted();
      const authored = trail.manifest.assignments.filter((assignment) => assignment.authored &&
        assignment.sourceRefIds.every((id) => current.sourceRefs[id]?.status === 'current'));
      const generated = topicId && sourceRefId && passage
        ? await addManualReadingAssignment(current, trail.manifest, topicId, sourceRefId, passage, request.signal)
        : await generateReadingManifest(current, request.signal);
      const assignments = new Map(generated.assignments.map((item) => [item.id, item]));
      if (!topicId) for (const item of authored) assignments.set(item.id, item);
      const manifest = { assignments: Array.from(assignments.values()) };
      request.signal.throwIfAborted();
      setStatus('saving');
      const result = await saveStudyReadingManifest(planId, versionId, trail.revision, manifest);
      if (request.signal.aborted) return false;
      setTrail(result);
      return true;
    } catch (cause) {
      if (!request.signal.aborted) setError(studyErrorMessage(cause, t('studyPlans.reading.buildFailed')));
      return false;
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setStatus(null);
      }
    }
  }

  async function open(topicId?: string, startAssignmentId?: string) {
    if (!trail || pending.current) return;
    if (!topicId && !trail.manifest.assignments.length && trail.revision === 0) {
      if (!await build()) return;
    }
    const request = new AbortController();
    pending.current = request;
    setError(null);
    setStatus('opening');
    try {
      // Reader activity can change while the plan tab stays mounted.
      const latest = await getStudyReadingTrail(planId, versionId);
      request.signal.throwIfAborted();
      setTrail(latest);
      await startStudyTrail(detail, latest, { topicId, startAssignmentId, originTabId, onPractice });
    } catch (cause) {
      if (!request.signal.aborted) setError(studyErrorMessage(cause, t('studyPlans.reading.openFailed')));
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setStatus(null);
      }
    }
  }

  const canOpen = (topicId?: string) => Boolean(trail?.manifest.assignments.some((assignment) => !topicId || assignment.topicId === topicId));
  const label = (topicId?: string) => {
    if (!topicId) return t(trail?.session?.currentAssignmentId ? 'studyPlans.reading.resume' : 'studyPlans.reading.start');
    const current = trail?.manifest.assignments.find((item) => item.id === trail.session?.currentAssignmentId);
    return t(current?.topicId === topicId ? 'studyPlans.reading.resumeTopic' : 'studyPlans.reading.readTopic');
  };
  return { available, trail, status, error, originTabId, refresh, build, open, canOpen, label, cancel: () => pending.current?.abort() };
}

interface StudyReadingControlsProps {
  detail: StudyPlanDetail;
  topic: StudyPlanVersionNode | null;
  reading: ReturnType<typeof useStudyReading>;
}

export function StudyReadingControls({ detail, topic, reading }: StudyReadingControlsProps) {
  const { t } = useI18n();
  const headingId = useId();
  const assignments = reading.trail?.manifest.assignments ?? [];
  const included = detail.version.nodes.filter((node) => node.included);
  let objectiveCount = 0;
  let coveredCount = 0;
  for (const node of included) {
    objectiveCount += node.learningObjectives.length;
    const linked = new Set(assignments.filter((assignment) => assignment.topicId === node.nodeId).flatMap((assignment) => assignment.objectiveIndexes));
    coveredCount += node.learningObjectives.filter((_, index) => linked.has(index)).length;
  }
  const uncovered = topic?.learningObjectives.filter((_, index) =>
    !assignments.some((assignment) => assignment.topicId === topic.nodeId && assignment.objectiveIndexes.includes(index))) ?? [];

  if (!reading.available) return null;
  return (
    <section aria-labelledby={headingId} className="border-y border-outline-variant/40 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-on-surface">{t('studyPlans.reading.heading')}</h2>
          {reading.trail && (
            <p className="mt-1 text-sm text-on-surface-variant">
              {assignments.length
                ? t('studyPlans.reading.coverage', { passages: assignments.length, covered: coveredCount, total: objectiveCount })
                : t('studyPlans.reading.empty')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {reading.trail && (reading.canOpen() || reading.trail.revision === 0) && (
            <Button onClick={() => void reading.open()} disabled={Boolean(reading.status)} size="sm">
              <BookOpen size={16} aria-hidden="true" />
              {reading.label()}
            </Button>
          )}
          {reading.trail && reading.trail.revision > 0 && (
            <Button variant={assignments.length ? 'text' : 'tonal'} size="sm" disabled={Boolean(reading.status)} onClick={() => void reading.build()}>
              {t(assignments.length ? 'studyPlans.reading.refresh' : 'studyPlans.reading.prepare')}
            </Button>
          )}
          {reading.status === 'building' && (
            <Button variant="text" size="sm" onClick={reading.cancel}>{t('common.cancel')}</Button>
          )}
          {reading.error && reading.status === null && (
            <Button variant="text" size="sm" onClick={reading.refresh}>{t('studyPlans.reading.reload')}</Button>
          )}
        </div>
      </div>
      {reading.status && <p role="status" className="text-sm text-on-surface-variant">{t(`studyPlans.reading.${reading.status}`)}</p>}
      {reading.error && <p role="alert" className="text-sm text-error">{reading.error}</p>}
      {reading.originTabId && <StudyTrailControls tabId={reading.originTabId} showStatus />}
      {reading.trail && topic?.included && (
        <>
          {assignments.length > 0 && uncovered.length > 0 && (
            <details className="text-sm text-on-surface-variant">
              <summary className="cursor-pointer py-2">{t('studyPlans.reading.uncovered', { topic: topic.title })}</summary>
              <ul className="list-disc space-y-1 ps-5">
                {uncovered.map((objective, index) => <li key={index}>{objective}</li>)}
              </ul>
            </details>
          )}
          {assignments.some(({ topicId }) => topicId === topic.nodeId) && (
            <details className="text-sm">
              <summary className="cursor-pointer py-2">{t('studyPlans.reading.topicPassages')}</summary>
              <ul className="divide-y divide-outline-variant/50 border-y border-outline-variant/50">
                {assignments.filter(({ topicId }) => topicId === topic.nodeId).map((assignment) => (
                  <li key={assignment.id} className="py-1">
                    <details className="group">
                      <summary className="min-h-11 cursor-pointer rounded-md px-2 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <span className="font-medium">{assignment.documentTitle}{assignment.label ? ` · ${assignment.label}` : ''}</span>
                        <span className="mt-1 line-clamp-2 text-xs text-on-surface-variant group-open:hidden">
                          {assignment.segments[0]?.quote.exact}
                        </span>
                      </summary>
                      <div className="space-y-2 px-3 pb-2 pt-1">
                        <AssignedReadingText segments={assignment.segments} />
                        {assignment.objectiveIndexes.length > 0 && (
                          <ul className="list-disc space-y-1 ps-5 text-on-surface-variant">
                            {assignment.objectiveIndexes.map((index) => <li key={index}>{topic.learningObjectives[index]}</li>)}
                          </ul>
                        )}
                        {assignment.rationale && <p className="text-on-surface-variant">{assignment.rationale}</p>}
                        <Button variant="tonal" size="sm" disabled={Boolean(reading.status)}
                          onClick={() => void reading.open(topic.nodeId, assignment.id)}>
                          {t('studyPlans.reading.openInReader')}
                        </Button>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ManualPassage key={topic.nodeId} detail={detail} topic={topic} reading={reading} />
        </>
      )}
    </section>
  );
}

function ManualPassage({ detail, topic, reading }: StudyReadingControlsProps & { topic: StudyPlanVersionNode }) {
  const { t } = useI18n();
  const fieldId = useId();
  const [sourceId, setSourceId] = useState('');
  const [passage, setPassage] = useState('');
  const sources = topic.sourceRefIds
    .map((id) => detail.sourceRefs[id])
    .filter((resolution) => resolution?.status === 'current' &&
      ['epub', 'pdf', 'html', 'markdown'].includes(resolution.ref.sourceType));

  if (!sources.length) return null;
  const selectedSourceId = sources.find(({ ref }) => ref.id === sourceId)?.ref.id ?? sources[0].ref.id;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-2">{t('studyPlans.reading.addPassage', { topic: topic.title })}</summary>
      <form className="space-y-3 pb-2" onSubmit={(event) => {
        event.preventDefault();
        void reading.build(topic.nodeId, selectedSourceId, passage.trim()).then((saved) => {
          if (saved) setPassage('');
        });
      }}>
        <label className="block space-y-1" htmlFor={`${fieldId}-source`}>
          <span>{t('studyPlans.reading.source')}</span>
          <select id={`${fieldId}-source`} className="block w-full min-h-11 rounded-lg border border-outline-variant bg-surface px-3" value={selectedSourceId} onChange={(event) => setSourceId(event.target.value)}>
            {sources.map(({ ref }) => <option key={ref.id} value={ref.id}>{ref.documentTitle}{ref.sectionLabel ? ` · ${ref.sectionLabel}` : ''}</option>)}
          </select>
        </label>
        <label className="block space-y-1" htmlFor={`${fieldId}-passage`}>
          <span>{t('studyPlans.reading.passage')}</span>
          <textarea id={`${fieldId}-passage`} rows={3} required className="block w-full rounded-lg border border-outline-variant bg-surface px-3 py-2" value={passage} onChange={(event) => setPassage(event.target.value)} />
        </label>
        <Button size="sm" variant="tonal" type="submit" disabled={!passage.trim() || Boolean(reading.status)}>{t('studyPlans.reading.verifySave')}</Button>
      </form>
    </details>
  );
}
