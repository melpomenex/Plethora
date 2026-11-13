# Study Plans 2.0: Adaptive Learning Studio

Status: Proposed contract amendment and implementation index. The C1–C8 baseline still applies to existing paths. This document records the planned extensions from the November 12, 2026 PRD; it is not implementation or native acceptance evidence.

## Delivery order

| Change | Depends on | PRD acceptance |
| --- | --- | --- |
| [Knowledge Policies & Provenance](../../changes/add-study-plan-knowledge-policies/proposal.md) | Existing C1–C8 contracts | SP-01–06, SP-09–10, SP-16 |
| [Adaptive Lesson Sessions](../../changes/add-adaptive-study-lesson-sessions/proposal.md) | Knowledge Policies | SP-07–12, SP-17 |
| [Plan Home & Practice Integration](../../changes/integrate-study-plan-home-and-practice/proposal.md) | Knowledge Policies and Lesson Sessions | SP-07, SP-09, SP-12–15, SP-17 |
| [Learning Motivation & Calendar](../../changes/add-study-plan-motivation-and-calendar/proposal.md) | Plan Home | SP-18–19 |
| [Web Research](../../changes/add-study-plan-web-research/proposal.md) | Knowledge Policies | SP-20 |

The first three changes form the core learner journey. Motivation and Web Research are optional increments; Web Research can be implemented independently after the policy foundation. OpenSpec artifact readiness is separate from implementation dependencies.

## Proposed amendments to the shared contracts

These amendments apply only as the corresponding changes land. Keep [the baseline contracts](02-SHARED-CONTRACTS.md) readable for existing plans, jobs, assessment revisions and attempts.

| Baseline area | 2.0 invariant | Owner |
| --- | --- | --- |
| §2.1 scope and §3.2 plan transitions | Library modes require nonempty frozen scope. Model-only and source-free manual authoring have explicit no-library variants; they are never empty library filters. Authority changes only in a reviewed version. Retain existing explicit policies and interpret untagged legacy source-backed curriculum as source-only. | Knowledge Policies |
| §§2.2, 3.3, 10 generation and references | Source-backed requests use only eligible frozen revisions. Model-only branches before retrieval, never calls library or embeddings, and uses bounded structured proposals. Keep existing job checkpoints and version conflict checks. Claims distinguish verified library support, model supplement, unverified model output and user authorship. A verified claim needs a current exact locator **and** passage support. | Knowledge Policies |
| §§4–8 assessment and evidence | Store assessment trust independently from plan policy, delivery mode and structural validity. Unverified practice/self-check never writes demonstrated evidence. Verified exams require independent support for question/key/rubric; promotion requires a new committed revision. Old grades, attempt provenance and question revisions are immutable. | Knowledge Policies; Web Research adds external authority |
| §§8–9 diagnostics and lessons | Source-backed lessons pin plan, node, objective and scope; missing eligible refs block scoped AI. Model-only lessons use a separate no-retrieval launch path. Persist learner and turn state, validate the route on resume, and never turn dialogue into final evidence. Only eligible finalized diagnostic results can propose a reviewed diff. | Lesson Sessions |
| §§8–9 recommendations and review | Recommendations are advisory, explainable and version-aware. Coverage, activity and demonstrated evidence stay separate. Only accepted card proposals create ordinary learning items; only normal review actions submit scheduler ratings. | Plan Home & Practice |
| §13 trust boundaries | Model, embedding and research destinations are separate decisions. Research is explicitly authorized with a reviewed bounded query; accepted external snapshots do not imply verified claims or new exam eligibility. | Knowledge Policies; Web Research |

Archive overlapping C1–C8 deltas before their 2.0 successors. Specifically reconcile C2 curriculum pipeline requirements and C7 scoped tutor/diagnostic requirements against the merged baseline: their nonempty source guardrails continue for library-backed work; model-only uses distinct entry points. Preserve the C7 remediation requirements when merging Plan Home. The assessment-blueprints capability currently lives in an unarchived C3 delta; do not pretend it is already an archived capability. Review its complete requirements when incorporating the new trust and external-evidence rules, preserving the source-backed exam path.

## Release verification

| PRD matrix cases | Evidence to collect during implementation |
| --- | --- |
| 1–7, 13, 15 | Three authority modes, exact PDF/video locators, unsupported or forged content, offline manual/outline, partial/stale indexes, provider/embedding disclosure, actual usage, and denial before restricted data is prepared or sent. |
| 8–10 | Diagnostic take/skip/cancel/resume and reviewed results; tutor hints and direct explanation; native restart, duplicate turn/job handling and stale head recovery. |
| 11–12, 16 | Final evidence to lesson to fresh reassessment; card proposal and explicit acceptance with no rating or legacy scheduling mutation; version history, Queue, Review, FSRS, Ask Library and reader regressions. |
| 14 | Native Linux, Windows, macOS, Android and iOS where available; report verified platforms and blockers separately. Exercise keyboard, touch, screen readers, reduced motion, portrait/landscape and narrow layouts. |

Start by reproducing the existing native workflows referenced by the PRD. Record test commands and observed outcomes alongside each change. For evaluation after rollout, establish a delayed independent transfer baseline before setting targets; track opt-in engagement and usage separately from learning outcomes.
