## 0. Dependency gates

Requires #1–#4 and coordination with `unify-selection-dictionary-lookup`. Freeze profile-aware Peek target, state action, cache, and original-audio resolver contracts before #5, #7, #11, #12, or #15 add callers.

## 1. Target and service integration

- [x] 1.1 Extend shared selection/Peek target types with profile, analysis, phrase, sentence, and source-anchor context. `DictionaryPeekTarget` carries `profileId`, `analysis: PeekDisplayAnalysisContext` (lemma/POS/morphology/senses), `phrase?: PeekPhraseContext`, `sentence?: PeekSentenceContext`, `sourceAnchor`, and `selectionContext` (see `src/components/viewer/selectionInteraction/DictionaryPeek.tsx`).
- [x] 1.2 Add profile-aware dictionary/analysis/translation lookup composition with cache keys, typed failures, and provider provenance. `LanguagePeekService` (`src/lib/languagePeek/service.ts`) builds cache identity from profile/analysis/phrase/provider versions, dedupes in-flight requests, supports cancel, and returns typed failures (`not-found`/`unavailable`/`offline-uncached`); providers carry provenance and are ordered (`offlinePackDictionaryProvider`, `jishoDictionaryProvider`, `wiktionaryMultilingualProvider`, `aiDictionaryFallbackProvider`).
- [x] 1.3 Route lookup/interaction events to the durable lexicon without inflating counts on cache re-renders. `useDictionaryEntry` records via `recordLanguageLookup` once per actual fetch; cached re-views and ephemeral hits do not re-record (`src/hooks/useDictionaryEntry.ts`, `vocabularyHistoryStore.test.ts`).

## 2. UI and actions

- [x] 2.1 Add progressive Language Peek sections for surface/lemma/POS/morphology/meaning/context. The language-context section renders the surface word, lemma, POS, morphology (reading/transliteration), phrase meaning/translation, and page context (`language-peek-context` block in `DictionaryPeek.tsx`).
- [x] 2.2 Add state selector, explicit Memorize, Extract, examples, morphology, phrase, replay, and More actions. `LanguageKnowledgeStateSelector` is always rendered; Memorize dispatches an SRS draft via `memorizeLanguageDraft`; Extract flows through `createInstantExtract`/`onCreateExtract`; original replay via `onReplayOriginalAudio`; More via `onMore`; practice entry via `onPractice`.
- [x] 2.3 Implement original-audio-first replay with TTS fallback and preserve existing off-profile dictionary behavior. `handlePronounce` prefers the host's original-audio resolver and falls back to TTS; the no-profile English path is unchanged and covered by `useDictionaryEntry.test.tsx`.
- [x] 2.4 Add i18n, mobile, e-ink, reduced-motion, keyboard, and screen-reader states. Presentation hooks (`usePresentation`/`useIsEink`/reduced-motion/compact) drive responsive + e-ink states; RTL direction is set from the language tag; keyboard/screen-reader names are asserted in `src/components/language/__tests__/accessibility.test.tsx`; i18n parity enforced across all six locales by `i18n-completeness.test.ts`.

## 3. Verification and migration

- [x] 3.1 Test English/no-profile regression, Spanish inflections, unsupported languages, phrase selections, offline/cache/provider failures. `service.test.ts` covers cache identity, in-flight dedup/cancel, provider fallback ordering, offline-pack-unavailable (never fabricates entries), and wiktionary/jisho/AI providers; `DictionaryPeek.language.test.tsx` covers multilingual target/RTL, offline state upsert, and mining-draft dispatch; multilingual inflections (Spanish etc.) are covered by `multilingualAdapters.test.ts`.
- [x] 3.2 Test EPUB/PDF/HTML/Markdown/Queue selection anchors and Queue/review/position invariants. `surfaceIntegration.test.tsx` covers EPUB iframe, HTML article, and reflow-PDF surfaces; the selection-action anchor/adapters suites plus the `complete-language-learning-integrations` suites cover Queue/review invariants.
- [x] 3.3 Coordinate/archive overlap with `unify-selection-dictionary-lookup` before deleting or rewiring any existing local implementation. That change was archived 2026-10-15; this upgrade built on its contracts (peek target, cache, vocabulary history) without rewiring the legacy inline dictionary card in `DocumentViewer.tsx`, which remains untouched pending the multilingual `#6` extension.
