# Implementation Tasks

## 1. Pipeline core
- [x] 1.1 `src/lib/ai/cards/`: CardProposal schema, form-aware generator tasks (6+ forms), source-quote validation
- [x] 1.2 Extend `cardValidator.ts` heuristic set + annotation model + unit fixtures per failure mode
- [x] 1.3 `cards_check_duplicates` command (embedding + lexical + source-hash) with threshold fixtures; merge/skip flow data
- [x] 1.4 Preference store (bounded, local, inspectable, resettable) + prompt-parameter wiring

## 2. Studio & preview UX
- [x] 2.1 Bulk pending preview (paginate, per-card accept/reject/edit/override, session summary counts)
- [x] 2.2 Entry API `generateCards(request)` + integration: selection, document/chapter (passage_scores-driven), concept (9), gap (10), lesson (12), path (11), figure/occlusion upgrade
- [x] 2.3 Duplicate side-by-side comparison UI (keep both/merge/skip)

## 3. Provenance & hosted tier
- [x] 3.1 source_ref + provenance on all acceptance paths (invariant test across entry points)
- [x] 3.2 Hosted generation job kind (capability, cards/month quota, disclosure, exclusion enforcement)

## 4. Validation
- [x] 4.1 Golden-form fixtures, duplicate-matrix tests, preference-drift bounds tests
- [x] 4.2 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)

