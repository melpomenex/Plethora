import { beforeEach, describe, expect, it } from 'vitest';
import { createSnapshot, listSnapshots, getSnapshot, storeSnapshot, acceptSnapshot, checkRevalidation } from '../snapshots';
import { verifyClaim } from '../verification';

function snap(over: Partial<Parameters<typeof createSnapshot>[0]> = {}) {
  return createSnapshot({
    url: 'https://example.org/article',
    publisher: 'Example Org',
    fetchedAt: '2026-11-13T10:00:00Z',
    revisionHash: 'h1',
    locator: { kind: 'page', value: '12' },
    excerpt: 'Photosynthesis converts light energy into chemical energy in plants.',
    ...over,
  });
}

describe('external snapshots (web-research 2.1)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores candidates distinctly and accepts them without losing fields', () => {
    const candidate = snap();
    storeSnapshot(candidate);
    expect(listSnapshots('candidate')).toHaveLength(1);
    expect(listSnapshots('accepted')).toHaveLength(0);

    const accepted = acceptSnapshot(candidate.id)!;
    expect(accepted.status).toBe('accepted');
    expect(accepted.url).toBe('https://example.org/article');
    expect(accepted.publisher).toBe('Example Org');
    expect(accepted.revisionHash).toBe('h1');
    expect(accepted.locator).toEqual({ kind: 'page', value: '12' });
    expect(getSnapshot(candidate.id)?.status).toBe('accepted');
  });

  it('link change prompts revalidation but preserves the historical snapshot', () => {
    const candidate = snap();
    storeSnapshot(candidate);
    acceptSnapshot(candidate.id);
    const status = checkRevalidation(getSnapshot(candidate.id)!, 'h2');
    expect(status.changed).toBe(true);
    expect(status.current).toBe(false);
    // Historical snapshot preserved with original revision/locator.
    expect(getSnapshot(candidate.id)?.revisionHash).toBe('h1');
  });

  it('missing snapshot keeps stored data but has no navigation source of its own', () => {
    const candidate = snap();
    storeSnapshot(candidate);
    expect(getSnapshot('missing')).toBeNull();
    expect(listSnapshots()).toHaveLength(1);
  });
});

describe('claim verification (web-research 2.2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supports a claim only when an accepted current excerpt contains the terms', () => {
    const candidate = snap();
    storeSnapshot(candidate);
    acceptSnapshot(candidate.id);
    const result = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [candidate.id],
      liveRevisions: { [candidate.id]: 'h1' },
    });
    expect(result.verdict).toBe('verified');
    expect(result.perSnapshot[0].status).toBe('verified');
  });

  it('rejects missing passage support, stale and forged evidence as unverified', () => {
    const candidate = snap({ excerpt: 'Completely unrelated content about gardening.' });
    storeSnapshot(candidate);
    acceptSnapshot(candidate.id);

    const missing = verifyClaim('Photosynthesis converts light energy', { snapshotIds: [candidate.id] });
    expect(missing.verdict).toBe('unverified');
    expect(missing.perSnapshot[0].reasonKey).toBe('research.verify.passage_missing');

    const stale = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [candidate.id],
      liveRevisions: { [candidate.id]: 'h-new' },
    });
    expect(stale.verdict).toBe('unverified');
    expect(stale.perSnapshot[0].reasonKey).toBe('research.verify.stale');

    // Candidate (not accepted) snapshots are never evidence.
    const candidateOnly = snap();
    storeSnapshot(candidateOnly);
    const notAccepted = verifyClaim('Photosynthesis converts light energy', { snapshotIds: [candidateOnly.id] });
    expect(notAccepted.verdict).toBe('unverified');
  });

  it('surfaces contradiction when accepted evidence actively disagrees', () => {
    const candidate = snap({ excerpt: 'Photosynthesis does not convert light energy; the claim is false.' });
    storeSnapshot(candidate);
    acceptSnapshot(candidate.id);
    const result = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [candidate.id],
      liveRevisions: { [candidate.id]: 'h1' },
    });
    expect(result.verdict).toBe('contradicted');
    expect(result.perSnapshot[0].status).toBe('contradicted');
  });
});
