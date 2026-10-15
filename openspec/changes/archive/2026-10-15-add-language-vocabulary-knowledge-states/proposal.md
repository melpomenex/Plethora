## Why

Plethora currently has SRS states for learning items and a lookup counter, but no profile-scoped language lifecycle. Natural exposure must be cheap and distinct from deliberate memorization; otherwise every unknown token would pollute the review queue and collapse “encountered” into “known.”

## What Changes

- Add explicit language knowledge states equivalent to New, Encountered, Learning, Familiar, Known, and Ignored.
- Keep deliberate Memorize/SRS association separate from natural knowledge state.
- Add safe automatic encounter transitions, manual overrides, undo/history, keyboard/touch actions, batch operations, and import/export.
- Add evidence and transition rules for passive recognition versus active production.
- Expose state to highlighting, coverage, analytics, Dictionary Peek, and SRS suggestions without auto-creating cards.

## Dependencies

- Hard: `add-language-learning-profiles`, `add-language-processing-adapter-layer`, `add-language-lexicon-and-occurrence-model`.
- Soft: `unify-selection-dictionary-lookup`, existing learning-item/review specs, future shadowing/dictation/writing.
- Extends the lexical model; it does not replace `learning_items.state` or any scheduler.

## Capabilities

### New Capabilities

- `language-vocabulary-knowledge-states`: State model, transitions, overrides, undo, evidence, batch operations, and SRS separation.

### Modified Capabilities

- None; generic SRS item states remain unchanged.

## Impact

- Profile-scoped state/evidence tables and APIs, lexical entry projections, state controls in readers/Peek, import/export, analytics, and tests.
- Reader renderers consume state summaries; they do not own transitions.
