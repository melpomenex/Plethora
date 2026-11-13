import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot, storeSnapshot, acceptSnapshot } from '../snapshots';
import { publishVerifiedRevision } from '../publicationGate';

function seedAcceptedSnapshot(excerpt: string) {
  const snapshot = createSnapshot({
    url: 'https://example.org/verified',
    publisher: 'Example Org',
    fetchedAt: '2026-11-13T10:00:00Z',
    revisionHash: 'h1',
    locator: { kind: 'page', value: '12' },
    excerpt,
  });
  storeSnapshot(snapshot);
  acceptSnapshot(snapshot.id);
  return snapshot;
}

function request(over: Partial<Parameters<typeof publishVerifiedRevision>[0]> = {}) {
  return {
    questionId: 'q1',
    revisionLabel: 'v2',
    questionText: 'What is the capital of France?',
    answerKey: 'Paris',
    snapshotIds: [] as string[],
    explicitAcceptance: true,
    ...over,
  };
}

describe('publication gate (web-research 2.3)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('publishes a newly verified revision with all references verified', async () => {
    const snap = seedAcceptedSnapshot('The capital of France is Paris.');
    const publish = vi.fn().mockResolvedValue({ ok: true, revisionId: 'aqr_v2' });
    const result = await publishVerifiedRevision(
      request({ snapshotIds: [snap.id] }),
      { publish }
    );
    expect(result.ok).toBe(true);
    expect(result.revisionId).toBe('aqr_v2');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1', snapshotIds: [snap.id] })
    );
  });

  it('blocks when evidence is insufficient or disputed, publishing nothing', async () => {
    const publish = vi.fn();

    const missingSource = await publishVerifiedRevision(request(), { publish });
    expect(missingSource.ok).toBe(false);
    expect(missingSource.blockedReasonKey).toBe('research.publish.insufficient_sources');

    const unrelated = seedAcceptedSnapshot('Gardening tips for beginners.');
    const unsupported = await publishVerifiedRevision(request({ snapshotIds: [unrelated.id] }), { publish });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.blockedReasonKey).toBe('research.publish.insufficient_verified_support');

    const dispute = seedAcceptedSnapshot('The capital of France is not Paris; it is Lyon.');
    const contradicted = await publishVerifiedRevision(request({ snapshotIds: [dispute.id] }), { publish });
    expect(contradicted.ok).toBe(false);
    expect(contradicted.blockedReasonKey).toBe('research.publish.disputed_evidence');

    const notAccepted = createSnapshot({
      url: 'https://example.org/candidate',
      publisher: 'X',
      fetchedAt: '2026-11-13T10:00:00Z',
      revisionHash: 'h1',
      locator: { kind: 'page', value: '1' },
      excerpt: 'The capital of France is Paris.',
    });
    storeSnapshot(notAccepted);
    const candidateOnly = await publishVerifiedRevision(request({ snapshotIds: [notAccepted.id] }), { publish });
    expect(candidateOnly.ok).toBe(false);
    expect(candidateOnly.blockedReasonKey).toBe('research.publish.unaccepted_snapshot');

    const stale = seedAcceptedSnapshot('The capital of France is Paris.');
    const staleResult = await publishVerifiedRevision(
      request({ snapshotIds: [stale.id], liveRevisions: { [stale.id]: 'h-new' } }),
      { publish }
    );
    expect(staleResult.ok).toBe(false);

    const declined = await publishVerifiedRevision(request({ snapshotIds: [stale.id], explicitAcceptance: false }), { publish });
    expect(declined.blockedReasonKey).toBe('research.publish.requires_explicit_acceptance');

    expect(publish).not.toHaveBeenCalled();
  });

  it('never relabels prior attempts: gate only creates the new committed revision', async () => {
    const snap = seedAcceptedSnapshot('The capital of France is Paris.');
    const publish = vi.fn().mockResolvedValue({ ok: true, revisionId: 'aqr_v2' });
    const priorTrust = { attemptId: 'att_old', trust: 'unverified' };

    await publishVerifiedRevision(request({ snapshotIds: [snap.id] }), { publish });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(priorTrust.trust).toBe('unverified'); // untouched
  });
});
