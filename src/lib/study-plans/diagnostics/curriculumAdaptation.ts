import type { CurriculumPriorEvidence } from '../generation/types';
import type { StudyPlanVersionNode } from '../../../types/learningPaths';

/**
 * Diagnostic adaptation preference (shared §9.1 / C7 design).
 * Never auto-skips/removes/completes; DAG dominates; locked nodes keep lock.
 * weak observedMean<0.6 -> rank 0; 0.6-0.8 or unknown -> rank 1; >0.8 -> rank 2.
 */
export interface CurriculumPreference {
  nodeId: string;
  rank: 0 | 1 | 2;
  preferenceKey: number;
  locked: boolean;
}

export function computeCurriculumPreferences(
  nodes: StudyPlanVersionNode[],
  priorEvidence: CurriculumPriorEvidence | null,
): CurriculumPreference[] {
  const byConcept = new Map<string, number | null>();
  for (const c of priorEvidence?.concepts ?? []) {
    byConcept.set(c.conceptId, c.observedMean);
  }
  return nodes
    .filter((n) => n.included)
    .map((n, idx) => {
      if (n.locked) {
        return { nodeId: n.nodeId, rank: 1 as const, preferenceKey: 1 * 10000 + idx, locked: true };
      }
      const mean = n.conceptId ? byConcept.get(n.conceptId) ?? null : null;
      const rank: 0 | 1 | 2 = mean === null ? 1 : mean < 0.6 ? 0 : mean > 0.8 ? 2 : 1;
      return { nodeId: n.nodeId, rank, preferenceKey: rank * 10000 + idx, locked: false };
    });
}
