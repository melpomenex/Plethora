/**
 * Evidence-backed recognition (motivation 2.1).
 *
 * Derives optional quests/achievements/session wrap-up from durable events
 * only: independent checked attempts (final, hint-free, deterministic/manual
 * grades), eligible delayed reviews, and accepted corrections. Chat, reading
 * time, AI grades and unverified scores never earn recognition. Events are
 * deduplicated by identity; overturned/superseded evidence is reflected;
 * missed days are never penalized.
 */

export type RecognitionEventKind =
  | 'independent-check'
  | 'delayed-review'
  | 'accepted-correction';

export interface RecognitionEvent {
  id: string;
  kind: RecognitionEventKind;
  occurredAt: string; // UTC date YYYY-MM-DD
  outcome?: 'correct' | 'partial' | 'incorrect';
}

export interface RecognitionObservation {
  /** Final, current grade / evidence record. */
  id: string;
  kind: RecognitionEventKind;
  occurredAt: string;
  /** True when the underlying grade/result is still current (not superseded). */
  current: boolean;
  /** Hint-free independent check only. */
  hintFree?: boolean;
  /** Deterministic or manual grading (AI grades excluded). */
  deterministicOrManual?: boolean;
  outcome?: 'correct' | 'partial' | 'incorrect';
}

export interface RecognitionConfig {
  quiet: boolean;
}

export interface Achievement {
  id: string;
  labelKey: string;
  count: number;
  evidenceBacked: boolean;
}

export interface RecognitionSummary {
  events: RecognitionEvent[];
  achievements: Achievement[];
  /** Weekly cadence: active weeks (no penalties for missed days). */
  activeWeeks: number;
  totalEvents: number;
}

const dedupe = (seen: Set<string>, event: RecognitionEvent) =>
  seen.has(event.id) ? false : (seen.add(event.id), true);

export function buildEvents(observations: RecognitionObservation[]): RecognitionEvent[] {
  const seen = new Set<string>();
  return observations
    .filter((o) => o.current)
    .flatMap((o): RecognitionEvent[] => {
      if (o.kind === 'independent-check') {
        if (!o.hintFree || !o.deterministicOrManual || !o.outcome) return [];
        // Only correct/partial independent checks count; incorrect is a signal,
        // not a reward.
        if (o.outcome === 'incorrect') return [];
        const event: RecognitionEvent = {
          id: o.id,
          kind: 'independent-check',
          occurredAt: o.occurredAt,
          outcome: o.outcome,
        };
        return dedupe(seen, event) ? [event] : [];
      }
      if (o.kind === 'delayed-review') {
        const event: RecognitionEvent = { id: o.id, kind: 'delayed-review', occurredAt: o.occurredAt };
        return dedupe(seen, event) ? [event] : [];
      }
      const event: RecognitionEvent = { id: o.id, kind: 'accepted-correction', occurredAt: o.occurredAt };
      return dedupe(seen, event) ? [event] : [];
    });
}

export function achievementsFromEvents(events: RecognitionEvent[]): Achievement[] {
  const byKind = new Map<RecognitionEventKind, number>();
  for (const event of events) {
    byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
  }
  const independent = byKind.get('independent-check') ?? 0;
  const reviews = byKind.get('delayed-review') ?? 0;
  const corrections = byKind.get('accepted-correction') ?? 0;
  const achievements: Achievement[] = [];
  if (independent >= 3) achievements.push({ id: 'first-independence', labelKey: 'study_plan.achievement.first_independence', count: independent, evidenceBacked: true });
  if (reviews >= 5) achievements.push({ id: 'review-consistency', labelKey: 'study_plan.achievement.review_consistency', count: reviews, evidenceBacked: true });
  if (corrections >= 1) achievements.push({ id: 'accepted-correction', labelKey: 'study_plan.achievement.accepted_correction', count: corrections, evidenceBacked: true });
  return achievements;
}

export function computeRecognition(
  observations: RecognitionObservation[],
  config: RecognitionConfig = { quiet: false }
): RecognitionSummary {
  const events = buildEvents(observations);
  const achievements = config.quiet ? [] : achievementsFromEvents(events);
  const weeks = new Set(events.map((e) => e.occurredAt.slice(0, 7)));
  return { events, achievements, activeWeeks: weeks.size, totalEvents: events.length };
}
