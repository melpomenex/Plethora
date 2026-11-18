import { useEffect } from 'react';
import type { Document } from '../../../types/document';
import type { StudyTrailNavigationStatus } from '../../../types/studyReading';
import type { EpubVimRuntime, PdfVimRuntime } from '../../../utils/vim/readerRuntimes';
import { attachEpubPassage, attachPdfPassage } from './readerAdapters';
import { paintReadingPassage, revealReadingRange } from './paintReadingPassage';
import { resolveDomPassage } from './resolveReadingRange';
import { acknowledgeStudyPassage, coarseStudyJump, useStudyTrail } from './trailController';

interface ReaderSurface {
  document: Document | null | undefined;
  tabId?: string;
  foreground: boolean;
  ready: boolean;
  surfaceCanShowPassage: boolean;
  appearanceKey?: string;
  epub: EpubVimRuntime | null;
  pdf: PdfVimRuntime | null;
  root: Element | null;
}

export function useStudyTrailReader(surface: ReaderSurface) {
  const request = useStudyTrail((state) => state.tabId && state.tabId === surface.tabId &&
    state.request?.assignment.documentId === surface.document?.id ? state.request : null);
  const { document, foreground, ready, surfaceCanShowPassage, appearanceKey, epub, pdf, root } = surface;
  const revision = document?.contentHash?.trim() || document?.contentUpdatedAt?.trim() || document?.dateAdded?.trim();
  useEffect(() => {
    if (!request || request.coarse || request.signal.aborted || !foreground || !ready) return;
    const local = new AbortController();
    const abort = () => local.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const { signal } = local;
    const { assignment } = request;
    const report = (status: StudyTrailNavigationStatus) => {
      if (!signal.aborted) acknowledgeStudyPassage({ status, requestId: request.id, assignmentId: assignment.id });
    };
    const jump = useStudyTrail.getState().status === 'loading';
    let cleanup: (() => void) | undefined;
    let frame = 0;
    if (revision !== assignment.documentRevision) {
      report('stale');
    } else if (!surfaceCanShowPassage) {
      report(coarseStudyJump(assignment) ? 'coarse' : 'unsupported');
    } else {
      const run = async () => {
        const started = performance.now();
        try {
          if (assignment.format === 'epub' && epub) cleanup = await attachEpubPassage(epub, request, signal, jump, report);
          else if (assignment.format === 'pdf' && pdf) cleanup = await attachPdfPassage(pdf, request, signal, jump, report);
          else if (root && (assignment.format === 'html' || assignment.format === 'markdown' || (assignment.format === 'pdf' && !pdf))) {
            let remove: (() => void) | undefined;
            let initial = jump;
            let shouldReveal = jump || (assignment.format === 'pdf' && !pdf);
            const present = () => {
              if (signal.aborted) return;
              const result = resolveDomPassage(root, assignment.segments);
              remove?.();
              if (result.status === 'exact' && result.ranges.length) {
                const revealed = !shouldReveal || revealReadingRange(result.ranges[0]);
                if (revealed) {
                  let paintItems = result.ranges.map((range, index) => ({
                    range, start: index === 0, end: index === result.ranges.length - 1,
                  }));
                  if (result.ranges.length === 2) {
                    try {
                      const spanned = root.ownerDocument.createRange();
                      spanned.setStart(result.ranges[0].startContainer, result.ranges[0].startOffset);
                      spanned.setEnd(result.ranges[1].endContainer, result.ranges[1].endOffset);
                      paintItems = [{ range: spanned, start: true, end: true }];
                    } catch { /* fallback to endpoints */ }
                  }
                  remove = paintReadingPassage(root, paintItems, request.id);
                  if (initial) report('exact');
                } else if (initial) report(coarseStudyJump(assignment) ? 'coarse' : 'unsupported');
              } else if (initial) {
                report(result.status === 'ambiguous' ? 'ambiguous' : coarseStudyJump(assignment) ? 'coarse' : 'unsupported');
              }
              initial = false;
              shouldReveal = false;
            };
            present();
            const observer = new MutationObserver((records) => {
              if (records.every((record) => (record.target as Element).closest?.('[data-study-decoration]') ||
                (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(
                  (node) => (node as Element).hasAttribute?.('data-study-decoration'),
                )))) return;
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(present);
            });
            observer.observe(root, { subtree: true, childList: true, characterData: true });
            cleanup = () => { observer.disconnect(); remove?.(); };
          }
        } catch {
          report('failed');
        } finally {
          if (signal.aborted) cleanup?.();
          if (jump && !signal.aborted) {
            const category = `study-trail:${assignment.format}:${useStudyTrail.getState().status}`;
            performance.clearMeasures(category);
            performance.measure(category, {
              start: started, end: performance.now(),
            });
          }
        }
      };
      frame = requestAnimationFrame(() => { void run(); });
    }
    return () => {
      local.abort();
      cancelAnimationFrame(frame);
      cleanup?.();
      request.signal.removeEventListener('abort', abort);
    };
  }, [appearanceKey, epub, foreground, pdf, ready, request, revision, root, surfaceCanShowPassage]);
}
