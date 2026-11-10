## Why

Transparent exam grades still do not explain which concepts need attention, how much independent evidence supports that conclusion, or what to study next. Plethora has orphaned knowledge-gap localStorage types but no production detection or durable evidence system. The program needs honest demonstrated-performance evidence rather than equating reading/coverage with mastery or inventing a precise score.

## What Changes

- Persist source-linked learning evidence from final deterministic, accepted AI and manual grades; preserve response/concept/misconception/repetition/hint/recency provenance and adjust rather than duplicate evidence when a grade is superseded.
- Implement deterministic `evidence-v1` grouping, disclosed recency/repetition/hint/AI weights and conservative evidence states with explicit uncertainty reasons. Report “weighted observed performance”, not a probability or percent mastery.
- Separate content coverage, study activity, review history and demonstrated assessment evidence in Study Plan and results projections.
- Add explainable, disputable knowledge-gap rules for repeated failure, prerequisites, transfer, coverage/material absence, reading-only history and graph disconnection; run analysis after settlement or explicit local refresh without interrupting reading/review.
- Add persistent remediation recommendations/dispositions, source-linked weak-topic view, same-paper and historical attempt comparisons, and legacy knowledge-gap localStorage reconciliation.
- Preserve Queue/FSRS authority: no score/confidence/coverage/gap calculation writes ratings, schedule, dues, priority, order or cards. Optional tutor/targeted-practice/card launch completion occurs in Change 7.

## Capabilities

### New Capabilities

None. This implements and corrects the existing gap/mastery capability and adds plan-evidence projection to the existing curriculum owner.

### Modified Capabilities

- `knowledge-gap-detection`: Specify persisted evidence sources, deterministic uncertainty/evidence states, incremental settlement/local refresh, suppression/re-emergence, safe historical comparison and no automatic scheduling effect.
- `adaptive-learning-paths`: Add three-way node coverage/activity/demonstrated-evidence projections and source-linked gap/history visibility without composite mastery progress.

## Impact

- **Frontend:** new evidence/gap pure policies, API/adapters/store reconciliation and results/Study Plan evidence/remediation/history components.
- **Native:** additive evidence/summary/gap/recommendation migration, repositories/read-only review-history joins and commands; extends C4/C5 grade settlement/deletion paths transactionally.
- **Privacy/provider:** all evidence/gap math is local and works offline; no required model call or generic background watcher. Existing source/coverage/provider modules remain unchanged.
- **Compatibility:** legacy gap claims are imported as unverified history, not mastery measures; full native DB backup includes all data, while JSON export/two-way sync remain explicitly out of scope.
