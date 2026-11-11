import { createHash } from 'node:crypto';
import type { LearningCardCandidate } from '../../../lib/ai/schemas/learningMaterial';
import { candidateSignature } from '../../../lib/ai/tasks/definitions/learnThisValidation';
import { serializeCardSourceReference } from '../../../types/cardSourceReference';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { RemediationRecommendation } from '../../../types/learningEvidence';

export interface RemediationCardProposal {
  candidate: LearningCardCandidate;
  proposalId: string;
  sourceReference?: string;
}

/**
 * C7-T06 adapter: remediation → static Learn This candidates.
 * remediation id → acceptanceId; local signature → sha256 per-candidate id.
 * Collisions/unknown candidates fail closed. Bounded excerpts (300-char via
 * serializer), allowClozeDuplicate=false, no source-doc duplication.
 */
export function adaptRemediationToCardProposals(
  remediation: RemediationRecommendation,
  sourceRefs: StudySourceRefV1[],
  drafts: Array<{
    question: string;
    answer: string;
    cardType?: LearningCardCandidate['cardType'];
    conceptKeys?: string[];
    tags?: string[];
    clozeText?: string;
    clozeRanges?: Array<[number, number]>;
    evidenceQuote?: string;
  }>,
): { acceptanceId: string; proposals: RemediationCardProposal[]; perCandidateProposalIds: Record<string, string> } {
  const acceptanceId = remediation.id;
  const seen = new Map<string, string>();
  const proposals: RemediationCardProposal[] = drafts.map((d) => {
    const candidate: LearningCardCandidate = {
      cardType: d.cardType ?? 'qa',
      conceptKeys: d.conceptKeys ?? [],
      question: d.question,
      answer: d.answer,
      clozeText: d.clozeText,
      clozeRanges: d.clozeRanges,
      evidenceQuote: d.evidenceQuote,
      tags: d.tags,
    };
    const sig = candidateSignature(candidate);
    if (seen.has(sig)) throw new Error('study.cards.error.duplicate_candidate');
    const proposalId = createHash('sha256').update(`${acceptanceId}:${sig}`).digest('hex');
    for (const [, existing] of seen) {
      if (existing === proposalId) throw new Error('study.cards.error.proposal_collision');
    }
    seen.set(sig, proposalId);
    const ref = sourceRefs[0];
    const sourceReference = ref
      ? serializeCardSourceReference({
          document_id: ref.documentId,
          locator: (ref.jump ?? { kind: 'pdf', pageNumber: 1, textQuote: '' }) as never,
          excerpt: (ref.excerpt ?? '').slice(0, 300),
          section_label: ref.sectionLabel,
          fingerprint: ref.excerptSha256,
          captured_at: ref.capturedAt,
        })
      : undefined;
    return { candidate, proposalId, sourceReference };
  });
  const perCandidateProposalIds: Record<string, string> = {};
  for (const p of proposals) {
    perCandidateProposalIds[candidateSignature(p.candidate)] = p.proposalId;
  }
  return { acceptanceId, proposals, perCandidateProposalIds };
}
