## 0. Dependency gates

Requires #1–#4. Freeze phrase identity, overlap, candidate acceptance, and state/SRS-link contracts before #5/#6/#10/#11 integrate phrase rendering or learning.

## 1. Phrase model

- [ ] 1.1 Define phrase identity/type/normalization, constituent links, occurrence span, confidence/evidence, state, and SRS link types.
- [ ] 1.2 Add SQLite phrase/object/occurrence/candidate tables and overlap-aware indexes.
- [ ] 1.3 Add repository/API methods for save/merge/split, examples, state, occurrences, and candidate accept/dismiss.

## 2. Processing and UI

- [ ] 2.1 Add phrase candidate provider contract and background/paged pipeline with privacy controls.
- [ ] 2.2 Extend selection intent and Language Peek for phrase actions and exact source anchors.
- [ ] 2.3 Add phrase highlighting/overlap policy, examples, replay, navigation, and profile settings.

## 3. Learning integration and verification

- [ ] 3.1 Route explicit phrase Memorize to shared Flashcard Studio/SRS draft integration.
- [ ] 3.2 Integrate phrase coverage/analytics without double counting.
- [ ] 3.3 Test idioms, nested overlaps, candidate rejection, offline/provider failure, mobile/e-ink/accessibility, and large-library paging.
