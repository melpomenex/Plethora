/**
 * C8-T01 synthetic OS course corpus (no copyrighted/external text).
 * Exact fixture content from 07-GOLDEN-SCENARIO.md §2.
 */
export const OS_PDF_ID = 'doc_fixture_os_pdf';
export const OS_VIDEO_ID = 'doc_fixture_os_video';
export const OS_EPUB_ID = 'doc_fixture_os_epub';

export const OS_PDF_PAGES: string[] = [
  'Study processes before scheduling, address translation, and semaphores. Study address translation and the TLB before page-fault handling.',
  'A process is an executing program. The operating system gives each process an address space and schedules its threads on the CPU.',
  'A context switch saves the current thread\'s CPU state and restores the next thread\'s CPU state. The scheduler chooses which runnable thread runs next.',
  'A translation lookaside buffer (TLB) caches page-table translations. A TLB miss does not necessarily mean a page fault: the page may still be resident and discoverable through a page-table walk.',
  'On a page fault, the processor traps to the operating system. If the referenced page is valid but not resident, the OS loads it from backing storage, updates the page table, and restarts the faulting instruction.',
];

export const OS_VIDEO_EXTRACTS = [
  {
    extractId: 'vext_fixture_rr',
    segmentId: 'seg_fixture_rr',
    startSeconds: 70,
    endSeconds: 99,
    text: 'Round Robin gives each runnable thread a time quantum. When the quantum expires, the thread moves to the back of the ready queue. A shorter quantum can improve responsiveness but adds more context-switch overhead.',
  },
  {
    extractId: 'vext_fixture_fcfs',
    segmentId: 'seg_fixture_fcfs',
    startSeconds: 300,
    endSeconds: 325,
    text: 'First Come First Served runs the first arriving job to completion. Round Robin rotates runnable jobs through fixed quanta.',
  },
];

export const OS_EPUB_CFI_RANGE = '/6/4[chap01ref]/2:0,/6/4[chap01ref]/2:312';
export const OS_EPUB_PARAGRAPH =
  'A binary semaphore used as a mutex starts at one. For a bounded buffer with N slots, initialize empty=N, full=0, and mutex=1. A producer performs wait(empty), then wait(mutex), appends the item, performs signal(mutex), and finally signal(full). Reversing the first two waits can deadlock: if the buffer is full, the producer holds mutex while waiting for empty, so the consumer cannot acquire mutex to remove an item.';

export const OS_CONCEPTS = [
  { id: 'concept_fixture_os_process', label: 'Processes and threads' },
  { id: 'concept_fixture_os_scheduling', label: 'CPU scheduling' },
  { id: 'concept_fixture_os_tlb', label: 'Address translation and TLBs' },
  { id: 'concept_fixture_os_page_fault', label: 'Page-fault handling' },
  { id: 'concept_fixture_os_semaphores', label: 'Bounded-buffer semaphores' },
] as const;

export const OS_CONFIRMED_LINKS = [
  { from: 'concept_fixture_os_process', to: 'concept_fixture_os_scheduling' },
  { from: 'concept_fixture_os_process', to: 'concept_fixture_os_tlb' },
  { from: 'concept_fixture_os_tlb', to: 'concept_fixture_os_page_fault' },
  { from: 'concept_fixture_os_process', to: 'concept_fixture_os_semaphores' },
] as const;

export const FIX_CLOCK = '2026-01-05T09:00:00.000Z';
export const FIX_EVIDENCE_CLOCK = '2026-01-05T12:00:00.000Z';

export const GOLDEN_PLAN_TITLE = 'Operating Systems — Synthetic Golden Plan';
export const GOLDEN_PLAN_GOAL =
  'Explain and apply process scheduling, address translation, page-fault handling and bounded-buffer synchronization using only the selected course material.';
export const GOLDEN_PLAN_DEPTH = 'foundational' as const;
