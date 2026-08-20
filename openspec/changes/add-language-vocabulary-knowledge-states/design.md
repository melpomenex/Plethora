## Context

The current learning-item scheduler is intentional and durable, while dictionary lookup history deliberately has no learning side effect. Language knowledge needs a parallel, lightweight state machine attached to lexical entries/phrases and optionally informed by occurrences and practice evidence.

## Dependencies

- Hard: #1 profiles, #2 processing adapters, and #3 lexicon/occurrences.
- Soft: active dictionary lookup and existing learning-item/review contracts; later #11, #19, #20, and #22 add evidence.
- Freeze state names, precedence, evidence, and independent SRS-link semantics before #5, #6, #9, and #10 parallelize.

## Goals / Non-Goals

**Goals:**

- Preserve the distinction between exposure, familiarity, knowledge, and SRS.
- Make manual state changes fast and reversible across desktop/mobile/e-ink.
- Permit richer evidence later without reducing mastery to one counter.

**Non-Goals:**

- A second scheduler or automatic card flood.
- Treating lookup as proof of learning or one successful recognition as permanent knowledge.

## Decisions

1. **Finite display state plus evidence ledger.** Store a canonical state (`new`, `encountered`, `learning`, `familiar`, `known`, `ignored`) and append/aggregate evidence events with source (`encounter`, `lookup`, `recognition`, `production`, `manual`).
2. **SRS is an independent relation.** `language_memorization_links` points to a lexical/phrase object and an existing `learning_item`; creation requires explicit user action or accepted suggestion.
3. **Conservative automatic transitions.** First exposure moves `new → encountered`; repeated exposure may update evidence but does not infer `known`. Manual `Known`, `Ignored`, and `Learning` overrides are authoritative until changed.
4. **Undo is an operation, not a guessed inverse.** Record state changes with actor/time/previous state and use existing undo patterns where possible; batch actions are one undoable transaction.
5. **Surface forms inherit lemma state only through confidence-aware resolution.** Exact-form overrides take precedence, then high-confidence lemma state, then fallback exact-form state.

## Risks / Trade-offs

- [Automatic state surprises users] → Restrict automatic transitions to safe exposure bookkeeping and show transition history.
- [State changes cause massive rerenders] → Subscribe readers to versioned lexical summaries and invalidate visible spans only.
- [Ignored words hide useful forms] → Keep ignored explicit and reversible; preserve occurrences and search visibility.
- [Active/passive evidence is noisy] → Store evidence dimensions and confidence rather than a single irreversible mastery score.

## Migration Plan

1. Add state/evidence/link tables with default `new` for new lexical entries.
2. Map no historic lookup to `known`; migrate lookup counts as evidence and optionally `encountered` only when a profile is confirmed.
3. Keep existing learning-item states untouched; create links only for future explicit memorization.

## Open Questions

- Exact transition thresholds for evidence-derived Familiar/Known suggestions.
- Whether user-known-word import should create `known` overrides or a distinct imported source.
- How much state history to sync by default.
