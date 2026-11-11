import { getLearningItemsByAcceptanceKey } from '../../../api/learning-items';
import { acceptLearnThisCandidates, type AcceptLearnThisContext } from '../../../components/learn/acceptLearnThis';
import type { LearningCardCandidate } from '../../../lib/ai/schemas/learningMaterial';

/**
 * C7-T06 retry-safe acceptance: reconcile via native acceptance key before
 * retrying ambiguous writes. No auto cards; explicit accept only.
 */
export async function acceptRemediationCards(
  candidates: LearningCardCandidate[],
  ctx: AcceptLearnThisContext,
  deps: {
    accept?: typeof acceptLearnThisCandidates;
    findSaved?: typeof getLearningItemsByAcceptanceKey;
  } = {},
): Promise<{ created: number; reconciled: boolean }> {
  const accept = deps.accept ?? acceptLearnThisCandidates;
  const findSaved = deps.findSaved ?? getLearningItemsByAcceptanceKey;
  if (ctx.acceptanceId) {
    try {
      const saved = await findSaved(ctx.acceptanceId);
      if (saved.length > 0) return { created: 0, reconciled: true };
    } catch {
      // Reconciliation failure must not silently accept; fall through to explicit accept.
    }
  }
  const result = await accept(candidates, {
    ...ctx,
    allowClozeDuplicate: false,
  });
  return { created: result.created.length, reconciled: false };
}
