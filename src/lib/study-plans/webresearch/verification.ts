/**
 * Claim/key verification independent of search snippets and model output
 * (web-research 2.2).
 *
 * A claim or answer key is supported only when a current, accepted snapshot's
 * pinned excerpt actually contains the supporting text. Snippets are never
 * treated as evidence; missing, contradictory, stale and forged evidence stays
 * visibly unverified.
 */

import type { ExternalSnapshot } from './snapshots';

export type SupportVerdict = 'verified' | 'unverified' | 'contradicted';

export interface PerSnapshotVerdict {
  snapshotId: string;
  status: SupportVerdict;
  reasonKey: string;
}

export interface ClaimVerificationResult {
  verdict: SupportVerdict;
  perSnapshot: PerSnapshotVerdict[];
}

function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function supportsClaim(snapshot: ExternalSnapshot, claimTerms: string[]): boolean {
  const excerpt = normalize(snapshot.excerpt);
  return claimTerms.some((term) => excerpt.includes(normalize(term)));
}

export interface ClaimEvidenceInput {
  snapshotIds?: string[];
  /** Snapshots supplied by the durable native Study Plans repository. */
  snapshots?: ExternalSnapshot[];
  /** Current revision hashes (live) — null/unknown treated as stale. */
  liveRevisions?: Record<string, string>;
}

export function verifyClaim(
  claim: string,
  input: ClaimEvidenceInput
): ClaimVerificationResult {
  const claimTerms = claim.split(/\s+/).filter((t) => t.length >= 4);
  const perSnapshot: PerSnapshotVerdict[] = [];
  const requestedIds = input.snapshotIds ? new Set(input.snapshotIds) : null;
  const accepted = (input.snapshots ?? [])
    .filter((snapshot) => snapshot.status === 'accepted')
    .filter((snapshot) => !requestedIds || requestedIds.has(snapshot.id));

  let anyVerified = false;
  let anyContradiction = false;

  for (const snapshot of accepted) {
    const live = input.liveRevisions?.[snapshot.id];
    if (live !== undefined && live !== snapshot.revisionHash) {
      perSnapshot.push({ snapshotId: snapshot.id, status: 'unverified', reasonKey: 'research.verify.stale' });
      continue;
    }
    if (!supportsClaim(snapshot, claimTerms)) {
      perSnapshot.push({ snapshotId: snapshot.id, status: 'unverified', reasonKey: 'research.verify.passage_missing' });
      continue;
    }
    // Contradiction: the pinned excerpt actively negates the claim near the term.
    const firstTerm = normalize(claimTerms[0] ?? '');
    const termIndex = normalize(snapshot.excerpt).indexOf(firstTerm);
    const contradicted =
      termIndex >= 0 &&
      normalize(snapshot.excerpt)
        .slice(Math.max(0, termIndex - 40), termIndex + 40)
        .includes('not ');
    if (contradicted) {
      anyContradiction = true;
      perSnapshot.push({ snapshotId: snapshot.id, status: 'contradicted', reasonKey: 'research.verify.contradiction' });
      continue;
    }
    anyVerified = true;
    perSnapshot.push({ snapshotId: snapshot.id, status: 'verified', reasonKey: 'research.verify.passage_supported' });
  }

  if (accepted.length === 0) {
    return { verdict: 'unverified', perSnapshot };
  }
  if (anyContradiction && !anyVerified) {
    return { verdict: 'contradicted', perSnapshot };
  }
  if (anyVerified) {
    return { verdict: 'verified', perSnapshot };
  }
  return { verdict: 'unverified', perSnapshot };
}

export function verifyAnswerKey(
  key: string,
  input: ClaimEvidenceInput
): ClaimVerificationResult {
  return verifyClaim(`The answer is ${key}`, input);
}
