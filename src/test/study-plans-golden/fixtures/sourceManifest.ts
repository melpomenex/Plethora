/**
 * C8-T01 source-ref manifest (s1–s8) with exact excerpts and locator shapes.
 * Hashes/revisions are computed from fixture bytes at test time, never trusted.
 */
import { OS_EPUB_CFI_RANGE, OS_EPUB_PARAGRAPH, OS_PDF_PAGES, OS_VIDEO_EXTRACTS } from './osCourse';

export interface GoldenSourceEntry {
  handle: string;
  alias: string;
  documentId: string;
  extractId?: string;
  excerpt: string;
  locator:
    | { kind: 'pdf'; page: number }
    | { kind: 'epub'; cfiRange: string }
    | { kind: 'video'; seconds: [number, number]; segmentId: string };
  usedFor: string;
}

export const SOURCE_MANIFEST: GoldenSourceEntry[] = [
  { handle: 's1', alias: 'SSR-PDF-PREREQ', documentId: 'doc_fixture_os_pdf', excerpt: OS_PDF_PAGES[0], locator: { kind: 'pdf', page: 1 }, usedFor: 'plan prerequisites' },
  { handle: 's2', alias: 'SSR-PDF-PROCESS', documentId: 'doc_fixture_os_pdf', excerpt: 'A process is an executing program.', locator: { kind: 'pdf', page: 2 }, usedFor: 'N1, Q1' },
  { handle: 's3', alias: 'SSR-PDF-CONTEXT', documentId: 'doc_fixture_os_pdf', excerpt: OS_PDF_PAGES[2], locator: { kind: 'pdf', page: 3 }, usedFor: 'N2 support' },
  { handle: 's4', alias: 'SSR-PDF-TLB', documentId: 'doc_fixture_os_pdf', excerpt: OS_PDF_PAGES[3], locator: { kind: 'pdf', page: 4 }, usedFor: 'N3, Q3' },
  { handle: 's5', alias: 'SSR-PDF-FAULT', documentId: 'doc_fixture_os_pdf', excerpt: OS_PDF_PAGES[4], locator: { kind: 'pdf', page: 5 }, usedFor: 'N4, Q4, tutor' },
  { handle: 's6', alias: 'SSR-VIDEO-RR', documentId: 'doc_fixture_os_video', extractId: 'vext_fixture_rr', excerpt: OS_VIDEO_EXTRACTS[0].text, locator: { kind: 'video', seconds: [70, 99], segmentId: 'seg_fixture_rr' }, usedFor: 'N2, Q2, practice, tutor' },
  { handle: 's7', alias: 'SSR-VIDEO-FCFS', documentId: 'doc_fixture_os_video', extractId: 'vext_fixture_fcfs', excerpt: OS_VIDEO_EXTRACTS[1].text, locator: { kind: 'video', seconds: [300, 325], segmentId: 'seg_fixture_fcfs' }, usedFor: 'N2, Q6, follow-up' },
  { handle: 's8', alias: 'SSR-EPUB-SEM', documentId: 'doc_fixture_os_epub', excerpt: OS_EPUB_PARAGRAPH, locator: { kind: 'epub', cfiRange: OS_EPUB_CFI_RANGE }, usedFor: 'N5, Q5' },
];
