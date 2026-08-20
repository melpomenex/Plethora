## Context

`DictionaryPeek` can currently call `createLearningItem` directly with a simple definition card. Flashcard Studio and existing learning-item interactions can support richer drafts, while review scheduling is already algorithm-selectable. Language SRS must be a client of those systems.

## Dependencies

- Hard: #1, #3, #4, and existing Flashcard Studio/learning-item/review contracts.
- Soft: #7, #12, #13, #15, #19, and #20.
- Coordinate the memorization-link/draft metadata with #4 before editing Flashcard Studio or Dictionary Peek; no second scheduler may be introduced.

## Goals / Non-Goals

**Goals:**

- Make memorization deliberate, rich, source-linked, and reversible before acceptance.
- Preserve one scheduler and existing card/review lifecycle.
- Feed review performance into language evidence without replacing state.

**Non-Goals:**

- Auto-card every encountered/unknown word.
- A language-only deck/scheduler or mandatory AI-generated content.

## Decisions

1. **Draft-first escalation.** `createLanguageLearningDraft` returns a Flashcard Studio draft/seed, not a final learning item, unless the existing one-tap flow explicitly opts into immediate creation. Profile Language Peek defaults to review/accept for rich language cards.
2. **Canonical language item metadata.** Store lexical/phrase ID, profile ID, card format, source sentence/anchor, translation/definition, analysis, audio reference, and provenance in existing `interaction_metadata`/schema extension with typed versioning.
3. **Scheduler reuse.** Accepted cards are ordinary `learning_items` and use the selected existing algorithm. No duplicate intervals, ratings, or review queues.
4. **Suggestion score is bounded and explainable.** Use lookup/encounter frequency, repeated failures, importance/frequency, current load, and dismissals; cap suggestions and allow snooze/ignore.
5. **Media by reference.** Prefer original aligned audio and source frame/clip references; TTS is fallback and large blobs use existing media/cache systems.

## Risks / Trade-offs

- [Rich draft can be overfilled] → Editable sections with provider provenance and optional fields; show a concise default.
- [Suggestions feel spammy] → Cooldowns, load caps, explicit dismissals, and no automatic card creation.
- [Existing one-tap behavior changes] → Preserve off-profile behavior and provide a migration flag/clear confirmation for profile mode.
- [Review evidence merges incorrectly] → Link by stable language object ID and retain normal card IDs/scheduler data.

## Migration Plan

1. Add language draft/metadata contract and keep existing generic card creation.
2. Route profile Memorize through Flashcard Studio seed/draft.
3. Migrate future cards only; do not reinterpret old generic cards without an explicit user action.

## Open Questions

- Whether sentence cards should be a new `item_type` or use existing cloze/basic types with metadata.
- Default recognition/production mix by proficiency.
- Whether suggestions belong in Peek, dashboard, or a low-volume inbox.
