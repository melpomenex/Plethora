# Plethora language-learning proposal dependency summary

This plan covers the 23 independent OpenSpec changes generated from the language-learning brief. The changes are proposal/design/spec/task artifacts only; no product code is implemented by this plan.

## 1. Exact changes, waves, dependencies, and parallelization

| # | OpenSpec change | Wave | Hard dependencies | Soft dependencies | Parallel status / likely overlap |
|---:|---|---|---|---|---|
| 1 | `add-language-learning-profiles` | A1 | None | `complete-app-internationalization`, `add-collections` | Parallel with #2. Touches profile/settings/document association files; coordinate with account/collection schema. |
| 2 | `add-language-processing-adapter-layer` | A1 | None | #1 | Parallel with #1. Establishes the linguistic contract consumed by nearly every later change; avoid competing tokenizer abstractions. |
| 3 | `add-language-lexicon-and-occurrence-model` | A2 | #1, #2 | active `unify-selection-dictionary-lookup`, `add-collections`, transcript/audio alignment | Must follow #1/#2. Heavy migration/repository overlap with #4, #9, #10, #11, #12. |
| 4 | `add-language-vocabulary-knowledge-states` | A3 | #1, #2, #3 | dictionary lookup, SRS, future production practice | Must follow #3. Shares lexicon/state APIs with #5, #6, #9, #10, #11, #17. |
| 5 | `add-language-reader-vocabulary-highlighting` | B1 | #1–#4 | `improve-reader-tts`, `readable-document-highlights`, PDF selection changes | Can run beside #6, #7, #9, #10 after contracts stabilize, but not concurrently with other edits to reader annotation/selection files without coordination. |
| 6 | `upgrade-dictionary-peek-for-language-learning` | B1 | #1–#4 | #7, #12, #13, #11; active `unify-selection-dictionary-lookup` | Can run beside #5/#7/#9/#10 at API level; conflicts directly on `DictionaryPeek.tsx`, selection interaction, dictionary service, and vocabulary history. |
| 7 | `add-language-sentence-translation` | B1 | #1, #2 | #3/#4, #13 | Can run beside #5/#6/#9/#10. Owns translation service/cache; sentence/video/Peek consumers should wait for its contract. |
| 8 | `add-language-sentence-mode` | B2 | #1–#4, #7 | #13, #11, future #19/#20 | Follow #7 and reader anchor contracts. Conflicts with reader route/view state, TTS, Sentence Mode entry points, and #15. |
| 9 | `add-language-learning-analytics` | B1/B2 | #1, #3, #4 | #10, #11, #13, #19, #20, #22; `implement-plethora-knowledge-health-and-advanced-learning-analytics` | Metric catalog can start beside #5–#7, but aggregate schema/API files overlap with every evidence-producing feature. |
| 10 | `add-language-lexical-coverage-and-difficulty` | B1 | #1–#4 | #9, #23, Queue composition changes | Can run beside #5–#7 after state APIs. Conflicts with Queue selector/metadata and lexicon projections. |
| 11 | `integrate-language-vocabulary-with-srs` | C1 | #1, #3, #4, existing Flashcard Studio/learning-item contracts | #7, #12, #13, #15, #19, #20 | Parallel with #12/#13/#16/#17 after P0. Conflicts with Flashcard Studio, `learning-items.ts`, review metadata, and Dictionary Peek actions. |
| 12 | `add-language-phrase-and-collocation-learning` | C1 | #1–#4 | #7, #11, #13 | Parallel with #11/#13/#16/#17. Conflicts with lexicon schema, selection intent, highlighting, coverage, and Peek. |
| 13 | `add-language-sentence-audio-alignment` | C1 | #1, #2, existing transcription/media/audio anchors | audiobook/EPUB sync, audio editions, TTS, YouTube sync | Parallel with #11/#12/#16/#17. High overlap with transcript/audio-edition repositories and playback resolver; stabilize before #14/#15/#19/#20. |
| 14 | `add-video-language-learning-mode` | C2 | #1–#7, #13, existing video/transcript playback | #12, #15, #16, #11 | Follow #13. Conflicts with `YouTubeViewer*`, transcript components, mobile video fixes, and active `youtube-transcript-playback-sync`. |
| 15 | `add-language-sentence-mining` | C2 | #1–#4, existing extracts/Flashcard Studio draft contracts | #7, #11, #12, #13, #14, screenshot capture | Follow #11 and preferably #13/#14. Conflicts with selection actions, extracts, Flashcard Studio, and source navigation. |
| 16 | `add-language-reading-assist-layer` | C1 | #1, #2, #5 anchor contract | #6, #7, e-ink/mobile reader work | Parallel with #11–#13/#17 if annotation contract is frozen. Conflicts with reader DOM/CSS, EPUB styling, RTL/accessibility. |
| 17 | `add-learner-aware-ai-language-tutor` | C1 | #1, #3, #4, existing AI/provider/retrieval contracts | #7, #9, #10, #18, #22; existing adaptive tutor/on-device AI changes | Parallel with #11–#13/#16 after learner-context contract. Conflicts with assistant/tutor context, provider settings, session persistence. |
| 18 | `add-personalized-language-content-generation` | C2 | #1, #2, #3, #4, #10, existing AI/content import | #7, #17, #11, #23 | Follow #10 and preferably #17. Conflicts with document import/provenance, AI provider settings, processing queues. |
| 19 | `add-language-shadowing-mode` | D1 | #1, #2, #8/audio playback, existing transcription | #13, #14, #15, #21 | Parallel with #20/#23 after shared practice/source contracts; conflicts with microphone/STT/TTS/media and Sentence Mode. |
| 20 | `add-language-dictation-mode` | D1 | #1, #2, #7, #8, audio/alignment | #13, #14, #11, #19, #9 | Parallel with #19/#23. Conflicts with Sentence Mode, transcript/audio controls, answer normalization, practice history. |
| 21 | `add-language-pronunciation-feedback` | D2 | #1, #2, #19, transcription/provider capability | #13, #9, #11 | Must follow #19. Conflicts with practice attempt/result schema and provider capability registry; do not implement with fabricated phoneme scoring. |
| 22 | `add-language-writing-practice` | D1/D2 | #1, #2, #3, #4, #17 | #7, #10, #11, #9, #20 | Can proceed after #17 while #19/#20 run, but shares AI context, practice evidence, analytics, and SRS handoff. |
| 23 | `add-language-content-recommendations` | D1 | #1, #2, #3, #4, #10, existing import/search | #9, #12, #18, Queue changes; active `recommendation-engine` | Parallel with #19/#20 after #10 and import contracts. Conflicts with search/import/Queue ranking and candidate caches. |

## 2. Dependency graph

```text
Profiles (#1) ───────────────┐
                             ├─> Lexicon/occurrences (#3) ─> Knowledge states (#4)
Processing adapters (#2) ────┘                                  │
                                                               ├─> Highlighting (#5)
                                                               ├─> Language Peek (#6)
                                                               ├─> Coverage/difficulty (#10) ─> Recommendations (#23)
                                                               ├─> Analytics (#9)
                                                               ├─> Vocabulary SRS (#11)
                                                               └─> Phrases (#12)

Profiles + processing ─> Translation (#7) ─> Sentence Mode (#8)
Profiles + processing + existing media ─> Original audio alignment (#13)

P0 contracts (#1–#10)
  ├─> SRS (#11) ───────────────┐
  ├─> Phrases (#12)             ├─> Sentence mining (#15)
  ├─> Audio alignment (#13) ────┘
  ├─> Reading assist (#16)
  ├─> Learner-aware tutor (#17) ─> Generated content (#18)
  │                                └─> Writing practice (#22)
  └─> Translation + alignment + transcript ─> Video Language Mode (#14)

Sentence/audio/transcription ─> Shadowing (#19) ─> Pronunciation feedback (#21)
Sentence/audio/translation ───> Dictation (#20)
Coverage + import/search ──────> Recommendations (#23)
```

## 3. Recommended implementation waves

### Wave A — shared contracts

1. #1 Profiles and #2 Processing adapters can be implemented in parallel after the shared language-tag naming is agreed.
2. #3 Lexicon/occurrences follows both and establishes durable identity, occurrences, source references, and migration from localStorage lookup history.
3. #4 Knowledge states follows #3 and freezes the distinction between exposure, state, evidence, and SRS.

### Wave B — first language-reading release

4. #5 Highlighting, #6 Language Peek, #7 Sentence Translation, #9 Analytics, and #10 Coverage can proceed in parallel once #1–#4 APIs are stable. #6 must coordinate with active `unify-selection-dictionary-lookup`; #5 must coordinate with `improve-reader-tts` and `readable-document-highlights`.
5. #8 Sentence Mode follows the sentence/translation/reader-anchor contracts and is the final P0 presentation layer.

### Wave C — high-value comprehension/input branches

6. #11 SRS, #12 Phrases, #13 Audio Alignment, #16 Reading Assist, and #17 Learner-aware Tutor can proceed in parallel at the contract level.
7. #14 Video Language Mode follows #13 and existing transcript/video sync work.
8. #15 Sentence Mining follows the Flashcard Studio draft contract (#11) and preferably the alignment/video collectors (#13/#14).
9. #18 Personalized Generation follows #10 and the learner-context/provider work in #17.

### Wave D — production and discovery

10. #19 Shadowing and #20 Dictation can proceed in parallel once sentence/audio/practice contracts are frozen.
11. #22 Writing Practice can proceed after #17; it shares evidence and AI context with #19/#20 but does not require them.
12. #23 Recommendations can proceed after #10 and import/search contracts, in parallel with #19/#20.
13. #21 Pronunciation Feedback follows #19 and only adds higher scoring levels when provider capability is real.

## 4. Safely parallelizable work

- #1 + #2: profile persistence and processing-adapter contract.
- After #4: #5 + #7 + #9 + #10, provided they consume frozen profile/lexicon/state interfaces.
- After P0 contracts: #11 + #12 + #13 + #16 + #17, with separate owners for their migrations and no shared-file edits.
- After #13/#11 contracts: #14 and #15 can be staged independently by source adapter.
- After #8/#13: #19 + #20; #23 can run alongside them after #10/import APIs.
- #22 can run alongside #19/#20 if it does not modify their practice schema directly; use the shared practice/evidence contract.

## 5. Work that must not run concurrently without coordination

- Reader selection/Peek: #5, #6, #8, #15, and active `unify-selection-dictionary-lookup` all touch `src/components/viewer/selectionInteraction/`, `DictionaryPeek`, `SelectionActionBar`, and reader hosts.
- Lexicon/state schema: #3, #4, #11, #12, #9, and #10 all touch the Rust repository, migrations, models, and profile-scoped queries.
- Transcript/media playback: #13, #14, #19, #20, and active/archived YouTube/audio/TTS changes touch transcript segments, timing, media controls, and source positions.
- TTS and spoken highlighting: #5, #6, #8, #13, #14, #19, and active `improve-reader-tts`/`harden-tts-caching-resume-discoverability-highlighting` must share one timing/original-audio resolver.
- Flashcard Studio/SRS: #11 and #15 overlap with existing Flashcard Studio, extract, learning-item, review, and scheduling changes; #12/#17/#22 should consume the contract rather than modify it independently.
- AI/provider context: #17, #18, and #22 overlap with `implement-plethora-teach-me-adaptive-ai-tutoring`, `add-ondevice-ai-learning-system`, and provider settings.
- Queue/import/ranking: #10, #14, #18, and #23 overlap with Queue composition/load changes, RSS/YouTube/podcast imports, and `recommendation-engine`.

## 6. Planned database/schema migrations by change

| Change | Migration/schema responsibility |
|---|---|
| #1 Profiles | `language_profiles`, profile preferences/configuration, `language_content_associations`, indexes, account/workspace scope. |
| #2 Processing | Processing runs/chunks, analysis-version/cache metadata, resumable job checkpoints; token payloads are paged/deduplicated. |
| #3 Lexicon | Lexical entries, surface forms, analyses, occurrences, lookup events/projections, source-reference indexes, orphan/retention fields. |
| #4 States | Knowledge state/override/history/evidence tables and the profile-scoped memorization-link skeleton; no change to generic scheduler state. |
| #5 Highlighting | No mandatory new durable table; profile display settings and optional annotation/cache metadata use #1/#2 contracts. |
| #6 Language Peek | No new core table; extends dictionary/translation/lexicon interaction provenance and existing cache metadata. |
| #7 Translation | Versioned translation cache/provenance rows or the existing durable cache abstraction, keyed by sentence/profile/provider/version. |
| #8 Sentence Mode | Prefer no new content table; if resumable sessions are persisted, add compact profile/document sentence-session snapshots keyed by source fingerprint. |
| #9 Analytics | Versioned profile-scoped daily aggregates, metric catalog, event cursors, freshness, and retention metadata. |
| #10 Coverage | Profile/document/content/processor/lexicon/policy-versioned coverage projections, chunk summaries, band configuration/freshness. |
| #11 SRS | Extend existing learning-item interaction metadata and review evidence; consume #4 memorization links rather than create a scheduler. |
| #12 Phrases | Phrase objects, constituent links, phrase occurrences, candidate evidence, and phrase-specific state/SRS references. |
| #13 Alignment | Source-anchor/media-range alignments, confidence/method, content/media fingerprints, provider/version, stale status. |
| #14 Video | Prefer existing transcript/video schema; only add a compact language-session/UI preference if persistence cannot use #1/#8. |
| #15 Mining | Prefer existing Flashcard Studio draft/source metadata; optional temporary mining drafts only if existing draft persistence cannot hold typed payloads. |
| #16 Reading Assist | Prefer #1/#2 profile settings and analysis cache; no separate source/reader database. |
| #17 Tutor | Extend existing assistant/tutor session/message/source tables; add language context provenance/version only if current session schema cannot carry it. |
| #18 Generation | Generated/adapted provenance in document metadata plus optional generation-run/request table for provider/cost/status/audit. |
| #19 Shadowing | Practice sessions/attempts, source/media refs, recording policy, recognized text/comparison summary, retention fields. |
| #20 Dictation | Shared practice attempts/error categories/normalization policy; reuse #19 practice infrastructure where compatible. |
| #21 Pronunciation | Derived pronunciation results/issues/provider capability/version linked to #19 attempts; no generic review schema changes. |
| #22 Writing | Writing sessions/drafts/corrections/evidence/provenance and retention; share practice/evidence contracts with #19/#20. |
| #23 Recommendations | Candidate lifecycle/cache/ranking/explanation/duplicate/dismissal rows with source/profile/config fingerprints. |

## 7. Shared interfaces to stabilize before parallel implementation

1. `LanguageProfileContext`: profile ID, target/base tags, level/preferences, active/explicit/auto resolution, capabilities, and privacy policy.
2. `LanguageProcessingAdapter`: capability manifest, version, sentence/token/analysis spans, confidence, normalization, provider errors, and deterministic fingerprints.
3. `SourceAnchor` / `SentenceIdentity`: EPUB CFI, PDF canonical/reflow/page, text offsets, transcript segment, media timestamp, source/content fingerprint, and stale resolution.
4. `LexicalObjectRef`: surface form, normalized form, lemma/phrase ID, analysis/version/confidence, profile scope, and occurrence reference.
5. `KnowledgeStateSnapshot` + `EvidenceEvent`: New/Encountered/Learning/Familiar/Known/Ignored, manual override, passive/active evidence, history, and independent SRS link.
6. `LanguageAnnotationLayer`: visible spans, state style, assist annotations, precedence with selection/user highlight/TTS/search, and incremental invalidation.
7. `TranslationService`: sentence request/result, language pair, provider/model/version, cache key, source anchor, confidence, and typed unavailable/stale result.
8. `OriginalMediaResolver`: current source anchor → native media range/confidence/method, with TTS fallback and no-wrong-occurrence guarantee.
9. `LanguageMiningPayload` / Flashcard Studio language draft: bounded context, translation/analysis, source/media refs, optional frame, availability, provider provenance, and explicit acceptance.
10. `LearnerContextPacket`: compact ranked lexicon/evidence/content context with budget, privacy/redaction, freshness, and source attribution.
11. `PracticeAttempt` + `ProductionEvidence`: source sentence/media, learner output/recording, comparison, confidence, retention, and explicit evidence acceptance.
12. `CoverageSummary` and `RecommendationCandidate`: versioned counts/freshness/policy/explanations that Queue can consume as optional signals.

## 8. Existing active/archived OpenSpecs to extend or coordinate

- `unify-selection-dictionary-lookup` (active): #6 supersedes its English-only presentation only after extending the shared Peek; preserve its selection, failure, no-card, and Queue-safety contracts.
- `improve-reader-tts` and `harden-tts-caching-resume-discoverability-highlighting` (active): #5/#6/#8/#13/#14/#19/#20 consume their anchor/timing/cache behavior; do not fork TTS timing or replace native audio preference.
- `add-audio-editions-and-hands-free-study-mode`, `audiobook-epub-sync`, `auto-transcribe-media-documents`, `add-local-transcription`, `podcast-whisper-transcription`: #13/#14/#19/#20 reuse their media, transcription, position, and provenance contracts.
- `youtube-transcript-playback-sync`, `update-scroll-mode-queue-youtube`, `fix-youtube-mobile-transcript`, and archived `archive/2026-07-21-fix-youtube-transcript-karaoke-sync`: #14 extends their transcript/playback behavior; coordinate shared viewer/timing files.
- `implement-plethora-teach-me-adaptive-ai-tutoring` and `add-ondevice-ai-learning-system`: #17/#18/#22 extend their provider/context/session/fallback patterns; #17 adds language context rather than a second tutor runtime.
- `add-next-gen-srs-platform`, existing Flashcard Studio/session/mobile/extract specs, and algorithm changes: #11/#15 use existing item/draft/scheduler contracts and must not introduce a language scheduler.
- `implement-plethora-knowledge-health-and-advanced-learning-analytics`: #9 adds language dimensions to the analytics architecture rather than duplicating its dashboards/aggregates.
- `recommendation-engine`: #23 adds profile/coverage ranking and explanations to the recommendation architecture; it does not create a competing feed.
- `complete-app-internationalization`: #1/#6/#7/#16 keep application locale separate from target language and add localized labels through the existing i18n system.
- `add-collections`, `add-user-profile-and-auth`, and account/sync/export changes: #1/#3/#4/#9 scope profile data correctly without assuming collections and language profiles are the same entity.
- `readable-document-highlights`, `overhaul-reader-selection-ux`, PDF selection fixes, and e-ink/mobile changes: #5/#6/#8/#16/#15 extend the shared reader/selection/presentation layers and must preserve their regressions.

Archived work is reference, not an implementation dependency: notably the 2026-08-19 Pocket TTS cache/position/word-highlighting work, 2026-07-31 Flashcard Studio sessions/mobile work, 2026-05-08 podcast position persistence, and 2026-07-21 YouTube karaoke sync. Their durable contracts should be reused where present.

## 9. Internal sub-capabilities that remain within one requested proposal

- #1 Profiles: profile CRUD/settings, association resolution, detection suggestion, migration/sync, deletion.
- #2 Processing: capability registry, baseline/fallback adapter, background jobs/cache, version invalidation, Unicode offsets.
- #3 Lexicon: identity/analysis, occurrence ingestion, lookup migration, source recovery, paging/retention/sync.
- #5 Highlighting: annotation contract, per-reader adapters, style/accessibility, visible-range performance.
- #6 Peek: profile resolution, dictionary/morphology composition, state actions, sentence/audio replay, phrase actions.
- #7 Translation: provider ladder, cache/provenance, display modes, reader/transcript integration.
- #9 Analytics: metric catalog, event ingestion, aggregates/backfill, dashboard/export/privacy.
- #10 Coverage: token/phrase accounting, incremental invalidation, bands, document metadata, Queue signal.
- #13 Alignment: ingestion adapters, normalized model, resolver/confidence, stale detection, media reference/clip policy.
- #14 Video: sync controller, subtitle/translation layers, language annotations, controls/mining, responsive degradation.
- #17 Tutor: learner-context retrieval, modes, lexical targeting, corrections, source grounding, session/provider/privacy.
- #19–#22 Practice: shared attempt/recording contract, comparison, capability ladder, feedback/evidence, retention/accessibility.
- #23 Recommendations: source discovery, candidate lifecycle, text retrieval, coverage analysis, ranking explanations, import/Queue.

## 10. Recommended order for implementation agents

1. Freeze #1/#2 shared language tags and adapter contracts.
2. Implement #3 and migrate lookup history; review indexes with the database owner.
3. Implement #4 and approve state/SRS separation.
4. Parallelize #5/#7/#9/#10; implement #6 with the owner of `unify-selection-dictionary-lookup`.
5. Implement #8 after sentence/translation/reader-anchor contracts are verified.
6. Freeze the shared contracts listed above and parallelize #11/#12/#13/#16/#17 with isolated ownership.
7. Implement #14 and #15 after alignment and Flashcard Studio draft contracts are integrated.
8. Implement #18 and #23 after measured coverage/learner-context/import APIs exist.
9. Implement #19/#20 in parallel, then #21; implement #22 with the tutor/evidence owner.
10. Run cross-feature story tests A–H, reader regressions, migration tests, privacy/offline tests, and performance gates before archiving any change.
