import type { AttemptDetail } from '../../../types/assessmentSessions';
import type { CurriculumPriorEvidence } from '../generation/types';

/**
 * Pure diagnostic prior-evidence adapter (C7-T01).
 * Returns validated CurriculumPriorEvidence or null on explicit Skip.
 * Never synthesizes evidence; rejects incomplete/mismatched attempts.
 */
export function buildDiagnosticPriorEvidence(
  detail: AttemptDetail | null,
  expected: {
    planId?: string | null;
    sourceSnapshotHash?: string | null;
    blueprintRevisionId?: string | null;
  } = {},
): CurriculumPriorEvidence | null {
  if (detail === null) return null; // explicit Skip: no object, no evidence
  const { attempt, currentGrades, questions } = detail;
  if (!attempt || attempt.mode !== 'diagnostic') return null;
  if (attempt.status !== 'complete') return null;
  if (expected.blueprintRevisionId && attempt.blueprintRevisionId !== expected.blueprintRevisionId) {
    return null;
  }
  if (currentGrades.length === 0 || questions.length === 0) return null;
  // All official items must be final
  for (const g of currentGrades) {
    if (g.state !== 'final' || g.points === null) return null;
  }
  if (currentGrades.length < questions.length) return null;

  const byConcept = new Map<string, { scores: number[]; groupIds: Set<string> }>();
  for (const g of currentGrades) {
    const q = questions.find((qq) => qq.id === g.questionRevisionId);
    const targets = (q as unknown as { targets?: Array<{ conceptId?: string | null }> })?.targets ?? [];
    const conceptId = targets[0]?.conceptId;
    if (!conceptId) continue;
    const entry = byConcept.get(conceptId) ?? { scores: [], groupIds: new Set<string>() };
    entry.scores.push(g.maxPoints > 0 ? (g.points ?? 0) / g.maxPoints : 0);
    entry.groupIds.add(`${attempt.id}:${conceptId}`);
    byConcept.set(conceptId, entry);
  }
  if (byConcept.size === 0) return null;

  return {
    diagnosticAttemptId: attempt.id,
    concepts: Array.from(byConcept.entries()).map(([conceptId, v]) => {
      const mean = v.scores.length > 0 ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null;
      // One attempt is always sparse: surface as insufficient with explicit uncertainty.
      return {
        conceptId,
        level: 'insufficient-evidence' as const,
        observedMean: mean,
        uncertainty: ['one-independent-session', 'few-independent-sessions'] as never,
        evidenceGroupIds: Array.from(v.groupIds),
      };
    }),
  };
}
