# Plethora 1.0 — Proposal D: RSS Semantic Preference Learning

## Why

RSS thumbs-up/down currently trains only coarse author/tag classifiers, so 👍/👎 cannot recognize *substantively similar* content across publications, tags, or authors. The repo already contains a complete-but-orphaned Rust relevance engine (`src-tauri/src/algorithms/relevance.rs` — never declared in `mod.rs`), embedding providers including local Ollama, and a `queue_item_embeddings` store; this change wires feedback to embeddings so ranking learns semantically, with decay, diversity, and privacy by default.

## What Changes

- **Article-level feedback**: new `rss_article_feedback` table (article_id, sentiment like/dislike, created_at, embedding model provenance). Thumbs now persist an article-level event **in addition to** the existing author/tag classifier so current behavior/UI (undo, toast, filled state) keeps working.
- **Semantic preference profile**: incremental, decayed multi-cluster centroids per sentiment (online clustering: assign to nearest cluster when cosine ≥ threshold, else spawn; cap cluster count, merge weakest). Stored in a `rss_preference_clusters` table (sum vector, weight, last_updated, exemplar article id/title for explainability). Updated when the feedback article's embedding is available; article is embedded on demand via the existing `queue_item_embeddings` infrastructure (respecting provider config; local provider by default when configured).
- **Hybrid ranker**: the live TS ranking path (`scoreRssRelevance` used by queue assembly) gains a semantic term `positiveSimilarity·w₊ − negativeSimilarity·w₋` computed against decayed clusters, plus implicit-engagement terms (saved/is_queued bonus), and an **exploration factor** that reserves ranking lift for diverse/unseen topics. Cold start (< minimum feedback weight) keeps existing behavior. Weighting configurable and unit-tested.
- **Register the orphaned Rust engine**: declare `pub mod relevance;` in `algorithms/mod.rs` so its 25 existing unit tests run and its math (cosine, centroid, weight redistribution) becomes the canonical implementation reused by the feedback commands (no duplicated product logic).
- **Feedback UX**: immediate confirm + persisted state (existing), re-rank future content without reshuffling the active viewport, undo removes both classifier and semantic contribution (recomputing clusters from the feedback table, which is the source of truth).
- **Explainability**: `RelevanceIndicator` gains a reason line ("Recommended because you liked articles like *<title>*") from cluster exemplars, behind its existing affordance.
- **Privacy/local-first**: embeddings computed via configured provider with existing local-first options; no full reading history leaves the device; cloud embedding only under existing AI provider settings and disclosure rules. Preference data included in account export/delete paths where RSS data already flows.
- **Behavioral tests**: deterministic fixture embeddings over synthetic topic clusters (local-LLM/NBA/cooking/cybersecurity) verifying: liked-topic unseen articles rise; disliked-topic articles fall; cross-author/source transfer; same-author-different-topic does not blindly inherit; old feedback decays; exploration can still surface low-similarity items.

## Capabilities

### New Capabilities
- `rss-preference-profile`: persistence and incremental decayed maintenance of semantic like/dislike clusters from explicit article feedback.
- `rss-hybrid-ranking`: composite ranking of RSS items combining semantic preference, classifiers/metadata, recency, implicit engagement, and exploration; cold-start and explainability requirements.

### Modified Capabilities
- None (`document-rating` concerns documents, not RSS).

## Impact

- Rust: new migration (2 tables), feedback commands + cluster maintenance + profile query in `src-tauri/src/rss/`, module registration for `relevance.rs`.
- TS: `rss-classifiers` API additions, `scoreRssRelevance` semantic extension, `RelevanceIndicator` reason, QueueScrollPage wiring (no reshuffle of active viewport).
- No changes to feed fetch cadence; embedding work is on-demand + bounded background batches, never blocking feed rendering.

Cross-references: part of Plethora 1.0; independent of A/B/C. Companion (C) may later consume `rss_liked`/`rss_disliked` events introduced here.
