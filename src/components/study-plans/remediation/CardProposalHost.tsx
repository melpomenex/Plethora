import React, { useState } from 'react';
import { LearnThisProposalSheet } from '../../learn/LearnThisProposalSheet';
import type { RemediationRecommendation } from '../../../types/learningEvidence';
import type { StudySourceRefV1 } from '../../../types/studySource';
import { adaptRemediationToCardProposals } from '../../../lib/study-plans/remediation/cardProposalAdapter';
import { acceptRemediationCards } from '../../../lib/study-plans/remediation/cardAcceptance';

export interface CardProposalHostProps {
  remediation: RemediationRecommendation;
  sourceRefs: StudySourceRefV1[];
  passage: string;
  documentId?: string;
  documentTitle?: string;
  open: boolean;
  onClose: () => void;
  onAccepted?: (created: number) => void;
}

export const CardProposalHost: React.FC<CardProposalHostProps> = ({
  remediation,
  sourceRefs,
  passage,
  documentId,
  documentTitle,
  open,
  onClose,
  onAccepted,
}) => {
  const [sheetOpen, setSheetOpen] = useState(open);
  const [notice, setNotice] = useState<string | null>(null);

  // Static preview only until explicit Accept; Reject writes nothing.
  const adapted = React.useMemo(() => {
    try {
      return adaptRemediationToCardProposals(remediation, sourceRefs, [
        {
          question: `Under review, where does a still-runnable thread go when its quantum expires?`,
          answer: 'To the back of the ready queue.',
          evidenceQuote: sourceRefs[0]?.excerpt?.slice(0, 300),
        },
      ]);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
  }, [remediation, sourceRefs]);

  if (!open) return null;
  if ('error' in adapted) {
    return (
      <div role="alert" data-testid="card-host-error" className="p-4 text-sm">
        Card preview unavailable: {adapted.error}
        <button type="button" onClick={onClose} className="underline ml-2 min-h-[32px]">Close</button>
      </div>
    );
  }

  return (
    <div data-testid="card-proposal-host" className="space-y-2">
      <p className="text-xs">Preview only — Accept creates one ordinary scheduled card; Reject writes nothing.</p>
      <button
        type="button"
        data-testid="card-host-preview"
        onClick={() => setSheetOpen(true)}
        className="text-xs underline min-h-[32px]"
      >
        Preview card proposals
      </button>
      <LearnThisProposalSheet
        open={sheetOpen}
        text={passage}
        passage={passage}
        documentId={documentId}
        documentTitle={documentTitle}
        staticCandidates={adapted.proposals.map((p) => ({
          question: p.candidate.question,
          answer: p.candidate.answer,
          cardType: p.candidate.cardType,
        }))}
        staticProvenance={{ provider: 'study-remediation', modelClass: 'full' }}
        acceptance={{ acceptanceId: adapted.acceptanceId, perCandidateProposalIds: adapted.perCandidateProposalIds }}
        onClose={() => {
          setSheetOpen(false);
          onClose();
        }}
      />
      <button
        type="button"
        data-testid="card-host-accept"
        onClick={async () => {
          const res = await acceptRemediationCards(
            adapted.proposals.map((p) => p.candidate),
            {
              documentId,
              provider: 'study-remediation',
              modelClass: 'full',
              passage,
              acceptanceId: adapted.acceptanceId,
              proposalId: undefined,
              perCandidateProposalIds: adapted.perCandidateProposalIds,
              allowClozeDuplicate: false,
            },
          );
          setNotice(`Accepted ${res.created} card(s)${res.reconciled ? ' (reconciled)' : ''}.`);
          onAccepted?.(res.created);
        }}
        className="text-xs underline min-h-[32px]"
      >
        Accept via adapter
      </button>
      {notice && (
        <p role="status" data-testid="card-host-notice" className="text-xs">{notice}</p>
      )}
    </div>
  );
};
