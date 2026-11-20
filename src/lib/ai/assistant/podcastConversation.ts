export interface PodcastEpisodeAttempt {
  id: string;
  conversationId: string;
  userMessageId: string;
  ownerProfileId: string;
  originViewId: string;
}

const activeAttempts = new Map<string, PodcastEpisodeAttempt>();
const attachedViews = new Map<string, Set<string>>();
let nextAttemptSequence = 0;

/** Stable Assistant identity for an episode inside the current account profile. */
export function podcastEpisodeConversationId(episodeId: string, ownerProfileId = "local"): string {
  const episodeKey = encodeURIComponent(episodeId);
  return ownerProfileId === "local"
    ? `podcast:episode:${episodeKey}`
    : `podcast:episode:${encodeURIComponent(ownerProfileId)}:${episodeKey}`;
}

export function isPodcastEpisodeConversationId(conversationId: string): boolean {
  return conversationId.startsWith("podcast:episode:");
}

export function beginPodcastEpisodeAttempt(input: Omit<PodcastEpisodeAttempt, "id">): PodcastEpisodeAttempt | null {
  if (activeAttempts.has(input.conversationId)) return null;
  nextAttemptSequence += 1;
  const attempt = { ...input, id: `podcast-attempt-${Date.now()}-${nextAttemptSequence}` };
  activeAttempts.set(input.conversationId, attempt);
  return attempt;
}

export function getPodcastEpisodeAttempt(conversationId: string): PodcastEpisodeAttempt | undefined {
  return activeAttempts.get(conversationId);
}

export function isCurrentPodcastEpisodeAttempt(
  conversationId: string,
  attemptId: string,
  ownerProfileId: string,
): boolean {
  const attempt = activeAttempts.get(conversationId);
  return attempt?.id === attemptId && attempt.ownerProfileId === ownerProfileId;
}

export function finishPodcastEpisodeAttempt(conversationId: string, attemptId: string): void {
  if (activeAttempts.get(conversationId)?.id === attemptId) activeAttempts.delete(conversationId);
}

/** Explicit Stop or Clear invalidates the current attempt before late output can commit. */
export function invalidatePodcastEpisodeAttempt(conversationId: string): PodcastEpisodeAttempt | undefined {
  const attempt = activeAttempts.get(conversationId);
  activeAttempts.delete(conversationId);
  return attempt;
}

export function attachPodcastEpisodeView(conversationId: string, viewId: string): () => void {
  const views = attachedViews.get(conversationId) ?? new Set<string>();
  views.add(viewId);
  attachedViews.set(conversationId, views);
  return () => {
    views.delete(viewId);
    if (views.size === 0) attachedViews.delete(conversationId);
  };
}

export function isPodcastEpisodeOriginViewAttached(conversationId: string, viewId: string): boolean {
  return attachedViews.get(conversationId)?.has(viewId) ?? false;
}

/** Prevents slower transcript loads from taking ownership of a newer open. */
export function createPodcastChatOpenIntent() {
  let latestIntent = 0;

  return {
    begin(): number {
      latestIntent += 1;
      return latestIntent;
    },
    isCurrent(intent: number): boolean {
      return intent === latestIntent;
    },
    invalidate(): void {
      latestIntent += 1;
    },
  };
}
