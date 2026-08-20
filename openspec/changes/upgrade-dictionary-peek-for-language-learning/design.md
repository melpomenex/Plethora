## Context

The current shared Peek renders provider definition/phonetic data, optional AI passage explanation, TTS pronunciation, Extract, and direct flashcard creation. The lexical model and profile/processing contracts supply the missing language data. Existing English lookup must remain useful when no profile is active.

## Dependencies

- Hard: #1–#4.
- Direct coordination: active `unify-selection-dictionary-lookup`; its shared selection/Peek lifecycle is the base to extend.
- Soft: #7 translation, #12 phrases, #13 alignment, and #11 SRS. Do not edit selection/Peek files concurrently without an owner.

## Goals / Non-Goals

**Goals:**

- Resolve selected surface forms to profile-aware lexical entries and phrases.
- Make explicit vocabulary state/memorization actions easy without conflating them.
- Prefer source sentence/audio and use TTS only as fallback.

**Non-Goals:**

- Replacing the dictionary provider with an LLM or creating a parallel popover.
- Automatically adding every lookup to SRS.

## Decisions

1. **Profile-aware target model.** Add `profileId`, resolved analysis, source sentence/anchor, and phrase intent to `DictionaryPeekTarget`; retain existing text-only target for off-profile use.
2. **Capability sections.** Render only data supported by the processor/provider: no bogus lemma, morphology, translation, or transliteration placeholders. A standard dictionary definition remains the baseline.
3. **Explicit action routing.** State changes call the language-state API; Memorize routes to the future shared SRS draft contract; Extract uses existing provenance; sentence replay calls original-audio alignment when available, then TTS.
4. **Bounded context and cache.** Cache dictionary/translation/analysis by profile/language/text/context fingerprint and provider version. Do not send full documents to AI explanation.
5. **One selection lifecycle.** The existing selection machine owns dismissal and the Peek remains queue-safe/selection-preserving; hosts do not implement local variants.

## Risks / Trade-offs

- [Provider has only English data] → Keep target/base-language labels explicit and show unavailable sections rather than translating silently.
- [Phrase selection overlaps tokens] → Use selection intent/phrase object resolution and preserve exact selected text.
- [Peek becomes too tall on mobile/e-ink] → Progressive disclosure, bounded scroll, compact action rows, and no translucent heavy effects.
- [Direct old flashcard path conflicts with intentional SRS] → Keep existing off-profile action behavior where required, but profile Memorize uses the shared explicit-draft route and never auto-escalates.

## Migration Plan

1. Add optional profile-aware target fields and render the existing Peek unchanged when absent.
2. Route successful profile lookups to the lexicon and expose state actions.
3. Add translation/audio/phrase/SRS actions behind capability checks, then remove duplicated local language actions if any.

## Open Questions

- Which dictionary providers offer bilingual definitions and morphology by language.
- Whether sentence translation should be fetched by Peek or reuse the sentence-translation cache.
- The exact boundary between Memorize and the dedicated sentence-mining draft.
