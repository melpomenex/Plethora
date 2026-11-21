import { bench, describe } from "vitest";
import { seededRandom } from "../../test/bench-support";
import type { SmartFeed } from "../../api/rss-smart-feeds";
import {
  buildQueryProfile,
  evaluateArticleAgainstProfile,
  fastFnvHash,
  type EngineArticleInput,
} from "../smartFeedsEngine";

// Prevent Dead Code Elimination without side effects visible to callers.
let sink = 0;

const TOPIC_POOLS = [
  {
    title: "Open-Source Reasoning Model Inference Optimization Checkpoint",
    summary:
      "New model release featuring tool calling, 4-bit quantization, local inference benchmarks, and transformer memory architecture.",
  },
  {
    title: "Diplomatic Ceasefire Discussions Over Iran Regional Security Sanctions",
    summary:
      "International negotiations covering regional ceasefire proposals, humanitarian corridors, and sanctions updates.",
  },
  {
    title: "Deterministic Distributed Compiler Consensus Protocol Study",
    summary:
      "Theoretical computer science algorithms reducing latency across distributed systems and compiler passes.",
  },
  {
    title: "Traditional Gardening Techniques and Sourdough Pastry Recipes",
    summary:
      "Seasonal weekend cooking tips, herbal garden beds, and homemade saffron bread recipes.",
  },
];

function buildDeterministicArticles(count: number, seed: number): EngineArticleInput[] {
  const rng = seededRandom(seed);
  const out: EngineArticleInput[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const topicIdx = Math.floor(rng() * TOPIC_POOLS.length);
    const template = TOPIC_POOLS[topicIdx];
    out[i] = {
      id: `bench-art-${i}`,
      feedId: `feed-${i % 10}`,
      feedTitle: `Source ${i % 10}`,
      url: `https://bench.example.com/${i}`,
      title: `${template.title} #${i}`,
      summary: template.summary,
      content: template.summary,
      categories: [],
      publishedDate: "2026-11-20T10:00:00Z",
      dateAdded: "2026-11-20T10:00:00Z",
    };
  }
  return out;
}

function buildDeterministicFeeds(count: number): SmartFeed[] {
  const now = "2026-11-20T12:00:00Z";
  return Array.from({ length: count }, (_, k) => ({
    id: `sf-bench-${k}`,
    name: `Smart Feed ${k}`,
    description:
      k % 2 === 0
        ? "Open-source reasoning models, local inference optimization, distributed compilers, transformer architectures"
        : "Iran ceasefire discussions, regional security diplomacy, conflict sanctions, humanitarian aid",
    inclusion_criteria: "",
    exclusion_criteria: "Gardening recipes, sourdough pastry cooking",
    source_scope: "all",
    source_scope_config: { feed_ids: [], folder_ids: [] },
    classification_mode: "fast_local",
    curation_strictness: "balanced",
    minimum_relevance: null,
    freshness_window_days: null,
    sort_order: "relevance",
    group_similar_stories: true,
    is_enabled: true,
    cloud_consent_granted: false,
    preferred_provider: null,
    preferred_model: null,
    definition_revision: 1,
    created_at: now,
    updated_at: now,
    last_evaluated_at: now,
  }));
}

const articles500 = buildDeterministicArticles(500, 101);
const articles5000 = buildDeterministicArticles(5000, 202);
const feeds10 = buildDeterministicFeeds(10);
const profiles10 = feeds10.map((f) => buildQueryProfile(f));

const cachedHashes5000 = new Map<string, string>();
for (const a of articles5000) {
  cachedHashes5000.set(a.id, fastFnvHash(`${a.title}\0\0${a.summary}\0${a.content}`));
}
const incrementalNew25 = buildDeterministicArticles(25, 303);

describe("smartFeedsEngine benchmarks", () => {
  bench("smartFeeds/evaluate-500-articles-10-feeds", () => {
    let total = 0;
    for (let f = 0; f < feeds10.length; f++) {
      const feed = feeds10[f];
      const profile = profiles10[f];
      for (let i = 0; i < articles500.length; i++) {
        const res = evaluateArticleAgainstProfile(feed, profile, articles500[i], 1_795_171_200_000);
        total += res.relevanceScore;
      }
    }
    sink += total;
  });

  bench("smartFeeds/evaluate-5000-articles-10-feeds", () => {
    let total = 0;
    for (let f = 0; f < feeds10.length; f++) {
      const feed = feeds10[f];
      const profile = profiles10[f];
      for (let i = 0; i < articles5000.length; i++) {
        const res = evaluateArticleAgainstProfile(feed, profile, articles5000[i], 1_795_171_200_000);
        total += res.relevanceScore;
      }
    }
    sink += total;
  });

  bench("smartFeeds/incremental-cached-5000-articles", () => {
    let hits = 0;
    for (let f = 0; f < feeds10.length; f++) {
      const feed = feeds10[f];
      const profile = profiles10[f];
      for (let i = 0; i < articles5000.length; i++) {
        const art = articles5000[i];
        const hash = fastFnvHash(`${art.title}\0\0${art.summary}\0${art.content}`);
        if (cachedHashes5000.get(art.id) === hash) {
          hits++;
          continue;
        }
      }
      for (let j = 0; j < incrementalNew25.length; j++) {
        const res = evaluateArticleAgainstProfile(feed, profile, incrementalNew25[j], 1_795_171_200_000);
        hits += res.relevanceScore;
      }
    }
    sink += hits;
  });
});

export function readBenchSink(): number {
  return sink;
}
