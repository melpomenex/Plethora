import { describe, expect, it } from 'vitest';
import { computeRecognition, buildEvents, achievementsFromEvents, type RecognitionObservation } from '../recognition';

describe('recognition (motivation 2.1)', () => {
  const check = (id: string, occurredAt: string, over: Partial<RecognitionObservation> = {}): RecognitionObservation => ({
    id,
    kind: 'independent-check',
    occurredAt,
    current: true,
    hintFree: true,
    deterministicOrManual: true,
    outcome: 'correct',
    ...over,
  });

  it('counts only current, hint-free, deterministic correct checks; excludes AI/unverified', () => {
    const events = buildEvents([
      check('c1', '2026-11-10'),
      check('c2', '2026-11-10', { outcome: 'incorrect' }),
      check('c3', '2026-11-10', { hintFree: false }),
      check('c4', '2026-11-10', { deterministicOrManual: false }),
      check('c5', '2026-11-10', { current: false }), // overturned
      { id: 'r1', kind: 'delayed-review', occurredAt: '2026-11-11', current: true },
      { id: 'x1', kind: 'accepted-correction', occurredAt: '2026-11-12', current: true },
    ]);
    expect(events.map((e) => e.id)).toEqual(['c1', 'r1', 'x1']);
  });

  it('dedupes repeated events by identity', () => {
    const events = buildEvents([check('c1', '2026-11-10'), check('c1', '2026-11-10')]);
    expect(events).toHaveLength(1);
  });

  it('thresholds achievements and honors quiet mode', () => {
    const observations: RecognitionObservation[] = [
      check('c1', '2026-11-10'),
      check('c2', '2026-11-11'),
      check('c3', '2026-11-12'),
      { id: 'r1', kind: 'delayed-review', occurredAt: '2026-11-12', current: true },
      { id: 'r2', kind: 'delayed-review', occurredAt: '2026-11-13', current: true },
      { id: 'r3', kind: 'delayed-review', occurredAt: '2026-11-14', current: true },
      { id: 'r4', kind: 'delayed-review', occurredAt: '2026-11-15', current: true },
      { id: 'r5', kind: 'delayed-review', occurredAt: '2026-11-16', current: true },
      { id: 'x1', kind: 'accepted-correction', occurredAt: '2026-11-17', current: true },
    ];
    const visible = computeRecognition(observations, { quiet: false });
    expect(visible.totalEvents).toBe(9);
    expect(visible.activeWeeks).toBe(1); // all events in 2026-11
    expect(visible.achievements.map((a) => a.id)).toEqual([
      'first-independence',
      'review-consistency',
      'accepted-correction',
    ]);

    const quiet = computeRecognition(observations, { quiet: true });
    expect(quiet.achievements).toEqual([]);
    expect(quiet.totalEvents).toBe(9); // events still recorded; only display suppressed
  });

  it('never penalizes missed days', () => {
    const events = [check('c1', '2026-11-10'), check('c2', '2026-11-20')];
    const summary = computeRecognition(events);
    expect(summary.activeWeeks).toBe(1);
    // No penalty fields exist; recognition is purely additive.
    expect(summary.achievements).toEqual([]);
  });
});
