import { create } from 'zustand';
import { getDocument } from '../../../api/documents';
import { saveStudyTrailSession } from '../../../api/study-reading';
import { useTabsStore } from '../../../stores/tabsStore';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import type { ExactSearchHitLocation } from '../../../types/searchHit';
import type {
  StudyReadingAssignment, StudyReadingTrail, StudyTrailNavigationResult,
  StudyTrailNavigationStatus, StudyTrailSession,
} from '../../../types/studyReading';
import { openDocumentAtLocation } from '../../../utils/openDocumentAtLocation';
import { orderStudyPlan } from '../topology';

export interface TrailRequest {
  id: number;
  assignment: StudyReadingAssignment;
  signal: AbortSignal;
  coarse: boolean;
}

interface TrailOptions {
  topicId?: string;
  startAssignmentId?: string;
  originTabId?: string;
  onPractice?: (topicId: string) => void;
}

interface ActiveTrail {
  detail: StudyPlanDetail;
  trail: StudyReadingTrail;
  assignments: StudyReadingAssignment[];
  topics: StudyPlanDetail['version']['nodes'];
  options: TrailOptions;
}

interface TrailState {
  active: ActiveTrail | null;
  request: TrailRequest | null;
  tabId: string | null;
  originTabId?: string;
  status: StudyTrailNavigationStatus | 'loading';
  saving: boolean;
  saveError: boolean;
}

const initialState: TrailState = {
  active: null, request: null, tabId: null, originTabId: undefined,
  status: 'loading', saving: false, saveError: false,
};
export const useStudyTrail = create<TrailState>(() => initialState);

let nextRequestId = 0;
let pendingNavigation: AbortController | undefined;
let readerTimeout: ReturnType<typeof setTimeout> | undefined;
let owner = 0;

export function acknowledgeStudyPassage(result: StudyTrailNavigationResult) {
  const { request } = useStudyTrail.getState();
  if (request?.id !== result.requestId || request.assignment.id !== result.assignmentId || request.signal.aborted) return;
  clearTimeout(readerTimeout);
  useStudyTrail.setState({ status: result.status });
}

function focusOrigin(originTabId?: string) {
  const tabs = useTabsStore.getState();
  const origin = tabs.getWorkspaceTabs().find(({ tab }) => tab.id === originTabId);
  if (origin?.paneId) {
    tabs.setNavigationPane(origin.paneId);
    tabs.setActiveTab(origin.paneId, origin.tab.id);
  } else {
    window.dispatchEvent(new CustomEvent('navigate', { detail: '/study-plans' }));
  }
}

export function exitStudyTrail(returnToPlan = false, practice = false) {
  const { active, originTabId, request } = useStudyTrail.getState();
  owner += 1;
  pendingNavigation?.abort();
  clearTimeout(readerTimeout);
  useStudyTrail.setState(initialState);
  if (returnToPlan) focusOrigin(originTabId);
  if (practice && request) active?.options.onPractice?.(request.assignment.topicId);
}

export function coarseStudyJump(assignment: StudyReadingAssignment): ExactSearchHitLocation | undefined {
  const hint = assignment.segments[0]?.location;
  if (hint?.kind === 'pdf') return { kind: 'pdf', pageNumber: hint.pageNumber };
  if (hint?.kind === 'epub' && hint.cfi.trim()) return { kind: 'epub', cfi: hint.cfi };
  if (hint?.kind === 'html' && (hint.selector || hint.scrollPercent != null)) {
    return { kind: 'html', selector: hint.selector, scrollPercent: hint.scrollPercent };
  }
  if (hint?.kind === 'markdown' && hint.scrollPercent != null) {
    return { kind: 'markdown', scrollPercent: hint.scrollPercent };
  }
}

async function navigateAssignment(assignment: StudyReadingAssignment, coarse = false) {
  pendingNavigation?.abort();
  clearTimeout(readerTimeout);
  const controller = new AbortController();
  pendingNavigation = controller;
  const request = { id: ++nextRequestId, assignment, signal: controller.signal, coarse };
  const report = (status: StudyTrailNavigationStatus) =>
    acknowledgeStudyPassage({ status, requestId: request.id, assignmentId: assignment.id });
  useStudyTrail.setState({ request, status: 'loading', saveError: false });
  let doc;
  try {
    doc = await getDocument(assignment.documentId);
  } catch {
    report('failed');
    return false;
  }
  if (controller.signal.aborted) return false;
  if (!doc || doc.isArchived) {
    report('missing');
    return false;
  }
  const liveRevision = doc.contentHash?.trim() || doc.contentUpdatedAt?.trim() || doc.dateAdded?.trim();
  if (doc.isAiExcluded || liveRevision !== assignment.documentRevision) {
    report('stale');
    return false;
  }
  if (doc.fileType !== assignment.format && !(doc.fileType === 'other' && assignment.format === 'markdown')) {
    report('unsupported');
    return false;
  }

  const tabs = useTabsStore.getState();
  const opened = await openDocumentAtLocation(doc.id, {
    resolvedDocument: doc,
    signal: controller.signal,
    initialJump: coarse ? coarseStudyJump(assignment) : undefined,
    onOpened: (tabId) => {
      if (controller.signal.aborted) return;
      useStudyTrail.setState({ tabId });
      const paneId = useTabsStore.getState().getWorkspaceTabs().find(({ tab }) => tab.id === tabId)?.paneId;
      if (paneId) useTabsStore.getState().setNavigationPane(paneId);
    },
  }, tabs.addTab);
  if (controller.signal.aborted) return false;
  if (!opened) report('failed');
  else if (coarse) report('coarse');
  else if (useStudyTrail.getState().status === 'loading') {
    readerTimeout = setTimeout(() => {
      report('failed');
      controller.abort();
    }, 25000);
  }
  return opened;
}

const blankSession: StudyTrailSession = {
  topicId: null, currentAssignmentId: null, completedAssignmentIds: [], skippedAssignmentIds: [],
};

export async function startStudyTrail(detail: StudyPlanDetail, trail: StudyReadingTrail, options: TrailOptions) {
  if (detail.plan.id !== trail.planId || detail.version.id !== trail.versionId) throw new Error('Reading trail version mismatch.');
  const order = orderStudyPlan(detail.version.nodes, detail.version.prerequisites);
  if (!order.ok) throw new Error('The topic order could not be resolved.');
  const topics = order.value.orderedNodes;
  const assignments = topics.flatMap((topic) => trail.manifest.assignments.filter((item) =>
    item.topicId === topic.nodeId && (!options.topicId || options.topicId === item.topicId),
  ));
  const previous = trail.session ?? blankSession;
  const assignment = assignments.find((item) => item.id === options.startAssignmentId)
    ?? assignments.find((item) => item.id === previous.currentAssignmentId)
    ?? assignments.find((item) => !previous.completedAssignmentIds.includes(item.id) && !previous.skippedAssignmentIds.includes(item.id))
    ?? assignments[0];
  if (!assignment) throw new Error('No reading passages are available.');
  exitStudyTrail();
  const token = owner;
  const topicId = options.topicId ?? null;
  const saved = previous.currentAssignmentId === assignment.id && previous.topicId === topicId
    ? trail
    : await saveStudyTrailSession(trail.planId, trail.versionId, trail.revision, {
      ...previous, currentAssignmentId: assignment.id, topicId,
    });
  if (token !== owner) return;
  useStudyTrail.setState({
    active: { detail, trail: saved, assignments, topics, options },
    originTabId: options.originTabId,
    tabId: options.originTabId ?? null,
  });
  const opened = await navigateAssignment(assignment);
  if (!opened && token === owner && !useStudyTrail.getState().tabId) {
    const status = useStudyTrail.getState().status;
    exitStudyTrail();
    throw new Error(status === 'stale' ? 'The source changed or is excluded. Refresh the reading assignments.'
      : status === 'missing' ? 'The source is missing or archived.' : 'The document reader could not be opened.');
  }
}

export async function reviewStudyPassage(assignment: StudyReadingAssignment, originTabId?: string) {
  exitStudyTrail();
  const token = owner;
  useStudyTrail.setState({ originTabId });
  const opened = await navigateAssignment(assignment);
  if (!opened && token === owner) {
    exitStudyTrail();
    throw new Error('The supporting passage is unavailable.');
  }
}

export function readingTopicComplete(active: ActiveTrail, topicId: string) {
  const entries = active.assignments.filter((item) => item.topicId === topicId);
  return entries.length > 0 && entries.every((item) => active.trail.session?.completedAssignmentIds.includes(item.id));
}

function passageFinished(active: ActiveTrail, id: string) {
  const session = active.trail.session;
  return session?.completedAssignmentIds.includes(id) || session?.skippedAssignmentIds.includes(id);
}

function prerequisiteReady(active: ActiveTrail, topicId: string) {
  return active.detail.version.prerequisites.filter((edge) => edge.dependentNodeId === topicId).every((edge) => {
    const activity = active.detail.activityByNodeId[edge.prerequisiteNodeId];
    if (activity === 'completed' || activity === 'skipped') return true;
    const assigned = active.trail.manifest.assignments.filter((item) => item.topicId === edge.prerequisiteNodeId);
    return assigned.length > 0 && assigned.every((item) => passageFinished(active, item.id));
  });
}

export function nextStudyPassage(active: ActiveTrail, assignment: StudyReadingAssignment) {
  const index = active.assignments.findIndex((item) => item.id === assignment.id);
  const next = active.assignments[index + 1];
  if (!next || next.topicId === assignment.topicId) return next;
  const unfinished = active.assignments.filter((item) => item.topicId === assignment.topicId)
    .find((item) => !passageFinished(active, item.id));
  if (unfinished) return unfinished.id === assignment.id ? undefined : unfinished;
  return active.assignments.slice(index + 1).find((item) => prerequisiteReady(active, item.topicId));
}

async function updateSession(active: ActiveTrail, session: StudyTrailSession) {
  const token = owner;
  useStudyTrail.setState({ saving: true, saveError: false });
  try {
    const trail = await saveStudyTrailSession(active.trail.planId, active.trail.versionId, active.trail.revision, session);
    if (token !== owner) return false;
    useStudyTrail.setState({ active: { ...active, trail } });
    return true;
  } catch {
    if (token === owner) useStudyTrail.setState({ saveError: true });
    return false;
  } finally {
    if (token === owner) useStudyTrail.setState({ saving: false });
  }
}

export async function moveStudyPassage(direction: -1 | 1) {
  const { active, request, saving } = useStudyTrail.getState();
  if (!active || !request || saving) return;
  const current = active.assignments.findIndex((item) => item.id === request.assignment.id);
  const assignment = direction < 0 ? active.assignments[current - 1] : nextStudyPassage(active, request.assignment);
  if (!assignment) return;
  if (await updateSession(active, { ...(active.trail.session ?? blankSession), currentAssignmentId: assignment.id })) {
    await navigateAssignment(assignment);
  }
}

export async function finishStudyPassage(skip: boolean) {
  const { active, request, status, saving } = useStudyTrail.getState();
  if (!active || !request || saving || (!skip && status !== 'exact')) return;
  const id = request.assignment.id;
  const session = active.trail.session ?? blankSession;
  if (session.completedAssignmentIds.includes(id)) return;
  const completedAssignmentIds = skip ? session.completedAssignmentIds : [...session.completedAssignmentIds, id];
  const skippedAssignmentIds = session.skippedAssignmentIds.filter((item) => item !== id);
  if (skip) skippedAssignmentIds.push(id);
  await updateSession(active, { ...session, completedAssignmentIds, skippedAssignmentIds });
}

export function retryStudyPassage(coarse = false) {
  const { request, saving } = useStudyTrail.getState();
  if (request && !saving) return navigateAssignment(request.assignment, coarse);
}
