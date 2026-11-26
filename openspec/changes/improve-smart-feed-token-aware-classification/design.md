## Context

### Verified Laya Runtime Capabilities (`laya[serve]==0.5.2` + `convaiinnovations/laya-typed-decisions@3903ff997712bd73ccb2dc879262dac8f0d443bb`)

Inspection of the pinned `laya==0.5.2` package and checkpoint `rl_agent_config.json` / `encoder/config.json` / `tokenizer/tokenizer.json` establishes:

- **Encoder**: `answerdotai/ModernBERT-large` (`vocab_size=50368`, `max_position_embeddings=8192`).
- **Trained Checkpoint Limits (`rl_agent_config.json`)**: `max_len = 1024`, `head_max_len = 256`, `fine_tuned = true`. While ModernBERT supports 8192 positions, the RL decision head was trained at `max_len = 1024` / `head_max_len = 256`; therefore `1024 / 256` is the default authoritative budget.
- **Per-Question Sequence Layout (`laya/common.py::build_sequence`)**:
  `[CLS] <type> question: <instructions> [SEP] [MASK] <opt0> [MASK] <opt1> ... [SEP] <state> [SEP]`
  - Each question in `questions` is encoded **independently** with the shared `state`.
  - Options are capped at 48 tokens each (and compressed if `head_max_len - sum(opts) < 16`).
  - Instructions are capped at `max(8, head_max_len - sum(opts))`.
  - Remaining state room per question is `room = max(0, max_len - len(head_ids) - 1)`.
  - State serialization is `json.dumps(state, ensure_ascii=False)` for objects/arrays or raw string for strings, with `[MASK]` replaced by `" "`.
- **HTTP Endpoints (`laya/serve.py`)**:
  - `GET /health`, `POST /v1/route`, `POST /v1/systemone`, `POST /v1/systemone/batch`.
  - `predict_long` is Python-only in `laya==0.5.2` and is NOT exposed over HTTP; no `/tokenize` HTTP endpoint exists.
  - `POST /v1/systemone` accepts `"model": "typed-decisions"` and returns `usage.{input_tokens, state_tokens, state_tokens_dropped, truncated, truncated_questions}` when `LAYA_JEV_STRICT` is false (default).

## Goals / Non-Goals

- **Goals**:
  1. Exact tokenizer-aware input budgeting in Rust using `tokenizers` loaded from the active Laya checkpoint's `tokenizer/tokenizer.json` (with deterministic fallback when the checkpoint is absent).
  2. Structure-preserving article normalization with boilerplate suppression and explicit `ContentProvenance`.
  3. Token-aware, sentence/paragraph-preserving passage chunking and dual (positive + negative/contradictory) passage retrieval with lazy embedding caching.
  4. Adaptive classification depth (`fast`, `adaptive`, `thorough`), improved initial routing beyond `UNCERTAIN`-only, and document-level aggregation with topical centrality.
  5. Evidence-grounded explanations, runtime truncation inspection/recovery, and additive SQLite caching (`161_smart_feed_passages_and_diagnostics`).
- **Non-Goals**:
  1. Replacing Laya Typed Decisions with a generative LLM or modifying `laya[serve]==0.5.2` upstream code.
  2. Unboundedly increasing `max_len` to 8192 without checkpoint retraining/validation.
  3. Automatic web-crawling of paywalled or unsubscribed sites.

## Decisions

### D1: Exact Tokenization via `tokenizers` Crate (`fancy-regex`)
Instead of spawning a Python subprocess or adding a secondary HTTP service for token counting, Plethora embeds HuggingFace's `tokenizers` crate (`default-features = false, features = ["fancy-regex"]`) in Rust and loads `tokenizer/tokenizer.json` lazily from the verified Laya checkpoint directory (`app_data_dir/models/laya/.../tokenizer/tokenizer.json`). When no checkpoint is present (e.g. unit tests without local weights or Web/PWA), a conservative deterministic BPE-character fallback estimator is used and flagged.
- **Budgeting Rule**: For every question `q` in the Laya request, compute `head_len(q)` using Laya's exact `[CLS] <type> question: <ins> [SEP] [MASK] <opt_i> ... [SEP]` layout. The available state room is `min_q(max_len - head_len(q) - 1) - safety_margin` (default `safety_margin = 8`).
- **Context Prioritization**: Essential instructions and inclusion/exclusion criteria are placed in compact, non-redundant question heads (fitting comfortably inside `head_max_len = 256` without duplicating 1600-char boilerplate across 3 questions). Within `state`, `title` and selected `evidence` (or `summary`/`lead`) are budgeted first, followed by `categories` and `source` only if room remains. Exclusion criteria are never silently dropped; if feed criteria exceed `head_max_len`, they are summarized deterministically with a diagnostic flag.

### D2: Structure-Preserving Normalization & Boilerplate Suppression
`normalize.rs` retains paragraph breaks (`\n\n`) and heading markers (`## `) for `body_text` / `best_text` while keeping `summary_text` clean. Common RSS boilerplate lines (e.g., "Subscribe to our newsletter", "Cookie Policy", "Read more:", "Advertisement", "Follow us on") are stripped before chunking. `ContentProvenance` (`headline_only`, `summary_only`, `rss_embedded`, `full_extracted`, `partial`) is recorded on `ArticleSnapshot` and persisted in `rss_smart_feed_matches`. `content_hash` hashes the full normalized `best_text` (not only the first 4,000 chars) plus pipeline normalization version.

### D3: Token-Aware Passage Chunking & Dual Retrieval (`passages.rs`)
- Articles exceeding the single-pass state budget (or evaluated in Stage C) are split into deterministic, Unicode-safe, paragraph/sentence-aware passages targeting `passage_token_budget = clamp(state_room - metadata_tokens - 32, 220, 480)` with ~40–60 token sentence overlap.
- Each `ArticlePassage` has a stable ID `sha256(article_id, content_hash, passage_index)`, `start_char`, `end_char`, optional `section_heading`, `token_count`, and `text`.
- **Dual Passage Retrieval**: Given a `SmartFeed`, score each passage for:
  1. `positive_score`: semantic cosine similarity to `feed.positive_embedding` (when available) + lexical/phrase/entity overlap with `feed` positive terms + structural lead boost.
  2. `negative_score`: semantic cosine similarity to `feed.negative_embedding` + lexical/phrase overlap with `feed` exclusion terms + boilerplate/incidental-mention penalty.
- Select up to `K` passages (`K=3` for `adaptive`, `K=5` for `thorough`, `K=1` for `fast`): top positive passages, top negative/contradictory passages (if `negative_score > 0.15`), and the lead passage (index 0) for global context, using diversity-aware Jaccard deduplication (`jaccard < 0.72`) so near-identical chunks are not repeatedly evaluated.

### D4: Improved Initial Routing & Adaptive Multi-Stage Pipeline
- **Stage A (Fast Local Signals)**: `retrieve_candidate_signals` + `evaluate_fast_local` compute preliminary decision, relevance score, and routing confidence.
- **Routing Policy (`should_escalate_to_laya`)**: In `intelligent_local` / `hybrid` modes, escalate to Laya not only when `fast_out.decision == UNCERTAIN`, but also when:
  - `relevance_score` is within `0.14` of `include_floor` or `uncertain_floor` (borderline margin),
  - lexical and semantic signals conflict (`|lex - sem| >= 0.30`),
  - negative exclusion evidence co-occurs with positive topical evidence (`negative_lexical_score >= 0.20 && positive_lexical_score >= 0.18`),
  - `best_text` is long (`> state_room` tokens) and `summary_text` is short/weak (`< 120` chars) while `is_candidate` or partial match holds,
  - or `evaluation_depth == Thorough` and `is_candidate`.
  Obvious non-candidates (`!is_candidate` with zero positive hits and zero semantic signal) still exit early.
- **Stage B (Compact Laya Evaluation)**: Build token-safe single-pass state (`title` + `lead`/`summary` + top-1 retrieved excerpt if `best_text` differs from `summary_text`). Explicitly set `"model": "typed-decisions"`. Inspect `usage.truncated` / `usage.state_tokens_dropped`. If unexpected truncation occurs, repack with smaller passage budget and mark truncation metadata.
- **Stage C (Multi-Passage Escalation)**: Escalate from Stage B to Stage C when:
  - `evaluation_depth != Fast`, AND
  - article has `> 1` passage AND (`stage_b.decision == UNCERTAIN` OR `stage_b.confidence < 0.55` OR `stage_b.truncated` OR headline/body conflict OR `negative_score` triggered in passages OR `evaluation_depth == Thorough`).
  Evaluate selected passages via `POST /v1/systemone/batch` (with single-request fallback if batch is unsupported by a mock/custom endpoint) using compact typed questions:
  - `decision` (`INCLUDE` / `UNCERTAIN` / `EXCLUDE`)
  - `centrality` (`PRIMARY` / `SECONDARY` / `INCIDENTAL` / `OFF_TOPIC`)
  - `relevance` (`score` 0..4)
  - `matches_criteria` (`noul`)
- **Stage D (Document-Level Aggregation)**:
  Aggregate passage-level outputs deterministically:
  - **Topical Centrality Gate**: An article where no passage achieves `PRIMARY` or `SECONDARY` centrality (all `INCIDENTAL` or `OFF_TOPIC`) cannot be `INCLUDE` under `Balanced` or `Strict` strictness (and is downgraded to `UNCERTAIN` or `EXCLUDE` unless `Broad` + strong lead/title support).
  - **Exclusion Dominance**: If any substantive passage triggers `EXCLUDE` with high confidence or matches explicit exclusion criteria without being negated, apply exclusion penalty and prevent naive max-score inclusion.
  - **Strictness Calibration**: `Broad` allows strong secondary coverage; `Balanced` requires primary or multi-passage secondary support; `Strict` requires primary centrality + high mean/top relevance without exclusion conflict.
  - **Custom `minimum_relevance`**: Applied after aggregation so user-configured floors are always respected.

### D5: Additive Database Schema (Migration `161_smart_feed_passages_and_diagnostics`)
- New table `rss_article_passages (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, content_hash TEXT NOT NULL, passage_index INTEGER NOT NULL, start_char INTEGER NOT NULL, end_char INTEGER NOT NULL, section_heading TEXT, token_count INTEGER NOT NULL, text TEXT NOT NULL, provenance TEXT NOT NULL, chunker_version TEXT NOT NULL, created_at TEXT NOT NULL)`.
- New table `rss_article_passage_embeddings (passage_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, dimension INTEGER NOT NULL, embedding BLOB NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`.
- Additive columns on `rss_smart_feeds`: `evaluation_depth TEXT NOT NULL DEFAULT 'adaptive'`.
- Additive columns on `rss_smart_feed_matches`: `evaluation_depth TEXT NOT NULL DEFAULT 'adaptive'`, `content_provenance TEXT NOT NULL DEFAULT 'summary_only'`, `passages_evaluated INTEGER NOT NULL DEFAULT 0`, `passages_total INTEGER NOT NULL DEFAULT 0`, `inference_calls INTEGER NOT NULL DEFAULT 0`, `unexpected_truncation INTEGER NOT NULL DEFAULT 0`, `diagnostics_json TEXT`.
- `CLASSIFIER_VERSION` bumped from `"smart-feed-v1"` to `"smart-feed-v2"` so stale cached decisions are incrementally reevaluated without blocking startup, while `is_user_override = 1` is strictly preserved.

## Risks / Trade-offs

- **CPU/Latency on Large Backfills**: Multi-passage Laya evaluation is bounded by `MAX_PASSAGES_ADAPTIVE = 3`, `MAX_PASSAGES_THOROUGH = 5`, `MAX_LLM_CONCURRENCY = 2`, batching via `/v1/systemone/batch`, and lazy passage embedding generation only for escalated articles.
- **Tokenizer Availability in Tests/Web**: Tests without local Laya weights use the fallback token estimator or an in-memory test tokenizer; Web/PWA uses `smartFeedsEngine.ts` without native dependencies.
- **Privacy**: `intelligent_local` strictly enforces loopback/local-only Laya and local-only embeddings (`strict_local_only` blocks cloud embeddings), never falling back to cloud LLMs on local failure.
