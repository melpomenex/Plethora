# Design: Unify Assessment Evidence and Remediation

## Context

Plethora's existing examination stack (`assessment_blueprint_repository.rs`, `exam_session_repository.rs`, `exam_grading_repository.rs`, `learning_evidence_repository.rs`) already enforces answer-key stripping, immutable `exam_response_submissions`, `is_current` grade tracking, `model-only` knowledge-policy exclusion, and transactional `record_evidence_for_grade_tx`.

This design extends those exact repositories and TypeScript services (AD-01: no parallel assessment engine) to establish an 8-purpose assessment taxonomy, transactional evidence invalidation/recomputation, dimension-targeted remediation, and anti-loop safeguards.

## Goals / Non-Goals

### Goals
- Define an 8-purpose Assessment Taxonomy with deterministic policies for competency dimension weights, hint/reveal rules, and exam isolation.
- Guarantee that regrading, manual grade overrides, or question-revision invalidation transactionally supersede stale evidence and recompute affected 5D competency projections and knowledge gaps.
- Route remediation recommendations specifically to the failing competency dimension (`retention`/recall, `comprehension`, `application`, `transfer`).
- Prevent remediation loops via attempt caps, modality escalation, alternative-explanation fallback, prerequisite inspection, and explicit learner dismissal/pause controls.

### Non-Goals
- Mutating or deleting immutable `exam_response_submissions`.
- Allowing `model-only` blueprints to produce demonstrated mastery evidence.
- Altering FSRS-7 scheduling intervals directly from remediation planner heuristics (FSRS-7 remains sole item-level scheduler).

## Architecture & Domain Model

### 1. 8-Purpose Assessment Taxonomy

Every `assessment_blueprint_revision` and `exam_attempt` carries an explicit `assessment_purpose` from this closed 8-value taxonomy:

| `assessment_purpose` | Primary Competency Dimensions Updated | Exam Isolation (Strict)? | Hints / Mid-Attempt Reveal? | Mastery Eligible? | Primary Pedagogical Role |
|---|---|---|---|---|---|
| `diagnostic` | `comprehension`, `retention`, `application` (calibrated prior) | Optional | No | Conditional (places prior evidence, damped) | Optional curriculum placement & prior-knowledge check |
| `formative` | `comprehension` (primary), `application` (secondary) | No | Yes (progressive hints; hint-damped evidence) | Low-weight supporting evidence | Low-stakes check during guided reading or study |
| `retrieval_practice` | `retention` (primary) | No | Delayed reveal after attempt | Yes (damped with FSRS retention) | Active recall & spacing reinforcement |
| `mastery` | `comprehension`, `retention`, `application` | Yes | No | **Yes (high weight)** | Concept/module mastery verification |
| `mock_exam` | `comprehension`, `retention`, `application`, `transfer` | Yes (timed, answer keys stripped) | No | Yes (timed simulation weight) | Realistic exam rehearsal & pacing check |
| `summative_exam` | `comprehension`, `retention`, `application`, `transfer` | **Yes (strict)** | No | **Yes (highest weight)** | End-of-unit / high-stakes verified assessment |
| `practical_skill` | `application` (primary), `transfer` (secondary) | Configurable | Rubric criteria visible | **Yes (application/transfer)** | Worked problem, case analysis, or rubric-scored execution |
| `self_assessment` | `exposure` / confidence calibration only | No | Self-revealed | **No (never raises mastery alone)** | Metacognitive calibration & confidence-vs-accuracy tracking |

**Invariants:**
- Blueprints with `knowledgePolicy = 'model-only'` remain excluded from demonstrated mastery evidence regardless of `assessment_purpose`.
- `self_assessment` records metacognitive confidence metadata (used for calibration insights and coaching signals) but NEVER satisfies `demonstrated_prior` or mastery thresholds on its own.
- `mock_exam`, `summative_exam`, and `mastery` enforce strict exam isolation in `unify-learning-activity-runtime` (answer keys stripped via `publicQuestion.ts`, assistant spoilers blocked).

### 2. Transactional Evidence Invalidation & Recomputation

When any of the following events occurs:
1. A grade is **regraded** (new `exam_grades` row supersedes old `is_current = 1` row).
2. A learner or instructor applies a **manual grade override** (`manualGrading.ts`).
3. A **question revision is invalidated** (e.g., ambiguous prompt, broken source anchor, or flawed answer key).

`LearningEvidenceRepository::invalidate_and_recompute_evidence_tx` executes inside a single SQLite transaction:
1. **Preserve immutability:** `exam_response_submissions` and historical `exam_grades` are NEVER deleted or mutated in place; the previous grade transitions to `is_current = 0`.
2. **Supersede stale evidence:** All active `learning_evidence` (and linked `competency_evidence`) rows referencing the superseded `grade_id` or invalidated `question_revision_id` are updated with:
   - `invalidated_at = <now>`
   - `invalidation_reason = 'regraded' | 'manual_override' | 'question_invalidated' | 'source_retracted'`
   - `superseded_by_grade_id = <new_grade_id | NULL>`
3. **Ingest replacement evidence (if applicable):** If a new `is_current = 1`, `state = 'final'` grade exists (and is not `model-only`), invoke `record_evidence_for_grade_tx` inside the same transaction.
4. **Deterministic recomputation:** Collect the union of affected `concept_id`s from superseded and newly ingested evidence rows, recompute `learning_concept_summaries`, 5D `competency_projections`, and `learning_gaps` strictly from active (`invalidated_at IS NULL`) evidence rows.
5. **Emit canonical event:** Write a `learning_events` record (`event_type = 'evidence_invalidated_and_recomputed'`) with affected `concept_id`s so Study Plans, Knowledge Atlas, Today priorities, and DAQE refresh immediately.

### 3. Dimension-Targeted Remediation Routing

When `remediationPlanner.ts` / `remediationService.ts` generates a remediation recommendation for an active `learning_gap`, it inspects the failing competency dimension(s) from the 5D learner model and selects a targeted modality:

| Failing Dimension | Diagnostic Signal | Primary Remediation Modality | Secondary / Escalation Modality |
|---|---|---|---|
| `retention` (recall) | Understood previously or high comprehension, but failed delayed recall / lapsed FSRS item | **Spaced retrieval practice** (targeted flashcards / cued recall deck via FSRS-7) | Cloze/interleaved retrieval set with shorter spacing check |
| `comprehension` | Misconception, wrong explanation, or low comprehension score | **Source-grounded guided reading re-anchor** + optional Socratic explanation | Switch to linked `alternative_explanation_of` source or simpler worked conceptual breakdown |
| `application` | Correct recall/definition, failed procedural or problem-solving item | **Worked example + guided practical skill prompt** (rubric-backed) | Scaffolded step-by-step problem decomposition |
| `transfer` | Solved familiar problem, failed novel context or cross-concept contrast | **Contrastive / transfer prompt** leveraging `contrasts_with` / `applies` graph edges | Cross-source synthesis prompt |
| `exposure` | Concept has never been encountered in source material | **Guided reading segment** (never drill flashcards before exposure) | Overview summary from grounded local source |

Every remediation card explicitly displays **why** that modality was chosen (e.g., *"Targeted for Comprehension — you recalled the term but missed how it applies in the rubric"*), computed deterministically from the gap and dimension scores.

### 4. Anti-Loop Safeguards & Escalation Ladder

To guarantee that remediation never traps a learner in a frustrating infinite loop, each `(concept_id, target_dimension)` tracks `attempt_count`, `last_modality`, `consecutive_failures`, `cooldown_until`, and `escalation_stage` (`0..=3`):

- **Stage 0 (Initial targeted remediation):** Launch primary dimension-targeted modality (max 2 consecutive attempts of the same modality).
- **Stage 1 (Modality switch):** After 2 unsuccessful attempts in the same modality, automatically switch modality (e.g., flashcards → guided reading passage; standard explanation → worked example).
- **Stage 2 (Alternative explanation & prerequisite check):** After 3 unsuccessful attempts, surface any linked `alternative_explanation_of` source from the curriculum graph AND check `requires` prerequisite concepts in the learner model to surface an upstream gap if present.
- **Stage 3 (Cooldown & graceful exit):** After reaching the per-concept cap (default: **4 remediation attempts** within a 24-hour window, configurable), stop auto-requeuing the remediation, set a cooldown (`cooldown_until`), and present explicit learner choices: **"Pause for 24h"**, **"Mark as needs review later"**, **"Edit/fix source or question"**, or **"Dismiss remediation"**.
- At **any** stage (`0..=3`), the learner can immediately **Skip**, **Postpone**, or **Dismiss** a remediation recommendation.

## Database Schema (Migration `172_adaptive_curricula_and_remediation`)

Coordinated with `implement-competency-based-adaptive-curricula` in migration `172_adaptive_curricula_and_remediation`:

1. **Extend `assessment_blueprints` / `assessment_blueprint_revisions` and `exam_attempts`**:
   - `assessment_purpose TEXT NOT NULL DEFAULT 'formative' CHECK (assessment_purpose IN ('diagnostic','formative','retrieval_practice','mastery','mock_exam','summative_exam','practical_skill','self_assessment'))`
2. **Extend `learning_evidence`**:
   - `assessment_purpose TEXT`
   - `target_dimension TEXT CHECK (target_dimension IS NULL OR target_dimension IN ('exposure','comprehension','retention','application','transfer'))`
   - `invalidated_at TEXT`
   - `invalidation_reason TEXT CHECK (invalidation_reason IS NULL OR invalidation_reason IN ('regraded','manual_override','question_invalidated','source_retracted'))`
   - `superseded_by_grade_id TEXT`
   - Index on `(concept_id, invalidated_at)` for fast active-evidence recomputation.
3. **Extend `learning_remediations`**:
   - `target_dimension TEXT NOT NULL DEFAULT 'comprehension' CHECK (target_dimension IN ('exposure','comprehension','retention','application','transfer'))`
   - `modality TEXT NOT NULL DEFAULT 'guided_reading'`
   - `attempt_count INTEGER NOT NULL DEFAULT 0`
   - `escalation_stage INTEGER NOT NULL DEFAULT 0`
   - `cooldown_until TEXT`
   - `dismissed_at TEXT`
   - `dismiss_reason TEXT`
   - `rationale_deterministic TEXT`

## Risks & Trade-offs

- **Risk: Recomputing competency on every regrade could drift if partial updates fail.**
  - *Mitigation:* Invalidation, replacement ingestion, and concept summary/projection recomputation run in one atomic SQLite transaction (`invalidate_and_recompute_evidence_tx`); failure rolls back cleanly.
- **Risk: `self_assessment` users expecting immediate green mastery badges.**
  - *Mitigation:* UI clearly labels `self_assessment` as confidence calibration ("Self-check recorded — verify with retrieval or mastery check to confirm competency"), preserving evidence integrity.
