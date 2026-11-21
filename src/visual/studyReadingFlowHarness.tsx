import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../styles/mobile.css';
import { ThemeProvider } from '../contexts/ThemeContext';
import { PresentationProvider } from '../contexts/PresentationContext';
import { useTabsStore, createTabPane } from '../stores/tabsStore';
import { TabContent } from '../components/common/Tabs/TabContent';
import { StudyPlanEditor } from '../components/study-plans/StudyPlanEditor';
import { AttemptResults } from '../components/study-plans/results/AttemptResults';
import { AttemptRunner } from '../components/study-plans/attempts/AttemptRunner';
import type { StudyPlanDetail, StudyPlanVersionNode } from '../types/learningPaths';
import type { StudyReadingTrail, StudyTrailSession } from '../types/studyReading';
import type { StudySourceResolution } from '../types/studySource';
import type { Document } from '../types/document';
import type { AttemptDetail, ExamResponse } from '../types/assessmentSessions';
import type { AssessmentConfigV1 } from '../types/assessmentQuestions';
import { first, makeBook, makePdf } from './fixtures/study-reading-sources';

const now = '2026-11-17T00:00:00Z';
const formats = ['markdown', 'html', 'epub', 'pdf'] as const;
const pdf = makePdf();
const bookUrl = makeBook().then((bytes) =>
  URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/epub+zip' })),
);
const documents = formats.map((format): Document => ({
  id: format, fileType: format, title: `Fixture ${format.toUpperCase()}`, filePath: `fixture.${format}`,
  contentHash: `revision-${format}`, contentUpdatedAt: now, dateAdded: now, dateModified: now, tags: [],
  isArchived: false, isFavorite: false, collectionId: 'fixture', extractCount: 0, learningItemCount: 0,
  priorityRating: 0, prioritySlider: 0, priorityScore: 0,
  content: format === 'html' ? '<article><h1>HTML source</h1><p>A <strong>quorum</strong> can intersect across two majorities.</p></article>'
    : format === 'markdown' ? '# Markdown source\n\nA **quorum** can intersect across two majorities.' : first,
}));
const nodes = documents.map((doc, position): StudyPlanVersionNode => ({
  nodeId: 'topic-' + doc.id, title: `Evidence in ${doc.fileType.toUpperCase()}`, summary: '', position, included: true,
  learningObjectives: ['Explain how quorums intersect'], conceptLabel: '', conceptId: null, whyHere: null,
  locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', sourceRefIds: ['ref-' + doc.id],
}));
const evidence = documents.map((doc): StudySourceResolution => ({
  status: 'current', navigation: 'exact',
  ref: {
    schemaVersion: 1, id: 'ref-' + doc.id, documentId: doc.id, excerpt: first, excerptSha256: 'sha256:fixture',
    revision: doc.contentHash!, revisionKind: 'content-hash', documentTitle: doc.title, sourceType: doc.fileType, capturedAt: now,
    jump: doc.fileType === 'pdf' ? { kind: 'pdf', pageNumber: 1 } : undefined,
  },
}));
const plan: StudyPlanDetail = {
  plan: { id: 'plan', title: 'Source-grounded reading fixture', goal: 'Verify a guided trail', depth: 'deep',
    status: 'active', currentVersionId: 'v1', currentVersion: 1, draftVersionId: null, revision: 1, createdAt: now, updatedAt: now },
  version: { id: 'v1', planId: 'plan', version: 1, state: 'published', baseVersionId: null,
    knowledgeAuthority: { kind: 'library', policy: 'source-only' }, nodes,
    prerequisites: nodes.slice(1).map((node, index) => ({
      prerequisiteNodeId: nodes[index].nodeId, dependentNodeId: node.nodeId, support: 'user', rationale: null, sourceRefIds: [],
    })),
    sourceScope: {
      schemaVersion: 1, selected: { documentIds: [...formats], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: documents.map((doc) => ({
        documentId: doc.id, title: doc.title, sourceType: doc.fileType, revision: doc.contentHash!,
        revisionKind: 'content-hash', extractIds: [], isAiExcluded: false, isLocalOnly: true,
      })),
      frozenAt: now, indexCompleteness: 'complete', limitations: [],
    },
    changeSummary: null, createdBy: 'user', createdAt: now, publishedAt: now,
  },
  activityByNodeId: {}, sourceRefs: Object.fromEntries(evidence.map((item) => [item.ref.id, item])),
};

const attempt = {
  attempt: {
    id: 'attempt', blueprintRevisionId: 'blueprint-v1', blueprintTitle: 'Verification quiz',
    mode: 'exam', status: 'complete', submittedAt: now, completedAt: now, startedAt: now,
    questionRevisionIds: ['question'], revision: 2, maxPoints: 1, awardedPoints: 0,
  },
  responses: [{ questionRevisionId: 'question', mark: 'answered', draft: { kind: 'single-select', optionId: 'wrong' } }],
  submissions: [],
  currentGrades: [{ questionRevisionId: 'question', state: 'final', outcome: 'incorrect', points: 0, maxPoints: 1 }],
  questions: [{
    id: 'question', committedAt: now, question: {
      kind: 'single-select', prompt: 'Can two quorums overlap?', maxPoints: 1, difficulty: 1, sourceRefIds: ['ref-html'],
      options: [{ id: 'yes', text: 'Yes' }, { id: 'wrong', text: 'No' }], correctOptionId: 'yes',
      learningObjectives: ['Explain how quorums intersect'], explanation: 'The passage describes overlap.',
    },
  }],
} as unknown as AttemptDetail;

const explanation = 'The passage describes overlap.';
let response: ExamResponse;
function beginAttempt(mode: 'exam' | 'practice'): AttemptDetail {
  const question = attempt.questions![0];
  const { explanation: _explanation, ...publicQuestion } = question.question;
  if ('correctOptionId' in publicQuestion) delete (publicQuestion as Partial<typeof publicQuestion>).correctOptionId;
  response = {
    id: 'response', attemptId: attempt.attempt.id, questionRevisionId: question.id,
    draft: { kind: 'single-select', optionId: '' }, mark: 'unanswered',
    revision: 0, lastClientMutationId: '', updatedAt: now,
  };
  return {
    ...attempt,
    attempt: { ...attempt.attempt, mode, status: 'in-progress', submittedAt: null, completedAt: null, revision: 1 },
    responses: [response], currentGrades: [],
    questions: [{ ...question, question: publicQuestion as typeof question.question }],
  };
}

const trailStorageKey = 'study-reading-flow-fixture';
const missingDocument = new URLSearchParams(window.location.search).get('missing');
const readerId = new URLSearchParams(window.location.search).get('reader');
const Reader = readerId ? (await import('../components/viewer/DocumentViewer')).DocumentViewer : null;
function readTrail(): StudyReadingTrail {
  return JSON.parse(localStorage.getItem(trailStorageKey) ?? 'null') ?? {
    planId: 'plan', versionId: 'v1', revision: 0, manifest: { assignments: [] }, session: null,
  };
}
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  configurable: true,
  value: {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case 'get_study_plan': return plan;
        case 'get_document': return args?.id === missingDocument ? null : documents.find((doc) => doc.id === args?.id) ?? null;
        case 'get_documents': return documents;
        case 'get_document_position':
        case 'find_session_by_document_id':
        case 'get_pdf_reflow_cache_page':
          return null;
        case 'get_epub_stream_url': return bookUrl;
        case 'read_document_file': return pdf.buffer.slice(0);
        case 'get_pdf_document_source_info':
          return { documentId: 'pdf', size: pdf.length, identity: 'fixture', fingerprint: 'fixture', maxChunkSize: 65536 };
        case 'read_pdf_document_range':
          return pdf.slice(Number(args?.offset), Number(args?.offset) + Number(args?.length)).buffer;
        case 'get_study_reading_trail': return readTrail();
        case 'get_study_attempt_sources': return evidence;
        case 'save_exam_response': {
          const input = args?.input as { mark: ExamResponse['mark']; draftJson: string; lastClientMutationId: string };
          response = {
            ...response, mark: input.mark, draft: JSON.parse(input.draftJson), revision: response.revision + 1,
            lastClientMutationId: input.lastClientMutationId,
          };
          return response;
        }
        case 'submit_exam_attempt': return { ...attempt, responses: [response] };
        case 'check_practice_response':
          return {
            responseRevision: response.revision + 1, attemptRevision: 2, explanation,
            submission: { id: 'practice-submission', mark: 'answered', ordinal: 1, hintLevel: 0 },
            grade: { outcome: 'correct', state: 'final', points: 1, maxPoints: 1 },
          };
        case 'get_assessment_blueprint_revision':
          return { blueprint: { planId: 'plan' }, revision: { planVersionId: 'v1', config: { knowledgePolicy: 'source-only' } } };
        case 'save_study_reading_manifest':
        case 'save_study_trail_session': {
          const previous = readTrail();
          if (args?.expectedRevision !== previous.revision || args?.versionId !== 'v1') throw new Error('Fixture CAS mismatch');
          const next = {
            ...previous, revision: previous.revision + 1,
            ...(command === 'save_study_reading_manifest' ? { manifest: args.manifest } : { session: args.session as StudyTrailSession }),
          };
          localStorage.setItem(trailStorageKey, JSON.stringify(next));
          return next;
        }
        default: return [];
      }
    },
    convertFileSrc: (path: string) => path,
  },
});

function StudyFixture() {
  const [results, setResults] = useState<AttemptDetail>();
  const [running, setRunning] = useState<AttemptDetail>();
  const [check, setCheck] = useState<AssessmentConfigV1>();
  if (running) return <AttemptRunner detail={running} sourceRefs={plan.sourceRefs}
    onExit={() => setRunning(undefined)} onComplete={(result) => {
      setRunning(undefined);
      setResults(result);
    }} />;
  if (results) return <AttemptResults detail={results} onBack={() => setResults(undefined)} className="h-full overflow-auto" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-4 p-2">
        <button type="button" onClick={() => setRunning(beginAttempt('exam'))}>Start fixture assessment</button>
        {check && <>
          <output>Practice request: {check.mode} · {check.requestedCount} · {check.knowledgePolicy}</output>
          <button type="button" onClick={() => setRunning(beginAttempt('practice'))}>Start fixture practice</button>
        </>}
      </div>
      <StudyPlanEditor planDetail={plan} onBack={() => {}} onOpenAssessmentBuilder={(_, __, ___, config) => setCheck(config)} />
    </div>
  );
}

const planTab = { id: 'plan-tab', type: 'study-plans', title: 'Study Plan', content: StudyFixture, icon: null, closable: false } as const;
const pane = createTabPane([planTab.id], planTab.id);
useTabsStore.setState({ tabs: [planTab], rootPane: pane, activeTabHistory: [planTab.id], navigationPaneId: pane.id });

function App() {
  const tabs = useTabsStore((state) => state.tabs);
  const root = useTabsStore((state) => state.rootPane);
  if (Reader && readerId) {
    return <main className="h-dvh"><Reader documentId={readerId} /></main>;
  }
  return <main className="h-dvh">{root.type === 'tabs' && (
    <TabContent tabs={tabs} activeTabId={root.activeTabId} paneId={root.id} />
  )}</main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><PresentationProvider><App /></PresentationProvider></ThemeProvider>,
);
