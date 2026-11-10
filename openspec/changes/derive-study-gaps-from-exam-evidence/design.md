## Context

C4/C5 provide final deterministic/AI/manual grade history over immutable responses; C1/C2 provide plans/evidence refs. Existing knowledge-gap types/store have no production producers and localStorage is noncanonical. Coverage intentionally never models mastery; no calibrated psychometric dataset exists. A deterministic, sparse-evidence-honest implementation is safer than blending unrelated signals into a fake probability.

Normative references: program `02-SHARED-CONTRACTS.md` §§8–13; data plan §7; ADR-16/17/20/21.

## Goals / Non-Goals

**Goals:**

- Durable unique final-grade evidence and correction/deletion/reconciliation semantics.
- Deterministic conservative evidence summaries/gap rules with explicit uncertainty and suppression.
- Three-axis Study Plan progress, historical result comparison and actionable source-linked suggestion records.
- Entirely local ordinary operation and FSRS/Queue isolation.

**Non-Goals:**

- Scientific mastery probability/calibrated variance, knowledge tracing or adaptive psychometrics.
- Treating coverage/reading/FSRS retrievability/model confidence as demonstrated understanding.
- Continuous background inference/idle watcher or automatic tutor/card/Queue/plan changes.
- C7's actual scoped tutor launch/hints/diagnostic adapter/card proposal UI.

## Decisions

### Evidence settlement and reconciliation

Add C6 tables via a fresh migration. In C4/C5 native final-grade/current-grade transaction, call the new evidence repository adapter before commit:

1. Resolve the question revision's target concepts (ordered, bounded); skip needs-review/failed/superseded noncurrent AI rows.
2. Upsert by `(sourceKind,responseSubmissionId,conceptId)`, using sourceKind exam/diagnostic/practice and id response submission. For C4 objective final grade or C5 final AI/manual this assigns gradeId/current score/outcome/hints/provenance.
3. Superseding writes same evidence key and new grade id/outcome. Not-current AI results never create evidence. No automatic AI regrade may supersede Manual (C5).
4. Fold only affected concepts under evidence-v1; upsert summary/gaps/remediation in same transaction. All failures roll back final-grade transition to avoid inconsistent totals/evidence.
5. On C4 permanent attempt deletion, remove dependent evidence/gap links, then recompute affected summaries/other gaps before returning.

For history created before C6, `reconcile_learning_evidence(afterGradeId,100)` scans current final objective/AI/manual grades ordered `(created_at,id)`, upserts unique evidence and recomputes affected concepts; response `nextAfterGradeId` supports restartable explicit local calls. Beginning again is safe. No inference or scheduler mutation occurs. Repair of an earlier change's pre-C6 unobserved history happens automatically on Study Plans open via bounded local batches without showing learning-gap interruptions elsewhere.

### Pure evidence-v1 fold

Implement shared §8.1 literally. Group by concept/group/UTC date; assessment inputs only. Base weights: exam/diagnostic1, unhinted practice.75, hinted practice.5; grader AI multiplier.75 vs deterministic/manual1; recency half-life 90 days; repeated fingerprint subsequent groups.25. Scores come from current final points/maxPoints; no model score/confidence or coverage. EvidenceWeight is policy mass, not effective sample count. `independentSessions` counts distinct attempt/session ids even if same-paper; fingerprint penalty explicitly handles repetition. Use injected `now` for deterministic tests. Skip tests/diagnostics with all-blank aggregate evidence before level advancement; individual blank exam answers remain inspectable zero outcomes.

Classification ordered rules and all uncertainty codes are in shared contracts. Latest misconception is unresolved until a later independent group's mean≥0.8 without a new misconception; manual resolution action may add user annotation but never deletes it. `demonstrated-consistently` also requires deterministic/manual evidence so entirely self-reported AI evaluation does not alone yield that label. Conservative rule order `insufficient` first (except later repeated-failure gaps can still exist? Shared says insufficient before other evidence states but gaps independent), then Needs Attention/Consistent else Developing. Gap rules can fire using review lapses independently.

Review result read-only imports use `review_results.id` text, Again/user rating=1 as review-lapse only. Link cards to concepts only through confirmed concept_links with `source_kind='card'` and exact item id. Do not map ratings to numeric mastery points. Two distinct review sessions for same linked concept may satisfy the separate `review-lapse-v1` Repeated Failure gap rule. `submit_review` remains untouched.

### Gap rule execution and user suppression

- `assessment-repeated-failure-v1`: latest two independent assessment groups <.6.
- `review-lapse-v1`: ≥2 Again/lapse events on separate sessions for a confirmed linked concept; evidence stays activity/performance-adjacent and separate from observedMean.
- `weak-prerequisite-v1:<dependentNodeId>`: active dependent Needs Attention and prerequisite Needs Attention or insufficient; insufficient is phrased “needs evidence/check prerequisite” not diagnosed as known deficit. Resolve when the relation is removed/archived, dependent no longer Needs Attention, or prerequisite has later independent group≥.8/no unresolved misconception. Each dependent has a distinct rule identity; restoring a relation re-evaluates current evidence and dismissed rules still obey evidence cutoff.
- `missing-material-v1`: plan unsupported material/coverage-v1 not-covered under complete current query; never inferred from wrong answer alone.
- `weak-transfer-v1`: recall/comprehension mean≥.75 across≥2 groups AND application/multi-step mean<.6 across≥2 groups; otherwise no claim.
- `read-never-reviewed-v1`: existing canonical full-read 30+ days with no extract/card/review via read-only explicit scan.
- `disconnected-cluster-v1`: a component of confirmed graph concepts has meaningful plan/exam relevance but no confirmed link to other included components; label structural/material issue, not learner deficit.

Gap identity `(conceptId,kind,ruleId)` and suppression cutoff survive restart. Material new evidence must have occurredAt/sourceId after cutoff; dismissed rows suppressed. Different rule may produce its own explainable row. Later success resolves assessment repeated failure after latest two independent groups≥.8 and no unresolved misconception. Resolution retains history rather than deletes.

### Projection and UI

`NodeLearningProgress` displays `Content coverage` (coverage-v1), `Study activity` (C1) and `Demonstrated evidence` (C6) side by side, never a composite. Media sources show Current/Stale/Missing. Gap view lists exact rule/evidence IDs, observed outcomes, dates, hints, origin, independent-group counts and uncertainty. Model confidence and legacy mastery fields never appear as mastery.

Results history compares only Final official totals. Same revision delta has retake/memory label; cross-paper lists facts only. Recommendations are records with payload/disposition/source ids. C6 wires Open Source, targeted-practice/follow-up Builder (C3/C4) and Plan Adjustment draft; C7 will wire actual scoped tutor/hints/optional card proposals. Until C7, no fake Tutor/Card buttons appear as if already implemented. Existing canonical remediation action requirement is completed in C7.

### Legacy gap store

Replace `knowledgeGapsStore` authority with a non-persistent API projection. Import old rows as rule `legacy-localstorage-v1` with evidence descriptions/statuses and `legacy_import_key`; store old masteryEstimate/variance only in import provenance, never current summary. After accepted commit rename old key to backup and stop old persist behavior. Unresolved items remain visible as unverified historical drafts/dismissed entries rather than current measured gaps.

## Risks / Trade-offs

- **Weights are policy choices, not calibrated science** → explicitly label, version and test them; avoid probability/variance wording and supply evidence details.
- **Sparse AI evidence** → lower AI policy weight/uncertainty and consistent-demonstration requires deterministic/manual; real calibration future work.
- **Evidence transaction coupling** → single adapter inside C4/C5 transaction and failure tests; batch reconciliation for pre-C6 history.
- **User deletes evidence** → recompute gaps before acknowledging; no scheduler or source/card deletion.
- **Partial older gap actions** → only show working controls; C7 supplies tutor/cards/hints/diagnostics.

## Migration Plan

After C5 gate, append C6 evidence migration then pure fold/rules, repository settlement adapters, import/read APIs and UI. Existing data is scanned with bounded idempotent reconciliation only. No old localStorage is removed before accepted import. No destructive rollback or payload rewinding; policy changes require a new policy version and explicit separate migration/reevaluation rather than changing evidence-v1 silently.
