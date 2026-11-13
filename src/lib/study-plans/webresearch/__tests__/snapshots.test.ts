import { describe, expect, it } from 'vitest';
import type { ExternalSnapshot } from '../snapshots';
import { checkRevalidation, resolveNavigation } from '../snapshots';
import { verifyClaim } from '../verification';

function snap(over: Partial<ExternalSnapshot> = {}): ExternalSnapshot {
  return {
    id: 'wrs_1',
    planId: 'sp_1',
    planVersionId: 'spv_1',
    query: 'photosynthesis',
    title: 'Photosynthesis',
    url: 'https://example.org/article',
    publisher: 'Example Org',
    fetchedAt: '2026-11-13T10:00:00Z',
    revisionHash: 'h1',
    locator: { kind: 'page', value: 'Captured readable text' },
    excerpt: 'Photosynthesis converts light energy into chemical energy in plants.',
    status: 'accepted',
    ...over,
  };
}

describe('external snapshot references (web-research 2.1)', () => {
  it('opens a pinned excerpt with source and revision metadata', () => {
    const snapshot = snap();
    expect(resolveNavigation(snapshot)).toEqual({
      source: 'pinned-excerpt',
      locator: { kind: 'page', value: 'Captured readable text' },
      excerpt: snapshot.excerpt,
      url: snapshot.url,
    });
  });

  it('detects a changed revision without rewriting the historical snapshot', () => {
    const snapshot = snap();
    const status = checkRevalidation(snapshot, 'h2');
    expect(status.changed).toBe(true);
    expect(status.current).toBe(false);
    expect(snapshot.revisionHash).toBe('h1');
  });
});

describe('claim evidence review (web-research 2.2)', () => {
  it('marks a passage-supported claim from an accepted snapshot', () => {
    const snapshot = snap();
    const result = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [snapshot.id],
      snapshots: [snapshot],
      liveRevisions: { [snapshot.id]: 'h1' },
    });
    expect(result.verdict).toBe('verified');
    expect(result.perSnapshot[0].status).toBe('verified');
  });

  it('keeps missing, stale, forged, and candidate evidence unverified', () => {
    const snapshot = snap({ excerpt: 'Completely unrelated content about gardening.' });
    const missing = verifyClaim('Photosynthesis converts light energy', { snapshotIds: [snapshot.id], snapshots: [snapshot] });
    expect(missing.verdict).toBe('unverified');
    expect(missing.perSnapshot[0].reasonKey).toBe('research.verify.passage_missing');

    const stale = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [snapshot.id], snapshots: [snapshot], liveRevisions: { [snapshot.id]: 'h-new' },
    });
    expect(stale.verdict).toBe('unverified');
    expect(stale.perSnapshot[0].reasonKey).toBe('research.verify.stale');

    const candidate = snap({ status: 'candidate' });
    const unaccepted = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [candidate.id], snapshots: [candidate],
    });
    expect(unaccepted.verdict).toBe('unverified');
  });

  it('surfaces contradictory evidence', () => {
    const snapshot = snap({ excerpt: 'Photosynthesis does not convert light energy; the claim is false.' });
    const result = verifyClaim('Photosynthesis converts light energy', {
      snapshotIds: [snapshot.id], snapshots: [snapshot], liveRevisions: { [snapshot.id]: 'h1' },
    });
    expect(result.verdict).toBe('contradicted');
    expect(result.perSnapshot[0].status).toBe('contradicted');
  });
});
