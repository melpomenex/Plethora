import { describe, expect, it } from "vitest";
import {
  attachPodcastEpisodeView,
  beginPodcastEpisodeAttempt,
  createPodcastChatOpenIntent,
  finishPodcastEpisodeAttempt,
  isPodcastEpisodeOriginViewAttached,
  podcastEpisodeConversationId,
} from "../podcastConversation";

describe("podcast transcript conversation identity", () => {
  it("uses a stable namespaced key that does not depend on a title or transcript", () => {
    expect(podcastEpisodeConversationId("episode/42")).toBe("podcast:episode:episode%2F42");
    expect(podcastEpisodeConversationId("episode/42")).toBe(podcastEpisodeConversationId("episode/42"));
    expect(podcastEpisodeConversationId("episode-43")).not.toBe(podcastEpisodeConversationId("episode/42"));
  });

  it("allows only the newest asynchronous open to apply its transcript", () => {
    const intents = createPodcastChatOpenIntent();
    const slowEpisode = intents.begin();
    const currentEpisode = intents.begin();

    expect(intents.isCurrent(currentEpisode)).toBe(true);
    expect(intents.isCurrent(slowEpisode)).toBe(false);

    intents.invalidate();
    expect(intents.isCurrent(currentEpisode)).toBe(false);
  });

  it("partitions an episode conversation by account profile", () => {
    expect(podcastEpisodeConversationId("episode-42", "account-a"))
      .not.toBe(podcastEpisodeConversationId("episode-42", "account-b"));
  });

  it("tracks the originating view separately from a reopened view", () => {
    const conversationId = podcastEpisodeConversationId("episode-42");
    const detachOrigin = attachPodcastEpisodeView(conversationId, "origin-view");
    const attempt = beginPodcastEpisodeAttempt({
      conversationId,
      userMessageId: "question-1",
      ownerProfileId: "local",
      originViewId: "origin-view",
    })!;
    const detachReopened = attachPodcastEpisodeView(conversationId, "reopened-view");

    expect(isPodcastEpisodeOriginViewAttached(conversationId, attempt.originViewId)).toBe(true);
    detachOrigin();
    expect(isPodcastEpisodeOriginViewAttached(conversationId, attempt.originViewId)).toBe(false);
    expect(isPodcastEpisodeOriginViewAttached(conversationId, "reopened-view")).toBe(true);

    detachReopened();
    finishPodcastEpisodeAttempt(conversationId, attempt.id);
  });
});
