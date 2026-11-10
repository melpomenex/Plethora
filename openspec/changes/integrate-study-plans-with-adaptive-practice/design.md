## Context

C2 intentionally supplied no diagnostic producer. C3 recognizes diagnostic mode but exposes exam/practice; C4 provides shared attempts/basic practice and C5 final grading; C6 evidence/gaps provide source-linked recommendation records. TutorSheet currently auto-starts `TutorSession` with empty runtime; retrieval defaults globally by topic and a documentId prompt note does not constrain it. Learn This already has static candidates/preview, while `AcceptLearnThisContext` exposes optional acceptance ids but the sheet needs a deliberate per-candidate remediation adapter.

Normative references: program `02-SHARED-CONTRACTS.md` §§3.3/5–10/11–13; ADR-18/19/20/21; UX specification for exact flow states.

## Goals / Non-Goals

**Goals:**

- Complete optional diagnostic→reviewable plan adaptation and weak-source→tutor/practice/cards→reassessment user paths.
- Existing TutorSession policy with hard Study retrieval scoping and bounded context; no competing tutor.
- Committed hint ladder, recorded practice assistance and deterministic between-paper difficulty adaptation.
- Idempotent optional card acceptance and follow-up retake/new-paper choices without scheduler violation.

**Non-Goals:**

- New diagnostic/question/grading/evidence engines, in-attempt adaptive item substitution or auto-skip/mastery claims.
- Durable tutor transcript/mastery analytics, global retrieval fallback for scoped Study tutor, new job types/tables or general provider picker behavior.
- Automatic card generation/acceptance, user priority or Queue feed modifications.

## Decisions

### Diagnostic flow and ownership

C7 owns the user-facing optional branch, generation settings and evidence-to-curriculum adapter. The wizard sequence after goal/scope/draft generation is: **Review provisional topics → Take Diagnostic or Skip → (optional) complete/resume/grade → Apply results to Draft → Publish**. Diagnostic blueprint references the provisional C1 plan version and exact frozen source scope. It can be completed offline after generation if deterministic/manual paths suffice. Its source-only `AssessmentConfig` has N default6/allow4–12, type kinds single/multi/cloze/short, no essay, null timer, no pre-submit hints/feedback, and exact quota/shortfall protections.

No attempt exists before explicit Start diagnostic. Cancel/not complete cannot Apply. `get_diagnostic_prior_evidence(attemptId)` is a native read-only query added to learning-evidence commands: assert `mode=diagnostic`, Complete and all official items final; assert its source snapshot document/revision set equals the target plan draft; group by linked concept using only this attempt's current Final grades; return CurriculumPriorEvidence with computed observed mean and uncertainty. C2 itself remains independent of these tables.

Application to curriculum computes preference positions shared §9.1 for unlocked nodes only; DAG dominates. One diagnostic's evidence-level remains sparse/insufficient as C6 dictates, but observed performance can guide review emphasis. Strong topics are never skipped/removed/completed. Weak nodes may receive source-bound review objectives or existing prerequisite emphasis in a model proposal only through C2 task validation; no new unsupported nodes solely because a response was wrong. Diff/head CAS/dismiss/publish uses C1/C2. Skipped diagnostic produces no adapter call.

### Scoped Tutor host

Add `studyContext?: StudyTutorContext` to `TutorSheetProps`. A new Study host resolves current source refs, performs preflight, concatenates bounded excerpts/objective/misconception/evidence summary safely and sets topic/documentTitle. `TutorSheet` passes `TutorSession.start(config,runtime,options)` with runtime retrieval closure:

`retrieveFromLibrary(query,{k,filters:{documentIds:studyContext.sourceDocumentIds}})`.

When studyContext exists, `sourceDocumentIds` must be nonempty/all currently authorized; no empty→global fallback. Existing hosts without studyContext pass `{}` as before. `TutorSession` own bounded material/retrieval and policy/hint/escape remain unchanged. Privacy errors prevent start. Tutor dialogue/self-reported understanding does not write learning evidence. Existing `promoteToCard` continues through proposal UI. Practice can open the same scoped host with gap context.

### Committed hints and adaptive Practice

C3 question common/model schema already includes 0–3 hints; C3 validators are extended to bound them, source-ground them and reject a hint equal to an accepted key/reference solution. C4 public projection stores but withholds hints in Exam/Diagnostic. C7 Practice runner shows a single “Hint 1 of N” control that reveals sequentially; hintLevel is per current response and resets only when a newPractice question revision/slot is launched, not between repeated checked rounds unless the user explicitly dismisses hints. This is ordinary session assistance, not FSRS hint behavior.

C4 `exam_response_submissions.hint_level` records the level on each Check. Check/Finish CAS includes hint level in canonical snapshot. Practice Finish reuses the latest practice-check only when response payload, mark and hintLevel are identical; otherwise appends next ordinal. This avoids double evidence when finishing an unchanged checked exercise. Practice has no timer. C6 evidence uses hint level for disclosed weighting. Tutor conversations alone do not alter it.

After Practice Finish with all current official results available, next-set advisor computes per-concept difficulty using shared formula `<.6` decrease, `>.85 and no hints` increase, otherwise same. It only creates a new Draft after user chooses Next Practice, uses current sources and excludes prior fingerprints so a fresh question is generated. Active attempts remain fixed. If evidence is AI graded, uncertainty remains and no stronger “mastery” label is added.

### Optional card proposals and idempotency

Make Cards invokes a new adapter that converts `StudySourceRef` excerpt/current selection context and gap objectives into existing `LearnThisProposalSheet` inputs. It can either use bounded existing `learn-this` generation after preflight or static validated candidates from existing tutor/exam remediation. The sheet continues to handle per-candidate edit/source/duplicate/accept.

Add optional `acceptance?: {acceptanceId:string; sourceReference?:string; sourceReferences?:AcceptLearnThisSourceRef[]}` to `LearnThisProposalSheetProps`. Set acceptanceId to remediation id. Extend `AcceptLearnThisContext` minimally with optional `perCandidateProposalIds: Record<string,string>`; keys are the existing stable candidateSignature/fingerprint calculated locally, with collision error rather than index-only ids. `acceptLearnThisCandidates` uses candidate-specific id only when this map is supplied, falling back unchanged for existing callers. Map creation passes the same id through non-cloze batch entry and cloze create paths. Acceptance retries reconcile via native `getLearningItemsByAcceptanceKey` already used by the agent path before retrying ambiguous writes. Do not silently fallback to no id if keys cannot be generated.

Plan/library/queue do not read recommendation state automatically. Approved cards are real scheduled cards by explicit user choice, not FSRS ratings derived from exam results. Rejection only updates remediation disposition.

### Reassessment and return context

Weak-topic results retain a typed return context `{planId,versionId,nodeId,gapId,sourceAttemptId}`. Open Source uses C1; Tutor/Practice/Card draft and Follow-up use it. Follow-up choices:

- Retake Same Paper uses the original Ready blueprint revision/new client Start key and same fixed questions.
- New Paper creates a C3 revision targeting weak nodes, source scope and difficulty guidance with all old question fingerprints excluded. No claims of matched difficulty; C6 historical labels apply.

After reassessment the return context reopens results/gap/plan, which recompute from evidence. No automatic queue/priority/plan publishing occurs. Practice Finish historical changes use C6 evidence/history, not duplicated “last answer” memory only.

## Risks / Trade-offs

- **Diagnostic placement adds steps** → optional Skip; default 6 items and no essay/timer; diagnostic can resume.
- **One diagnostic shows sparse evidence** → only deterministic review preference and diff labels; no auto-skip or mastery statement.
- **Scoped tutor may have little context** → bounded validated excerpts plus explicit missing-source failure rather than global retrieval.
- **Hints contaminate independent measure** → committed and recorded with each check; C6 down-weights and labels, fresh papers avoid repeats.
- **Card acceptance complexity** → optional narrow idempotency extension with existing-agent reconciliation and per-candidate tests; no retry blindly creating cards.
- **New nested surfaces** → preserve single Study Plans destination/return context and concise default controls.

## Migration Plan

No new table is planned; C4 hint_level and C1–C6 modes/surfaces already support it. The C4/C3 contracts must be complete before C7. New read-only diagnostic adapter command registers normally. If repository changes reveal missing fields, stop and append a fresh reviewed migration rather than hiding data in localStorage. All defaults preserve old tutor/card callers. Legacy plan/gap/evidence data need no transform.
