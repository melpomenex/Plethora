import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { first, last, makeBook, makePdf } from './fixtures/study-reading-sources';
import '../index.css';
import { ThemeProvider } from '../contexts/ThemeContext';
import { EPUBViewer } from '../components/viewer/EPUBViewer';
import { PDFViewer } from '../components/viewer/PDFViewer';
import { MarkdownViewer } from '../components/viewer/MarkdownViewer';
import { StudyTrailControls } from '../components/viewer/StudyTrailControls';
import { useStudyTrail } from '../lib/study-plans/reading/trailController';
import { useStudyTrailReader } from '../lib/study-plans/reading/useStudyTrailReader';
import type { EpubVimRuntime, PdfVimRuntime } from '../utils/vim/readerRuntimes';
import type { StudyReadingAssignment } from '../types/studyReading';
import type { Document as LibraryDocument } from '../types/document';

const parameters = new URLSearchParams(location.search);
const format = (parameters.get('format') ?? 'markdown') as StudyReadingAssignment['format'];
const ambiguous = parameters.has('ambiguous');
const scanned = parameters.has('scanned');
const pdfPages = parameters.has('virtualized') ? 44 : 2;
const tabId = 'trail-test';
const source = {
  id: format, fileType: format, contentHash: 'fixture-revision', title: 'Reading trail fixture',
  filePath: `fixture.${format}`, metadata: {}, content: `# One\n\nA **quorum** can intersect across two majorities.\n\n${ambiguous ? first : last}`,
} as LibraryDocument;

const book = format === 'epub' ? makeBook(ambiguous) : null;
const pdf = format === 'pdf' ? makePdf(scanned, pdfPages) : null;
let id = 0;
function begin() {
  const assignment: StudyReadingAssignment = {
    schemaVersion: 1, id: 'passage', topicId: 'topic', documentId: source.id,
    documentTitle: source.title, documentRevision: 'fixture-revision', format, objectiveIndexes: [], sourceRefIds: ['ref'],
    segments: format === 'pdf'
      ? [{ quote: { exact: first }, location: { kind: 'pdf', pageNumber: 1 } },
         { quote: { exact: last }, location: { kind: 'pdf', pageNumber: pdfPages } }]
      : [{ quote: { exact: first } }, ...(ambiguous ? [] : [{ quote: { exact: last } }])],
  };
  useStudyTrail.setState({
    tabId, status: 'loading', request: { id: ++id, assignment, signal: new AbortController().signal, coarse: false },
  });
}

function Fixture() {
  const [epub, setEpub] = useState<EpubVimRuntime | null>(null);
  const [pdfRuntime, setPdf] = useState<PdfVimRuntime | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const status = useStudyTrail((state) => state.status);
  useEffect(() => { void book?.then(setBytes); begin(); }, []);
  useStudyTrailReader({ document: source, tabId, ready: true, foreground: true, surfaceCanShowPassage: true, epub, pdf: pdfRuntime, root });
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b p-2">
        <output data-testid="status">{status}</output>
        <button type="button" onClick={begin}>Restart passage</button>
        {pdf && <button type="button" onClick={() => setScale(1.5)}>Zoom PDF</button>}
        {pdfPages > 2 && <button type="button" onClick={() => void pdfRuntime?.revealPage(pdfPages)}>View end page</button>}
        <StudyTrailControls tabId={tabId} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {format === 'markdown' && <MarkdownViewer document={source} content={source.content} onContentRoot={setRoot} />}
        {format === 'html' && (
          <iframe title="HTML fixture" className="h-full w-full" sandbox="allow-same-origin"
            srcDoc={`<p>A <strong>quorum</strong> can intersect across two majorities.</p><p>${ambiguous ? first : last}</p>`}
            onLoad={(event) => setRoot(event.currentTarget.contentDocument?.body ?? null)} />
        )}
        {bytes && <EPUBViewer documentId={source.id} doc={source} fileName="fixture.epub" fileData={bytes}
          onVimRuntimeChange={setEpub} autoFocusContent={false} embedded />}
        {pdf && <PDFViewer documentId={source.id} doc={source} fileData={pdf} pageNumber={page} onPageChange={setPage}
          scale={scale} zoomMode="custom" onVimRuntimeChange={setPdf} parentOwnsRestoration />}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture /></ThemeProvider>);
