import { describe, expect, it, vi } from 'vitest';
import type { ExternalSnapshot } from '../snapshots';
import { publishVerifiedRevision } from '../publicationGate';

function snapshot(excerpt: string, status: ExternalSnapshot['status'] = 'accepted'): ExternalSnapshot {
  return {
    id: `wrs_${status}`,
    planId: 'sp_1',
    planVersionId: 'spv_1',
    query: 'capital of France',
    url: 'https://example.org/verified',
    title: 'France',
    publisher: 'Example Org',
    fetchedAt: '2026-11-13T10:00:00Z',
    revisionHash: 'h1',
    locator: { kind: 'page', value: 'Captured readable text' },
    excerpt,
    status,
  };
}

function request(over: Partial<Parameters<typeof publishVerifiedRevision>[0]> = {}) {
  return {
    questionId: 'q1',
    revisionLabel: 'v2',
    questionText: 'What is the capital of France?',
    answerKey: 'Paris',
    snapshotIds: [] as string[],
    snapshots: [] as ExternalSnapshot[],
    explicitAcceptance: true,
    ...over,
  };
}

describe('publication gate (web-research 2.3)', () => {
  it('publishes a newly reviewed revision when accepted snapshots support it', async () => {
    const saved = snapshot('The capital of France is Paris.');
    const publish = vi.fn().mockResolvedValue({ ok: true, revisionId: 'aqr_v2' });
    const result = await publishVerifiedRevision(
      request({ snapshotIds: [saved.id], snapshots: [saved] }),
      { publish }
    );
    expect(result.ok).toBe(true);
    expect(result.revisionId).toBe('aqr_v2');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1', snapshotIds: [saved.id] })
    );
  });

  it('blocks insufficient, disputed, candidate, stale, or declined evidence', async () => {
    const publish = vi.fn();
    const missing = await publishVerifiedRevision(request(), { publish });
    expect(missing.ok).toBe(false);
    expect(missing.blockedReasonKey).toBe('research.publish.insufficient_sources');

    const unrelated = snapshot('Gardening tips for beginners.');
    const unsupported = await publishVerifiedRevision(
      request({ snapshotIds: [unrelated.id], snapshots: [unrelated] }), { publish }
    );
    expect(unsupported.blockedReasonKey).toBe('research.publish.insufficient_verified_support');

    const dispute = snapshot('The capital of France is not Paris; it is Lyon.');
    const contradicted = await publishVerifiedRevision(
      request({ snapshotIds: [dispute.id], snapshots: [dispute] }), { publish }
    );
    expect(contradicted.blockedReasonKey).toBe('research.publish.disputed_evidence');

    const candidate = snapshot('The capital of France is Paris.', 'candidate');
    const candidateResult = await publishVerifiedRevision(
      request({ snapshotIds: [candidate.id], snapshots: [candidate] }), { publish }
    );
    expect(candidateResult.blockedReasonKey).toBe('research.publish.unaccepted_snapshot');

    const stale = snapshot('The capital of France is Paris.');
    const staleResult = await publishVerifiedRevision(
      request({ snapshotIds: [stale.id], snapshots: [stale], liveRevisions: { [stale.id]: 'h-new' } }),
      { publish }
    );
    expect(staleResult.ok).toBe(false);

    const declined = await publishVerifiedRevision(
      request({ snapshotIds: [stale.id], snapshots: [stale], explicitAcceptance: false }), { publish }
    );
    expect(declined.blockedReasonKey).toBe('research.publish.requires_explicit_acceptance');
    expect(publish).not.toHaveBeenCalled();
  });

  it('only creates the new revision and leaves prior attempts untouched', async () => {
    const saved = snapshot('The capital of France is Paris.');
    const publish = vi.fn().mockResolvedValue({ ok: true, revisionId: 'aqr_v2' });
    const priorTrust = { attemptId: 'att_old', trust: 'unverified' };
    await publishVerifiedRevision(request({ snapshotIds: [saved.id], snapshots: [saved] }), { publish });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(priorTrust.trust).toBe('unverified');
  });
});
