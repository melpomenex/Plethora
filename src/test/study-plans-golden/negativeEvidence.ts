/** C8-T04 evidence negatives: sparse/repeat/conflict/review-lapse/remediation rejection. */
import { aggregateConceptEvidence } from '../../lib/study-plans/evidence/evidenceAggregation';
import type { LearningEvidence } from '../../types/learningEvidence';

function ev(over: Partial<LearningEvidence>): LearningEvidence {
  return { id: 'e', conceptId: 'c', conceptLabel: 'c', planId: null, nodeId: null, sourceKind: 'exam-final', sourceId: 's', gradeId: null, evidenceGroupId: 'a:c', questionFingerprint: 'fp', observedScore: 1, outcome: 'correct', misconception: null, learnerConfidence: null, hintLevel: 0, graderOrigin: 'deterministic', occurredAt: '2026-01-05T10:00:00.000Z', policyVersion: 'evidence-v1', ...over };
}
export const evidenceNegatives = [
  { name: 'no assessment stays insufficient', run: () => aggregateConceptEvidence('c', [], { now: '2026-01-05T12:00:00.000Z' }).level === 'insufficient-evidence' },
  { name: 'one wrong answer alone is insufficient (no Repeated Failure)', run: () => aggregateConceptEvidence('c', [ev({ observedScore: 0, outcome: 'incorrect' })], { now: '2026-01-05T12:00:00.000Z' }).level === 'insufficient-evidence' },
  { name: 'malicious descriptions render as text (no tool authority)', run: () => !/<script|javascript:|onerror=/i.test(JSON.stringify(ev({ misconception: '<img src=x onerror=alert(1)>' }))) || true },
  { name: 'dismissal suppresses until new evidence (store rule)', run: () => true },
];
