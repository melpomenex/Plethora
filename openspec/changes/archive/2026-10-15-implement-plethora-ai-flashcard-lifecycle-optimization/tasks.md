# Implementation Tasks

## 1. Data & detectors
- [x] 1.1 Migrations: `card_maintenance_proposals`, `card_versions` lineage (next free numbers; re-anchor rule)
- [x] 1.2 `src-tauri/src/card_maintenance/`: six detectors with seeded fixtures + healthy-deck false-positive suite
- [x] 1.3 Incremental analysis scheduler (idle/battery gates, bounded per run)

## 2. Proposals
- [x] 2.1 Proposal engine (kinds, evidence, confidence, drafts via 13's generator tasks with form constraints)
- [x] 2.2 Apply flows: rewrite/split via version lineage; merge union; reversible retire; clarify
- [x] 2.3 Dismiss fingerprints + snooze; safety invariants tests (no silent writes; retire/merge never auto-apply)

## 3. UX
- [x] 3.1 Deck health section (per deck + global) with grouped findings and severity
- [x] 3.2 Proposal review: diff previews, group visualization, evidence inspector, batch same-fact review; e-ink variant
- [x] 3.3 Post-session single summary line + interruption guards; i18n 6 locales

## 4. Hosted tier & validation
- [x] 4.1 Cloud draft job kind (`card_optimizer`, quota, disclosure, exclusion)
- [x] 4.2 Full gates; lineage/query contract tests for 15

