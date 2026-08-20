## 0. Dependency gates

Requires #1–#3. Coordinate the state/evidence and memorization-link contracts with the SRS owner before #11; readers, coverage, analytics, and Peek must consume the state resolver rather than duplicate transitions.

## 1. State and evidence model

- [ ] 1.1 Define canonical state enum, transition policy, manual override, evidence dimensions, confidence, actor, and history types.
- [ ] 1.2 Add SQLite migrations/indexes for state, overrides, evidence aggregates/events, undo metadata, and SRS links.
- [ ] 1.3 Implement repository methods for single/batch state changes, inheritance resolution, history, and undo transactions.

## 2. Integration

- [ ] 2.1 Add profile-scoped TypeScript APIs/store selectors with bounded reactive summaries.
- [ ] 2.2 Migrate legacy lookup history as evidence without inferring Known or creating cards.
- [ ] 2.3 Add state actions to shared Dictionary Peek/selection pathways and expose the contract to highlighting, coverage, analytics, and SRS.
- [ ] 2.4 Add known-word import/export preview and duplicate resolution.

## 3. UX and accessibility

- [ ] 3.1 Build state selector with New/Learning/Familiar/Known/Ignored semantics and clear memorization separation.
- [ ] 3.2 Add keyboard shortcuts, touch/mobile affordances, undo, screen-reader labels, reduced-motion, and e-ink variants.
- [ ] 3.3 Add non-blocking suggestions with dismiss/accept controls and current-load safeguards.

## 4. Verification

- [ ] 4.1 Unit-test transition rules, exact/lemma precedence, profile isolation, evidence, undo, batch, and import/export.
- [ ] 4.2 Integration-test Dictionary Peek/reader/Queue invariants and no-card-on-encounter behavior.
