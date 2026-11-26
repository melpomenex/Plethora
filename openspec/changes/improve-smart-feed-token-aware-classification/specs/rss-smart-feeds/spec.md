## ADDED Requirements

### Requirement: Token-aware Laya context budgeting and truncation recovery
The system SHALL compute Laya Typed Decisions input budgets using the active checkpoint's tokenizer (`max_len = 1024`, `head_max_len = 256` for `convaiinnovations/laya-typed-decisions`), accounting for per-question heads, option labels, serialization overhead, and safety margins, SHALL prioritize instructions, inclusion/exclusion criteria, title, and article evidence over redundant metadata, SHALL never silently drop exclusion criteria, and SHALL inspect runtime truncation metadata (`usage.truncated`, `usage.state_tokens_dropped`, `usage.truncated_questions`) with bounded repacking on unexpected truncation.

#### Scenario: Oversized feed criteria and long article stay within Laya token budget
- **WHEN** a Smart Feed with lengthy description, inclusion criteria, and exclusion criteria evaluates a 10,000-character article via Laya
- **THEN** the constructed request respects `head_max_len` and `max_len` per question, preserves exclusion criteria, and avoids unbudgeted token overflow

#### Scenario: Unexpected runtime truncation triggers bounded recovery
- **WHEN** Laya returns `usage.truncated = true` or `usage.state_tokens_dropped > 0`
- **THEN** the system records the truncation event, attempts bounded repacking at a smaller state budget, and preserves uncertainty rather than reporting a fully grounded classification if required evidence could not be processed

### Requirement: Structure-preserving article normalization and content provenance
The system SHALL distinguish article content provenance (`headline_only`, `summary_only`, `rss_embedded`, `full_extracted`, `partial`), preserve paragraph and heading boundaries during normalization, suppress common RSS boilerplate, use available full content rather than stopping at a nonempty RSS summary, and hash full normalized content for cache invalidation.

#### Scenario: Full content overrides short or misleading RSS summary
- **WHEN** an article has a one-sentence generic RSS summary alongside extracted full content discussing semiconductor AI accelerators in detail
- **THEN** classification evaluates the full normalized content and records `full_extracted` or `rss_embedded` provenance

### Requirement: Token-aware passage chunking and dual evidence retrieval
The system SHALL split long articles deterministically into Unicode-safe, paragraph- and sentence-aware overlapping passages sized from Laya's remaining token budget, and SHALL retrieve both positive/supporting passages and negative/exclusion/contradictory passages using local embeddings (with deterministic lexical/structural fallback when embeddings are unavailable) and diversity-aware deduplication.

#### Scenario: Relevant evidence near the end of a long article is retrieved
- **WHEN** a 6,000-token article discusses an unrelated topic in its first 3,000 tokens and substantively covers the Smart Feed topic in later sections
- **THEN** passage chunking and retrieval surface the later passages for Laya evaluation

#### Scenario: Contradictory and exclusion passages are retrieved alongside positive passages
- **WHEN** an article contains both positive topical terms and explicit exclusion-criteria evidence
- **THEN** dual retrieval selects both supporting and contradictory passages so document-level aggregation does not rely solely on positive snippets

### Requirement: Adaptive classification depth, improved routing, and topical centrality aggregation
The system SHALL support `fast`, `adaptive` (default), and `thorough` evaluation depths for local decision-model classification, SHALL escalate borderline, conflicting, or summary-vs-body-divergent candidate articles to Laya even when fast-local did not return `UNCERTAIN`, and SHALL aggregate multi-passage Laya decisions using topical centrality so incidental mentions do not cause false inclusion under `balanced` or `strict` curation.

#### Scenario: Incidental mention in unrelated long article is not included in Strict feed
- **WHEN** a long political election article mentions an AI-generated image in one sentence and is evaluated for a Strict "AI News" feed
- **THEN** multi-passage evaluation and topical-centrality aggregation classify the article as `EXCLUDE` or `UNCERTAIN` rather than `INCLUDE`

#### Scenario: Weak fast-local decision with conflicting signals escalates to Laya
- **WHEN** `evaluate_fast_local` returns a borderline `INCLUDE` or `EXCLUDE` near strictness thresholds with conflicting lexical and semantic signals
- **THEN** `intelligent_local` routing escalates the article to Laya rather than accepting the fast-local decision unchecked

### Requirement: Evidence-grounded explanations, additive caching, and diagnostics UI
The system SHALL construct deterministic explanations grounded in actual evaluated passage excerpts, evaluation depth, content provenance, passages evaluated vs. total, and truncation status, SHALL cache reusable article passages and lazy passage embeddings in SQLite (`161_smart_feed_passages_and_diagnostics`) keyed by content hash and model provenance, and SHALL surface these diagnostics in the Smart Feeds UI while preserving local-only privacy guarantees and user overrides.

#### Scenario: Grounded explanation cites evaluated passages and diagnostics
- **WHEN** an article is classified via Adaptive multi-passage Laya evaluation
- **THEN** the persisted match and UI details display the supporting/contradictory passage evidence, evaluation depth, passages evaluated count, content provenance, and truncation status without fabricating unseen text

#### Scenario: Intelligent Local never falls back to cloud providers on failure
- **WHEN** local Laya or local embedding inference fails or is unavailable for an `intelligent_local` feed
- **THEN** the system records a deferred or lexical-fallback state and never transmits article text or feed criteria to a cloud AI provider
