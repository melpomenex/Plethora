/**
 * Explicit draft-to-publication gate for externally verified assessment
 * revisions (web-research 2.3).
 *
 * New question/key/rubric revisions may be published ONLY when every reference
 * resolves to an accepted, current external snapshot that verifiably supports
 * the claim/key, and the learner explicitly accepts the new revision. Missing,
 * stale, contradictory or forged evidence blocks publication. Prior attempts
 * and older revisions keep their original trust status — this gate never
 * relabels history.
 */

import type { ExternalSnapshot } from './snapshots';
import { verifyClaim, type ClaimVerificationResult } from './verification';

export interface VerifiedRevisionRequest {
  questionId: string;
  revisionLabel: string;
  questionText: string;
  answerKey: string;
  rubric?: { criteria: string[] };
  snapshotIds: string[];
  /** Loaded from the app's durable Study Plan repository. */
  snapshots: ExternalSnapshot[];
  liveRevisions?: Record<string, string>;
  explicitAcceptance: boolean;
}

export interface PublicationClient {
  publish: (request: {
    questionId: string;
    revisionLabel: string;
    snapshotIds: string[];
  }) => Promise<{ ok: boolean; revisionId?: string; error?: { code: string; messageKey: string } }>;
}

export interface PublicationGateResult {
  ok: boolean;
  revisionId?: string;
  blockedReasonKey?: string;
  verification?: ClaimVerificationResult;
}

function resolveSnapshots(snapshotIds: string[], available: ExternalSnapshot[]): ExternalSnapshot[] {
  const byId = new Map(available.map((snapshot) => [snapshot.id, snapshot]));
  return snapshotIds
    .map((id) => byId.get(id))
    .filter((snapshot): snapshot is ExternalSnapshot => Boolean(snapshot && snapshot.status === 'accepted'));
}

export async function publishVerifiedRevision(
  request: VerifiedRevisionRequest,
  client: PublicationClient
): Promise<PublicationGateResult> {
  if (!request.explicitAcceptance) {
    return { ok: false, blockedReasonKey: 'research.publish.requires_explicit_acceptance' };
  }
  if (request.snapshotIds.length === 0) {
    return { ok: false, blockedReasonKey: 'research.publish.insufficient_sources' };
  }
  const snapshots = resolveSnapshots(request.snapshotIds, request.snapshots);
  if (snapshots.length < request.snapshotIds.length) {
    return { ok: false, blockedReasonKey: 'research.publish.unaccepted_snapshot' };
  }

  const questionVerification = verifyClaim(request.questionText, {
    snapshotIds: snapshots.map((s) => s.id),
    snapshots,
    liveRevisions: request.liveRevisions,
  });
  const keyVerification = verifyClaim(request.answerKey, {
    snapshotIds: snapshots.map((s) => s.id),
    snapshots,
    liveRevisions: request.liveRevisions,
  });

  if (questionVerification.verdict !== 'verified' || keyVerification.verdict !== 'verified') {
    const reason =
      questionVerification.verdict === 'contradicted' || keyVerification.verdict === 'contradicted'
        ? 'research.publish.disputed_evidence'
        : 'research.publish.insufficient_verified_support';
    return { ok: false, blockedReasonKey: reason, verification: questionVerification };
  }

  if (request.rubric && request.rubric.criteria.length > 0) {
    const rubricCheck = verifyClaim(request.rubric.criteria.join(' '), {
      snapshotIds: snapshots.map((s) => s.id),
      snapshots,
      liveRevisions: request.liveRevisions,
    });
    if (rubricCheck.verdict !== 'verified') {
      return { ok: false, blockedReasonKey: 'research.publish.insufficient_verified_support', verification: rubricCheck };
    }
  }

  const published = await client.publish({
    questionId: request.questionId,
    revisionLabel: request.revisionLabel,
    snapshotIds: snapshots.map((s) => s.id),
  });

  if (!published.ok) {
    return {
      ok: false,
      blockedReasonKey: published.error?.messageKey ?? 'research.publish.failed',
    };
  }
  return { ok: true, revisionId: published.revisionId, verification: questionVerification };
}
