import type { SentenceModeSession, CreateSentenceModeSessionInput, SentenceSegment, SentenceModeReturnAnchor } from "./types";

export function createSentenceModeSession(input: CreateSentenceModeSessionInput): SentenceModeSession {
  return {
    sessionId: input.sessionId,
    profileId: input.profileId,
    source: input.source,
    sourceId: input.sourceId,
    contentFingerprint: input.contentFingerprint,
    entrySentenceId: input.entry.identity.sentenceId,
    currentSentenceId: input.entry.identity.sentenceId,
    returnAnchor: input.returnAnchor,
    indexOffset: Math.max(0, input.entry.index),
    indexLimit: 50,
    progress: { current: input.entry.index, total: input.total },
    freshness: input.entry.freshness,
    startedAt: input.startedAt ?? Date.now(),
  };
}

export function moveSentence(session: SentenceModeSession, segment: SentenceSegment): SentenceModeSession {
  if (segment.identity.sourceId !== session.sourceId || segment.identity.contentFingerprint !== session.contentFingerprint) {
    return { ...session, freshness: "stale" };
  }
  return {
    ...session,
    currentSentenceId: segment.identity.sentenceId,
    indexOffset: Math.max(0, segment.index),
    progress: { ...session.progress, current: segment.index },
    freshness: segment.freshness,
  };
}

export function returnToReader(session: SentenceModeSession): SentenceModeReturnAnchor {
  return { ...session.returnAnchor };
}

export function sentenceModeCanNavigate(session: SentenceModeSession, direction: "previous" | "next"): boolean {
  if (direction === "previous") return session.progress.current > 0;
  return session.progress.total === undefined || session.progress.current + 1 < session.progress.total;
}
