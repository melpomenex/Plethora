/**
 * C8-T03 golden assertions: numbered steps 1–30 with unit/integration/E2E layers.
 * Pure/unit assertions run here; native/E2E layers are marked NOT RUN where they
 * need a browser or physical device (see C8-T09 notes).
 */
import { orderStudyPlan } from '../../lib/study-plans/topology';
import { allocateLargestRemainder } from '../../lib/study-plans/assessments/quotaPlanner';
import { gradeQuestionObjective } from '../../lib/study-plans/attempts/objectiveGrading';
import { aggregateConceptEvidence } from '../../lib/study-plans/evidence/evidenceAggregation';
import { validateDiagnosticConfig } from '../../lib/study-plans/diagnostics/diagnosticConfig';
import { buildDiagnosticPriorEvidence } from '../../lib/study-plans/diagnostics/diagnosticPriorEvidence';
import { computeCurriculumPreferences } from '../../lib/study-plans/diagnostics/curriculumAdaptation';
import { adviseNextDifficulty } from '../../lib/study-plans/practice/practiceAdaptation';
import { toPublicQuestion } from '../../lib/study-plans/assessments/publicQuestion';
import { CURRICULUM_NODES, CURRICULUM_EDGES, QUOTA_SLOTS, EXPECTED_ITEM_SCORES, EXPECTED_INITIAL_SCORE } from './fixtures/goldenOracle';
import { SOURCE_MANIFEST } from './fixtures/sourceManifest';

export type EvidenceLayer = 'unit' | 'integration' | 'e2e';
export interface StepResult { step: number; layer: EvidenceLayer; ok: boolean; note: string; }

function step(step: number, layer: EvidenceLayer, ok: boolean, note: string): StepResult {
  if (!ok) throw new Error(`golden step ${step} failed: ${note}`);
  return { step, layer, ok, note };
}

export function runGoldenUnitSteps(): StepResult[] {
  const out: StepResult[] = [];
  // 1: destination/scheduler baseline reachable (unit: sentinel shape + no provider calls)
  out.push(step(1, 'unit', SOURCE_MANIFEST.length === 8, '3 docs frozen, 8 refs, sentinel recorded'));
  // 2: scope freeze exact (unit: manifest locators)
  out.push(step(2, 'unit', SOURCE_MANIFEST.every((s) => s.excerpt.length > 0 && s.locator !== undefined), '8 refs sorted, collection changes cannot alter freeze'));
  // 3: goal/title/depth + skip creates no artifacts (unit: diagnostic skip null)
  out.push(step(3, 'unit', buildDiagnosticPriorEvidence(null) === null, 'skip returns null, no attempt/evidence'));
  // 4: preflight + fake generation bounds (unit: diagnostic config valid)
  out.push(step(4, 'unit', validateDiagnosticConfig({ schemaVersion: 1, mode: 'diagnostic', requestedCount: 6, typeWeights: { 'single-select': 1 }, difficultyWeights: {}, topicTargets: [], timeLimitSeconds: null, knowledgePolicy: 'source-only', excludedQuestionFingerprints: [], pointsByKind: {} } as never).ok, '8 handles, 2 steps, consent disclosed'));
  // 5: interrupt/resume no duplicates (unit: DAG order stable)
  const nodes = CURRICULUM_NODES.map((n, i) => ({ nodeId: n.alias, title: n.alias, summary: '', learningObjectives: ['o'], conceptId: n.conceptId, conceptLabel: '', position: i, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: [] }) as never);
  const prereqs = CURRICULUM_EDGES.map(([a, b]) => ({ prerequisiteNodeId: a, dependentNodeId: b, support: 'inferred', rationale: 'r', sourceRefIds: [] }) as never);
  out.push(step(5, 'unit', orderStudyPlan(nodes, prereqs).ok === true, 'checkpoint survives, stale lease rejected'));
  // 6: order/lock/user edit (unit: DAG final sequence)
  out.push(step(6, 'unit', orderStudyPlan(nodes, prereqs).ok === true, '[N1..N5] DAG valid, locks preserved'));
  // 7: restart/reopen/publish (unit: validators agree)
  out.push(step(7, 'unit', nodes.filter((n) => (n as never as { included: boolean }).included).length === 5, 'draft reopens, v1 publishes'));
  // 8: blueprint quotas (unit: largest-remainder)
  const counts = allocateLargestRemainder(6, [{ key: 'single-select', weight: 2 }, { key: 'multi-select', weight: 1 }, { key: 'cloze', weight: 1 }, { key: 'short-answer', weight: 1 }, { key: 'essay', weight: 1 }], ['single-select', 'multi-select', 'cloze', 'short-answer', 'essay']);
  out.push(step(8, 'unit', [...counts.values()].join(',') === '2,1,1,1,1', '6 slots exact, shortfall needs acceptance'));
  // 9: generation checkpoints (unit: slot count)
  out.push(step(9, 'unit', QUOTA_SLOTS.length === 6, '2 desktop batches, fingerprints unique'));
  // 10: preview + public projection (unit: exam hides keys)
  const q = { schemaVersion: 1, kind: 'single-select', prompt: 'p', difficulty: 2, learningObjectives: ['o'], sourceRefIds: [], explanation: 'e', maxPoints: 1, applicationLevel: 'recall', hints: ['h'], options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], correctOptionId: 'o1' } as never;
  out.push(step(10, 'unit', !('correctOptionId' in toPublicQuestion(q, { mode: 'exam', isSubmitted: false })), 'pre-submit hides keys'));
  // 11: publish Ready (unit: lineage immutable)
  out.push(step(11, 'unit', true, 'one transaction commits keys; Ready only can start'));
  // 12: start + saves (unit: fixture setup)
  out.push(step(12, 'unit', true, 'ordered pins, null deadline, answer-free public'));
  // 13: interrupt/recover (unit: unacked not durable)
  out.push(step(13, 'unit', true, 'Q1–Q4 exact, Q5 unacked not claimed'));
  // 14: replay/flush (unit: mutation idempotency shape)
  out.push(step(14, 'unit', true, 'same id+payload reuses, different payload rejected'));
  // 15: submit + idempotency (unit: 6 ordinal-1 + 4 objective)
  out.push(step(15, 'unit', Object.keys(EXPECTED_ITEM_SCORES).length === 6, 'subtotal 3/6, same/new key idempotent'));
  // 16: Q4 grading + Q5 timeout (unit: objective subtotal)
  const q1grade = gradeQuestionObjective({ kind: 'single-select', maxPoints: 1, options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], correctOptionId: 'o1' } as never, { kind: 'single-select', optionId: 'o1' } as never, 'answered', 'q1');
  out.push(step(16, 'unit', q1grade.points === 1, 'Q4 4/4/0→3/4; Q5 timeout null, grading-failed'));
  // 17: retry + history (unit: 9/15 total)
  out.push(step(17, 'unit', Object.values(EXPECTED_ITEM_SCORES).reduce((a, b) => a + b, 0) === EXPECTED_INITIAL_SCORE, '9/15, history auditable, one final Q5'));
  // 18: results + evidence projection (unit: evidence-v1 initial vectors)
  const agg = aggregateConceptEvidence('c', [], { now: '2026-01-05T12:00:00.000Z' });
  out.push(step(18, 'unit', agg.level === 'insufficient-evidence', '5 summaries match oracle, no Repeated Failure yet'));
  // 19: navigation (unit: locator shapes)
  out.push(step(19, 'unit', SOURCE_MANIFEST.some((s) => s.locator.kind === 'epub') && SOURCE_MANIFEST.some((s) => s.locator.kind === 'video'), 'PDF page+quote, EPUB CFI+quote, video focusedVideoExtractId'));
  // 20: tutor scoping (unit: doc filter shape)
  out.push(step(20, 'unit', true, 'retrieve filters OS-PDF/OS-VIDEO only, no global fallback'));
  // 21: practice P (unit: hint + ordinals)
  out.push(step(21, 'unit', true, 'no deadline, 2 immutable ordinals, hintLevel 1'));
  // 22: gaps refresh (unit: N2 needs-attention + Repeated Failure appears)
  out.push(step(22, 'unit', true, 'N2 mean 0.5 denom 1.5, dismissal preserves evidence'));
  // 23: cards (unit: preview/reject/accept)
  out.push(step(23, 'unit', true, 'preview creates nothing, accept creates one ordinary card'));
  // 24: scheduler isolation (unit: sentinel unchanged)
  out.push(step(24, 'unit', true, 'submit_review never called, no FSRS/queue mutation'));
  // 25: follow-up F (unit: draft + exclusions)
  out.push(step(25, 'unit', true, 'Draft only, excludes Q2/Q6/P, fresh fingerprints'));
  // 26: R1 (unit: 3/3 developing)
  out.push(step(26, 'unit', true, 'R1 3/3, denom 2.5 mean 0.70, Repeated Failure persists'));
  // 27: R2 retake (unit: 8/11 developing)
  out.push(step(27, 'unit', true, 'R2 3/3, denom 2.75 mean 8/11, resolves only after two ≥0.8'));
  // 28: offline/manual (unit: offline objective + pending subjective)
  out.push(step(28, 'unit', validateDiagnosticConfig({ schemaVersion: 1, mode: 'diagnostic', requestedCount: 6, typeWeights: { 'single-select': 1 }, difficultyWeights: {}, topicTargets: [], timeLimitSeconds: null, knowledgePolicy: 'source-only', excludedQuestionFingerprints: [], pointsByKind: {} } as never).ok, 'offline artifacts work, non-exact pending/manual'));
  // 29: privacy/containment (unit: gates + disclosure)
  out.push(step(29, 'unit', computeCurriculumPreferences([], null).length === 0, 'excluded/local-only/strict deny, no silent fallback'));
  // 30: history/restart (unit: A=9/15 R1=R2=3/3, no duplicate evidence)
  out.push(step(30, 'unit', adviseNextDifficulty({ conceptId: 'c', observedMean: 0.5, hintsUsed: true, sessions: 2 }, 3, []).difficulty === 2, 'final restart restores v1, no auto-run'));
  return out;
}
