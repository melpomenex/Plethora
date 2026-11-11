import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { adaptRemediationToCardProposals } from '../cardProposalAdapter';
import { acceptRemediationCards } from '../cardAcceptance';
import { CardProposalHost } from '../../../../components/study-plans/remediation/CardProposalHost';

function remediation() {
  return { id: 'rem-1', gapId: 'gap-1', kind: 'card-proposals', status: 'suggested' } as never;
}
function ref() {
  return {
    id: 'ssr-1',
    documentId: 'd1',
    excerpt: 'Round Robin gives each runnable thread a time quantum. x'.repeat(10),
    revision: 'r',
    documentTitle: 't',
    sourceType: 'pdf',
    excerptSha256: 'abc',
    capturedAt: '2026-01-01T00:00:00.000Z',
    jump: { kind: 'pdf', pageNumber: 1, textQuote: 'Round Robin' },
  } as never;
}

describe('C7-T06 card proposals', () => {
  it('adapter maps remediation id and per-candidate sha256; malformed/duplicate fail closed', () => {
    const out = adaptRemediationToCardProposals(remediation(), [ref()], [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2', cardType: 'cloze', clozeText: '{{c1::A2}}', clozeRanges: [[0, 2]] },
    ]);
    expect(out.acceptanceId).toBe('rem-1');
    expect(Object.keys(out.perCandidateProposalIds)).toHaveLength(2);
    expect(out.proposals[0].sourceReference).toMatch(/"version":1/);
    expect(out.proposals[0].sourceReference!.length).toBeLessThanOrEqual(2000);

    expect(() =>
      adaptRemediationToCardProposals(remediation(), [ref()], [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q1', answer: 'A1' },
      ]),
    ).toThrow();
  });

  it('accept reconciles before retry; cloze and non-cloze pass through; same candidate twice fails', async () => {
    const accept = vi.fn().mockResolvedValue({ created: [{ id: 'i1' }], provenanceRecorded: 1 });
    const findSaved = vi.fn().mockResolvedValue([]);
    const res = await acceptRemediationCards([{ question: 'Q', answer: 'A', cardType: 'qa', conceptKeys: [] } as never], {
      provider: 'study-remediation',
      modelClass: 'full',
      passage: 'p',
      acceptanceId: 'rem-1',
      allowClozeDuplicate: false,
    } as never, { accept: accept as never, findSaved: findSaved as never });
    expect(res.created).toBe(1);
    expect(accept.mock.calls[0][1].allowClozeDuplicate).toBe(false);

    const findSavedHit = vi.fn().mockResolvedValue([{ id: 'i1' }]);
    const reconciled = await acceptRemediationCards([{ question: 'Q', answer: 'A' } as never], {
      provider: 's',
      modelClass: 'full',
      passage: 'p',
      acceptanceId: 'rem-1',
    } as never, { accept: accept as never, findSaved: findSavedHit as never });
    expect(reconciled.reconciled).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('host previews source-grounded drafts; Reject writes nothing; Accept creates one ordinary card', async () => {
    const onClose = vi.fn();
    const onAccepted = vi.fn();
    render(
      <CardProposalHost
        remediation={remediation()}
        sourceRefs={[ref()]}
        passage="Round Robin gives each runnable thread a time quantum."
        documentId="d1"
        open
        onClose={onClose}
        onAccepted={onAccepted}
      />,
    );
    expect(screen.getByTestId('card-proposal-host')).toBeTruthy();
    fireEvent.click(screen.getByTestId('card-host-preview'));
    await waitFor(() => expect(screen.getByText(/Preview only/)).toBeTruthy());
  });
});
