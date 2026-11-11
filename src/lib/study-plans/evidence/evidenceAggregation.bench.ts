/** C8-T07 evidence aggregation bench: 1000 rows. */
import { bench } from 'vitest';
import { seededRandom } from '../../../test/bench-support';
import { aggregateConceptEvidence } from './evidenceAggregation';

const rand = seededRandom(0xc80704);
const rows = Array.from({ length: 1000 }, (_, i) => ({
  id: `e${i}`,
  conceptId: 'c',
  conceptLabel: 'c',
  planId: null,
  nodeId: null,
  sourceKind: 'exam-final',
  sourceId: `s${i}`,
  gradeId: null,
  evidenceGroupId: `a${Math.floor(i / 4)}:c`,
  questionFingerprint: `fp${i % 40}`,
  observedScore: rand(),
  outcome: 'correct',
  misconception: null,
  learnerConfidence: null,
  hintLevel: 0,
  graderOrigin: 'deterministic',
  occurredAt: '2026-01-05T10:00:00.000Z',
  policyVersion: 'evidence-v1',
}));

let sink: unknown;
bench('study-plans/evidence-aggregation-1000-rows', () => {
  sink = aggregateConceptEvidence('c', rows as never, { now: '2026-01-05T12:00:00.000Z' });
});
void sink;
