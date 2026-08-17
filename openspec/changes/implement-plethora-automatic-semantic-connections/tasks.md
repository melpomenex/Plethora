# Implementation Tasks

## 1. Engine
- [ ] 1.1 `src-tauri/src/connections/`: trigger scheduler (dwell/highlight/idle), retrieval-based + model-based discovery, evidence assembly
- [ ] 1.2 `connection-analysis` task definition (structured output: relation, confidence, evidence quotes)
- [ ] 1.3 Ranking (similarity × confidence × novelty × diversity) + caps + fingerprint dedup unit tests
- [ ] 1.4 Suggestion lifecycle commands + `connectionsStore.ts` + events

## 2. UX
- [ ] 2.1 Reader margin affordance (bird-marked, count badge, collapsed default; e-ink variant; shortcut + palette entry)
- [ ] 2.2 Connections inbox (accept/dismiss/snooze/history) + dashboard surface
- [ ] 2.3 Interruption policy integration (review/focus/vim suppression) + tests
- [ ] 2.4 Statement templates rendering structured evidence with `CitationChips`

## 3. Integration
- [ ] 3.1 Un-stub `propose_link` agent tool; route accept through `commands/concept_links.rs`
- [ ] 3.2 Cloud job kind for model-based discovery (capability + quota + privacy flag enforcement)
- [ ] 3.3 `connection-suggested`/`connection-accepted` events documented for 9/10

## 4. Validation
- [ ] 4.1 Fixture-library E2E (cap, dedup, citations resolve, accept persists)
- [ ] 4.2 Performance: reading-path zero-sync-work assertion; bench if measurable (baseline per protocol)
- [ ] 4.3 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)
