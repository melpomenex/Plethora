/**
 * C8-T01 curriculum + slots/questions/rubrics/answers/oracle (golden §§3–6).
 */
export interface GoldenNode { alias: string; handle: string; conceptId: string; objectives: string[]; handles: string[]; }
export const CURRICULUM_NODES: GoldenNode[] = [
  { alias: 'N1', handle: 'n1', conceptId: 'concept_fixture_os_process', objectives: ['Distinguish an executing process from a stored program.'], handles: ['s1', 's2'] },
  { alias: 'N2', handle: 'n2', conceptId: 'concept_fixture_os_scheduling', objectives: ['Compare FCFS and Round Robin; predict quantum-expiration behavior.'], handles: ['s1', 's3', 's6', 's7'] },
  { alias: 'N3', handle: 'n3', conceptId: 'concept_fixture_os_tlb', objectives: ['Explain the TLB and distinguish a TLB miss from a page fault.'], handles: ['s1', 's4'] },
  { alias: 'N4', handle: 'n4', conceptId: 'concept_fixture_os_page_fault', objectives: ['Sequence handling of a valid, non-resident page.'], handles: ['s1', 's5'] },
  { alias: 'N5', handle: 'n5', conceptId: 'concept_fixture_os_semaphores', objectives: ['Initialize and order semaphore operations for a bounded buffer.'], handles: ['s1', 's8'] },
];
export const CURRICULUM_EDGES = [['N1', 'N2'], ['N1', 'N3'], ['N3', 'N4'], ['N1', 'N5']] as const;
export const CURRICULUM_FINAL_ORDER = ['N1', 'N2', 'N3', 'N4', 'N5'] as const;

export interface GoldenSlot { index: string; topic: string; kind: string; difficulty: number; question: string; maxPoints: number; }
export const QUOTA_SLOTS: GoldenSlot[] = [
  { index: '0000', topic: 'N1', kind: 'single-select', difficulty: 2, question: 'Q1', maxPoints: 1 },
  { index: '0001', topic: 'N2', kind: 'multi-select', difficulty: 3, question: 'Q2', maxPoints: 2 },
  { index: '0002', topic: 'N3', kind: 'cloze', difficulty: 4, question: 'Q3', maxPoints: 2 },
  { index: '0003', topic: 'N4', kind: 'short-answer', difficulty: 5, question: 'Q4', maxPoints: 4 },
  { index: '0004', topic: 'N5', kind: 'essay', difficulty: 3, question: 'Q5', maxPoints: 5 },
  { index: '0005', topic: 'N2', kind: 'single-select', difficulty: 4, question: 'Q6', maxPoints: 1 },
];
export const EXPECTED_TOTAL = 15;
export const EXPECTED_INITIAL_SCORE = 9;

export const LEARNER_ANSWERS: Record<string, unknown> = {
  Q1: { kind: 'single-select', optionId: 'o1' },
  Q2: { kind: 'multi-select', optionIds: ['o1', 'o2'] },
  Q3: { kind: 'cloze', answers: { b_tlb: '  Translation Lookaside Buffer (TLB)  ', b_relation: 'does' } },
  Q4: { kind: 'short-answer', text: 'The CPU traps to the OS for a valid page that is not resident. The OS brings the page in from backing storage and changes the page table.' },
  Q5: { kind: 'essay', text: 'Set empty=2, full=0 and mutex=1. The producer waits for empty, then mutex, appends, signals mutex, then full. Swapping the waits is fine because the consumer can always make progress.' },
  Q6: { kind: 'single-select', optionId: 'o2' },
};
export const EXPECTED_ITEM_SCORES: Record<string, number> = { Q1: 1, Q2: 0, Q3: 1, Q4: 3, Q5: 3, Q6: 1 };
export const Q4_LEVELS = [4, 4, 0];
export const Q5_LEVELS = [4, 4, 0];

export interface EvidenceExpectation { sessions: number; days: number; mean: number; denom: number; uncertainties: string[]; }
export const INITIAL_EVIDENCE: Record<string, EvidenceExpectation> = {
  N1: { sessions: 1, days: 1, mean: 1, denom: 1, uncertainties: ['one-independent-session', 'few-independent-sessions', 'narrow-difficulty'] },
  N2: { sessions: 1, days: 1, mean: 0.5, denom: 1, uncertainties: ['one-independent-session', 'few-independent-sessions', 'conflicting-outcomes'] },
  N3: { sessions: 1, days: 1, mean: 0.5, denom: 1, uncertainties: ['one-independent-session', 'few-independent-sessions', 'narrow-difficulty'] },
  N4: { sessions: 1, days: 1, mean: 0.75, denom: 0.75, uncertainties: ['one-independent-session', 'few-independent-sessions', 'ai-graded', 'narrow-difficulty'] },
  N5: { sessions: 1, days: 1, mean: 0.6, denom: 0.75, uncertainties: ['one-independent-session', 'few-independent-sessions', 'ai-graded', 'narrow-difficulty'] },
};
export const AFTER_PRACTICE_N2: EvidenceExpectation = {
  sessions: 2, days: 1, mean: 0.5, denom: 1.5,
  uncertainties: ['few-independent-sessions', 'hints-used', 'conflicting-outcomes'],
};
export const AFTER_R1_N2: EvidenceExpectation = {
  sessions: 3, days: 1, mean: 0.7, denom: 2.5,
  uncertainties: ['hints-used', 'conflicting-outcomes'],
};
export const AFTER_R2_N2: EvidenceExpectation = {
  sessions: 4, days: 1, mean: 8 / 11, denom: 2.75,
  uncertainties: ['same-question-repetition', 'hints-used', 'conflicting-outcomes'],
};
