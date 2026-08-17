/**
 * Behavioral tests for RSS semantic preference learning (OpenSpec:
 * rss-semantic-preference-learning). Uses deterministic fixture embeddings —
 * the scenario matrix from the spec:
 *
 *   liked-topic unseen articles rise; disliked-topic articles fall;
 *   cross-author/source transfer works; cold start keeps legacy behavior;
 *   saved articles get an implicit boost; exploration is deterministic.
 */
import { describe, expect, it } from "vitest";
import { scoreRssRelevance, SEMANTIC_WEIGHT, type RssClassifier } from "../rssRelevance";

const noClassifiers: RssClassifier[] = [];

const baseInput = (overrides: Partial<Parameters<typeof scoreRssRelevance>[0]> = {}) => ({
  itemTitle: "Speculative decoding for efficient local LLM inference",
  itemAuthor: "A. Researcher",
  itemTags: ["llm", "inference"],
  feedId: "feed-tech",
  feedTitle: "Tech Weekly",
  pubDate: new Date(Date.now() - 3600_000).toISOString(),
  ...overrides,
});

// Deterministic "topic vectors" reduced to backend-computed semantic scores
// (the cosine math itself is covered by the Rust rss_preferences tests).
const likedTopicSemantic = 0.88; // unseen article semantically in liked cluster
const neutralSemantic = 0.5;
const dislikedTopicSemantic = 0.12; // unseen article semantically in disliked cluster

describe("semantic hybrid ranking", () => {
  it("unseen articles semantically similar to liked content rank higher", () => {
    const liked = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: likedTopicSemantic });
    const unrelated = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: neutralSemantic });
    expect(liked).toBeGreaterThan(unrelated);
  });

  it("articles semantically similar to disliked content rank lower", () => {
    const disliked = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: dislikedTopicSemantic });
    const unrelated = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: neutralSemantic });
    expect(disliked).toBeLessThan(unrelated);
    expect(disliked).toBeLessThan(0.5);
  });

  it("transfers across author/source/tags (semantic term is metadata-independent)", () => {
    // Same semantic score, completely different metadata dimensions.
    const sameTopicDifferentAuthor = scoreRssRelevance(
      baseInput({ itemAuthor: "Someone Else", feedId: "feed-other", feedTitle: "Other Paper", itemTags: ["hardware"] }),
      noClassifiers,
      { semanticScore: likedTopicSemantic },
    );
    const baseline = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: likedTopicSemantic });
    // Both rise above the neutral article regardless of who published it.
    const unrelated = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: neutralSemantic });
    expect(sameTopicDifferentAuthor).toBeGreaterThan(unrelated);
    expect(baseline).toBeGreaterThan(unrelated);
  });

  it("same author but different topic does not blindly inherit preference", () => {
    const sameAuthorLikedTopic = scoreRssRelevance(
      baseInput(),
      noClassifiers,
      { semanticScore: likedTopicSemantic },
    );
    const sameAuthorOtherTopic = scoreRssRelevance(
      baseInput({ itemTitle: "NBA finals recap" }),
      noClassifiers,
      { semanticScore: dislikedTopicSemantic },
    );
    expect(sameAuthorOtherTopic).toBeLessThan(sameAuthorLikedTopic);
  });

  it("cold start (no semantic score) keeps the legacy classifier behavior exactly", () => {
    const classifier: RssClassifier = {
      classifier_type: "author",
      value: "A. Researcher",
      sentiment: "like",
      scope: "global",
      feed_id: undefined,
    };
    const legacy = scoreRssRelevance(baseInput(), [classifier]);
    const withNullSemantic = scoreRssRelevance(baseInput(), [classifier], { semanticScore: null });
    expect(withNullSemantic).toBe(legacy);
  });

  it("a single thumbs-up cannot dramatically reorder the feed (bounded blend)", () => {
    const max = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: 1 });
    const min = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: 0 });
    // Metadata keeps 1 − SEMANTIC_WEIGHT of the score; semantic swings at most
    // SEMANTIC_WEIGHT in either direction.
    expect(max - min).toBeCloseTo(SEMANTIC_WEIGHT, 5);
  });

  it("saved articles receive a modest implicit-engagement boost", () => {
    const saved = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: neutralSemantic, saved: true });
    const unsaved = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: neutralSemantic });
    expect(saved).toBeGreaterThan(unsaved);
    expect(saved - unsaved).toBeLessThanOrEqual(0.1);
  });

  it("exploration is deterministic and bounded", () => {
    const once = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: 0.35 });
    const again = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: 0.35 });
    expect(once).toBe(again); // stable per (title, feed)
    // Across a spread of deterministic inputs, only a minority get the lift —
    // the feed keeps most of its personalized ordering.
    let boosted = 0;
    for (let i = 0; i < 200; i++) {
      const plain = scoreRssRelevance(baseInput(), noClassifiers, { semanticScore: 0.35 });
      const noExplore = plain;
      const withOtherTitle = scoreRssRelevance(
        baseInput({ itemTitle: `variant ${i}` }),
        noClassifiers,
        { semanticScore: 0.35 },
      );
      if (withOtherTitle > noExplore + 0.1) boosted += 1;
    }
    expect(boosted).toBeLessThan(200 * 0.25);
  });
});
