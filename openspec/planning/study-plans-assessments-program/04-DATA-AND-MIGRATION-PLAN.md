# Data Ownership, SQL and Migration Plan

This is the authoritative physical-persistence plan for the contracts in [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md). SQL is a design contract, not a production migration. At each implementation change, re-derive the highest numeric prefix in `src-tauri/src/database/migrations.rs`; `<study_01>` etc. below are **placeholders**, not reserved migration numbers.

## 1. Ownership summary

| Entity | Physical owner | Source of truth | Deletion owner/behavior |
|---|---|---|---|
| Durable learning goal | `study_plans.goal/title/depth`; no separate goal table | Plan row | Archive or explicit plan deletion; library unaffected |
| Plan head/history/draft | `study_plans`, `study_plan_versions` | Version rows + head pointers | Plan delete cascades only plan-owned versions/nodes/activity |
| Logical topic identity | `study_plan_nodes` | Stable `spn_` id + app semantic key | Plan delete; version nodes preserve all historical content |
| Topic content/order/lock/tombstone | `study_plan_version_nodes` | Published immutable version; one draft mutable | Version/plan cascade |
| Prerequisite relationship | `study_plan_prerequisites` | Plan-version DAG, separate from `concept_links` | Version/plan cascade; no automatic global graph mutation |
| Study activity | `study_plan_node_activity` | Explicit/activity-derived status, not mastery | Plan delete |
| Durable evidence anchor | `study_source_refs` | Live-validated document id/revision/excerpt + navigation data | Retained for history; unreferenced refs removed by owner deletion transaction |
| Generation work | `study_generation_jobs`, `_steps` | Job state/step input/output refs/checkpoints | Cancel preserves; explicit job cleanup after artifact removal |
| Blueprint identity/head | `assessment_blueprints` | Stable container + current revision pointer | Archive when attempts exist; unused hard-delete only |
| Fixed paper | `assessment_blueprint_revisions`, question revisions/slots | Ready immutable revision | Never rewrite after Ready; plan deletion detaches head only |
| Question identity/content | `assessment_questions`, `_revisions` | App ids, typed versioned payload, committed key/rubric | Unused blueprint cascade; attempted history preserved |
| Question sources/targets | `_sources`, `_targets` associations | Question revision ↔ evidence/concepts/nodes | Owner cascade; referenced source history remains |
| Attempt/current answer | `exam_attempts`, `exam_responses` | InProgress CAS response + fixed revision id | Cancel retains; explicit history delete |
| Evaluated answer | `exam_response_submissions` | Immutable response payload/ordinal/kind | Attempt history delete only |
| Grade/rubric assessment | `exam_grades` | Append-only grade rows + one current row/submission | New grade supersedes; explicit history delete |
| Demonstrated performance | `learning_evidence` | Unique final-grade/review observation keyed to source | Supersede adjusts same row; exam delete removes its evidence |
| Current evidence projection | `learning_concept_summaries` | Recomputable `evidence-v1` cache | Rebuild after policy change; not authority over evidence |
| Knowledge gap/explanation | `learning_gaps`, `_evidence` | Rule id/status/evidence references | Dismiss/resolve; suppression retained; permanent evidence/history deletion cascades links |
| Remediation disposition | `learning_remediations` | Recommendation payload/status | Dismiss persists; delete with gap/exam history as applicable |
| Documents/extracts/cards/concepts | Existing tables | Existing owners | Never duplicate rows; no exam record becomes `learning_items` |

## 2. Migration allocation and ordering

| Change | Placeholder migration name | Content |
|---|---|---|
| C1 | `<study_01>_persistent_study_plans` | Plans, versions, logical/version nodes, prerequisites, activity, shared source refs and associations, indexes/import key |
| C2 | `<study_02>_study_generation_jobs` | Narrow job/step ledger, active-job uniqueness and lease/cancellation indexes |
| C3 | `<study_03>_assessment_blueprints_and_questions` | Blueprint heads/revisions, questions/revisions/targets/sources, immutability trigger |
| C4 | `<study_04>_exam_attempts_responses_and_grades` | Attempts, responses, immutable submissions, complete grade-history schema needed by objective and future rubric grading |
| C5 | Normally none | Reuse C4 grade rows and C2 jobs; add an index only if measured query needs prove it, as a fresh migration |
| C6 | `<study_05>_learning_evidence_and_gaps` | Evidence, current summaries, gaps/evidence/remediation and legacy gap import key |
| C7 | None planned | Existing source/job/blueprint/attempt/evidence tables already represent diagnostics/practice |
| C8 | None | Qualification only |

Every migration is appended to the inline `MIGRATIONS` registry, has a unique full name, runs under the existing per-migration transaction, and adds an inline `#[cfg(test)]` migration test using `pool_migrated_up_to`. Test both a fresh database and a database populated at the immediately prior migration. Do not modify historical migration strings or assume a legacy standalone `.sql` file is registered.

Migration tests must assert actual columns/indexes/FKs/triggers using SQLite metadata and behavior, not merely that `run_migrations` returns Ok. Add failure-injection tests for partial write rollback and constraint violations in the owning Rust repository modules.

## 3. C1 — Study Plan and source SQL contract

```sql
CREATE TABLE study_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 200),
  depth TEXT NOT NULL CHECK(depth IN ('survey','foundational','deep')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id TEXT REFERENCES study_plan_versions(id) ON DELETE SET NULL,
  draft_version_id TEXT REFERENCES study_plan_versions(id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  legacy_import_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE study_plan_nodes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  semantic_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, semantic_key),
  UNIQUE(plan_id, id)
);

CREATE TABLE study_plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  state TEXT NOT NULL CHECK(state IN ('draft','published','superseded')),
  base_version_id TEXT REFERENCES study_plan_versions(id) ON DELETE SET NULL,
  source_scope_json TEXT NOT NULL,
  change_summary_json TEXT,
  created_by TEXT NOT NULL CHECK(created_by IN
    ('user','ai','legacy-import','diagnostic-adaptation')),
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(plan_id, version),
  CHECK((state='published' AND published_at IS NOT NULL) OR state <> 'published')
);
CREATE UNIQUE INDEX one_study_plan_draft
  ON study_plan_versions(plan_id) WHERE state='draft';
CREATE INDEX study_plan_versions_head ON study_plan_versions(plan_id, version DESC);

CREATE TABLE study_source_refs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
  document_id TEXT NOT NULL,       -- historical id, deliberately no document FK cascade
  extract_id TEXT,                 -- historical extract id, also retained if source is deleted
  excerpt TEXT NOT NULL CHECK(length(excerpt) BETWEEN 1 AND 1600),
  excerpt_sha256 TEXT NOT NULL,
  revision TEXT NOT NULL,
  revision_kind TEXT NOT NULL CHECK(revision_kind IN ('content-hash','modified-at','unknown')),
  document_title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  jump_json TEXT,
  chunk_json TEXT,
  section_label TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX study_source_refs_document ON study_source_refs(document_id, revision);
CREATE INDEX study_source_refs_extract ON study_source_refs(extract_id) WHERE extract_id IS NOT NULL;
CREATE UNIQUE INDEX study_source_refs_content ON study_source_refs
  (document_id, revision, excerpt_sha256, COALESCE(extract_id,''));

CREATE TABLE study_plan_version_nodes (
  version_id TEXT NOT NULL REFERENCES study_plan_versions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES study_plan_nodes(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 1000),
  learning_objectives_json TEXT NOT NULL,
  concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  concept_label TEXT NOT NULL,
  position INTEGER NOT NULL,
  included INTEGER NOT NULL CHECK(included IN (0,1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  user_added INTEGER NOT NULL DEFAULT 0 CHECK(user_added IN (0,1)),
  user_modified INTEGER NOT NULL DEFAULT 0 CHECK(user_modified IN (0,1)),
  material_support TEXT NOT NULL CHECK(material_support IN ('grounded','unsupported','not-validated')),
  why_here TEXT,
  PRIMARY KEY(version_id, node_id),
  CHECK((included=1 AND position >= 0) OR (included=0 AND position=-1))
);
CREATE UNIQUE INDEX study_plan_included_positions
  ON study_plan_version_nodes(version_id, position) WHERE included=1;
CREATE INDEX study_plan_version_nodes_concept ON study_plan_version_nodes(concept_id)
  WHERE concept_id IS NOT NULL;

CREATE TABLE study_plan_prerequisites (
  version_id TEXT NOT NULL REFERENCES study_plan_versions(id) ON DELETE CASCADE,
  prerequisite_node_id TEXT NOT NULL REFERENCES study_plan_nodes(id) ON DELETE CASCADE,
  dependent_node_id TEXT NOT NULL REFERENCES study_plan_nodes(id) ON DELETE CASCADE,
  support TEXT NOT NULL CHECK(support IN
    ('user','confirmed-concept-link','inferred','unsupported')),
  rationale TEXT,
  PRIMARY KEY(version_id, prerequisite_node_id, dependent_node_id),
  CHECK(prerequisite_node_id <> dependent_node_id)
);
CREATE INDEX study_plan_prereqs_dependent
  ON study_plan_prerequisites(version_id, dependent_node_id);

CREATE TABLE study_plan_node_sources (
  version_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  source_ref_id TEXT NOT NULL REFERENCES study_source_refs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  role TEXT NOT NULL DEFAULT 'primary' CHECK(role IN ('primary','supporting')),
  PRIMARY KEY(version_id, node_id, source_ref_id),
  UNIQUE(version_id, node_id, ordinal),
  FOREIGN KEY(version_id, node_id) REFERENCES study_plan_version_nodes(version_id, node_id)
    ON DELETE CASCADE
);
CREATE INDEX study_plan_node_sources_ref ON study_plan_node_sources(source_ref_id);

CREATE TABLE study_plan_prerequisite_sources (
  version_id TEXT NOT NULL,
  prerequisite_node_id TEXT NOT NULL,
  dependent_node_id TEXT NOT NULL,
  source_ref_id TEXT NOT NULL REFERENCES study_source_refs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
  PRIMARY KEY(version_id, prerequisite_node_id, dependent_node_id, source_ref_id),
  FOREIGN KEY(version_id, prerequisite_node_id, dependent_node_id)
    REFERENCES study_plan_prerequisites(version_id, prerequisite_node_id, dependent_node_id)
    ON DELETE CASCADE
);

CREATE TABLE study_plan_node_activity (
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  activity TEXT NOT NULL DEFAULT 'not-started'
    CHECK(activity IN ('not-started','in-progress','completed','skipped')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(plan_id, node_id),
  FOREIGN KEY(plan_id, node_id) REFERENCES study_plan_nodes(plan_id, id) ON DELETE CASCADE
);
CREATE INDEX study_plan_activity_plan ON study_plan_node_activity(plan_id, activity);
```

### C1 invariants not delegated to SQL

- `current_version_id`/`draft_version_id` must reference versions of the same plan; repository queries assert this on every write/read. Published heads have version equal to `current_version` and no included cyclic/dangling edges.
- The only mutable version is Draft. No repository UPDATE targets Published/Superseded content; future edits copy to a new Draft.
- Grounded publication requires source refs validated against current revisions; unsupported nodes have no invented refs.
- Logical node semantic keys are computed locally and include no random model ids. Removed user nodes remain included=0 in subsequent drafts.
- Only one active plan-level import key per original localStorage path; retry reads existing plan and validates row counts before returning.

## 4. C2 — Study generation job SQL contract

```sql
CREATE TABLE study_generation_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('curriculum','assessment-generation','exam-grading')),
  target_id TEXT NOT NULL,         -- generic by CHECKed kind; repository validates owner existence
  target_revision INTEGER NOT NULL CHECK(target_revision >= 0),
  creation_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('queued','running','awaiting-review','interrupted','completed','failed','cancelled')),
  next_step_index INTEGER NOT NULL DEFAULT 0 CHECK(next_step_index >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  cancellation_epoch INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  preflight_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX one_active_study_request ON study_generation_jobs(kind,target_id,request_hash)
  WHERE status IN ('queued','running','interrupted','awaiting-review');
CREATE INDEX study_jobs_target ON study_generation_jobs(target_id,kind,updated_at DESC);
CREATE INDEX study_jobs_recovery ON study_generation_jobs(status,lease_expires_at);

CREATE TABLE study_generation_steps (
  job_id TEXT NOT NULL REFERENCES study_generation_jobs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','skipped')),
  output_ref_id TEXT,
  safe_error_json TEXT,
  completed_at TEXT,
  PRIMARY KEY(job_id, step_key),
  UNIQUE(job_id, ordinal),
  UNIQUE(job_id, input_hash)
);
CREATE INDEX study_steps_pending ON study_generation_steps(job_id,status,ordinal);
```

There are intentionally no arbitrary job-type strings, payload SQL, cron expressions, shell commands, model-selected tool names, or generic worker registrations. `target_id` ownership is validated in the same transaction as job creation. Leases last 120 seconds for generation/90-second grading tasks and are renewed before each call and immediately before commit; an expired lease cannot commit. `recover_interrupted_study_jobs` changes Running/Queued with missing/expired lease to Interrupted without deleting steps.

## 5. C3 — Assessment blueprint/question SQL contract

```sql
CREATE TABLE assessment_blueprints (
  id TEXT PRIMARY KEY,
  plan_id TEXT REFERENCES study_plans(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  current_revision_id TEXT REFERENCES assessment_blueprint_revisions(id) ON DELETE SET NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assessment_blueprint_revisions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES assessment_blueprints(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  state TEXT NOT NULL CHECK(state IN ('draft','needs-review','ready','failed','cancelled')),
  plan_version_id TEXT REFERENCES study_plan_versions(id) ON DELETE SET NULL,
  config_json TEXT NOT NULL,
  scoring_json TEXT NOT NULL,
  source_scope_json TEXT NOT NULL,
  quota_json TEXT NOT NULL,
  generation_job_id TEXT REFERENCES study_generation_jobs(id) ON DELETE SET NULL,
  source_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(blueprint_id, revision),
  CHECK((state='ready' AND published_at IS NOT NULL) OR state <> 'ready')
);
CREATE UNIQUE INDEX one_blueprint_draft ON assessment_blueprint_revisions(blueprint_id)
  WHERE state IN ('draft','needs-review','failed');
CREATE INDEX blueprint_revisions_plan_version ON assessment_blueprint_revisions(plan_version_id);
CREATE INDEX blueprint_revisions_current ON assessment_blueprint_revisions(blueprint_id,revision DESC);

CREATE TABLE assessment_questions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES assessment_blueprints(id) ON DELETE CASCADE,
  semantic_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(blueprint_id, semantic_fingerprint)
);

CREATE TABLE assessment_question_revisions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  blueprint_revision_id TEXT NOT NULL REFERENCES assessment_blueprint_revisions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  slot_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN
    ('single-select','multi-select','cloze','short-answer','essay')),
  payload_json TEXT NOT NULL,
  answer_key_json TEXT NOT NULL,
  rubric_json TEXT,
  max_points INTEGER NOT NULL CHECK(max_points BETWEEN 1 AND 20),
  difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
  validation TEXT NOT NULL CHECK(validation IN ('draft','valid','invalid')),
  validation_issues_json TEXT NOT NULL DEFAULT '[]',
  committed_at TEXT,
  provider_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(question_id, blueprint_revision_id),
  UNIQUE(blueprint_revision_id, slot_key)
);
CREATE INDEX question_revisions_paper ON assessment_question_revisions(blueprint_revision_id,slot_key);
CREATE INDEX question_revisions_fingerprint ON assessment_question_revisions(fingerprint);
CREATE UNIQUE INDEX one_selected_question_fingerprint
  ON assessment_question_revisions(blueprint_revision_id,fingerprint) WHERE validation='valid';

CREATE TABLE assessment_question_sources (
  question_revision_id TEXT NOT NULL REFERENCES assessment_question_revisions(id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES study_source_refs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
  role TEXT NOT NULL CHECK(role IN ('primary','supporting','expected-answer')),
  PRIMARY KEY(question_revision_id,source_ref_id),
  UNIQUE(question_revision_id,ordinal)
);
CREATE INDEX assessment_question_sources_ref ON assessment_question_sources(source_ref_id);

CREATE TABLE assessment_question_targets (
  question_revision_id TEXT NOT NULL REFERENCES assessment_question_revisions(id) ON DELETE CASCADE,
  concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  concept_label TEXT NOT NULL,
  node_id TEXT,                       -- historical logical node id, not plan-head dynamic FK
  objective_text TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 5),
  PRIMARY KEY(question_revision_id,ordinal)
);
CREATE INDEX assessment_question_targets_concept ON assessment_question_targets(concept_id,concept_label);
CREATE INDEX assessment_question_targets_node ON assessment_question_targets(node_id);

CREATE TRIGGER committed_assessment_question_immutable
BEFORE UPDATE OF payload_json,answer_key_json,rubric_json,slot_key,fingerprint,
  kind,max_points,difficulty,question_id,blueprint_revision_id,revision
ON assessment_question_revisions
WHEN OLD.committed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'committed_question_immutable'); END;
```

C3 publication validates the entire revision before setting `committed_at` and Ready. Every configuration/target/source/question-list change resets persisted `shortfallAccepted=false` in a mutable Draft; creating a Draft from Ready also resets it. A Ready revision can preserve true only because it was accepted against that exact immutable config/question/deficit payload at publication, and Start rechecks Ready+the resulting exact valid question set. This prevents stale shortfall approval surviving an edit. Plan deletion sets the blueprint head plan_id null and the revision plan_version_id null only as a consequence of plan-owned history deletion; `source_snapshot_hash`, question targets' historical node ids and blueprint history remain readable. No stored command updates committed key/rubric/payload. New question content is a new `aqr_` row.

If the implementing agent needs user-facing selection/exclusion per candidate, add a `selected` boolean **before** publication within the same C3 migration/design update, with exactly one valid selected question per slot. Do not casually alter UNIQUE constraints later. The baseline interpretation is one revision per slot and draft replacement before commit; exclusions leave a disclosed deficit.

## 6. C4 — Attempt/response/grade SQL contract

```sql
CREATE TABLE exam_attempts (
  id TEXT PRIMARY KEY,
  blueprint_revision_id TEXT NOT NULL REFERENCES assessment_blueprint_revisions(id) ON DELETE RESTRICT,
  client_start_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('exam','practice','diagnostic')),
  status TEXT NOT NULL CHECK(status IN
    ('in-progress','submitted','grading','partially-graded','complete','grading-failed','cancelled')),
  question_revision_ids_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  submission_reason TEXT CHECK(submission_reason IN ('user','timer','timer-recovered')),
  submission_key TEXT UNIQUE,
  awarded_points REAL,
  maximum_points REAL NOT NULL CHECK(maximum_points > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(blueprint_revision_id,client_start_key),
  CHECK(awarded_points IS NULL OR (awarded_points >= 0 AND awarded_points <= maximum_points))
);
CREATE INDEX exam_attempts_paper ON exam_attempts(blueprint_revision_id,started_at DESC);
CREATE INDEX exam_attempts_status ON exam_attempts(status,deadline_at);
CREATE INDEX exam_attempts_history ON exam_attempts(completed_at DESC);

CREATE TABLE exam_responses (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_revision_id TEXT NOT NULL REFERENCES assessment_question_revisions(id) ON DELETE RESTRICT,
  draft_json TEXT NOT NULL,
  mark TEXT NOT NULL CHECK(mark IN ('unanswered','answered','skipped')),
  revision INTEGER NOT NULL DEFAULT 1,
  last_client_mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(attempt_id,question_revision_id),
  UNIQUE(attempt_id,last_client_mutation_id)
);
CREATE INDEX exam_responses_attempt ON exam_responses(attempt_id,question_revision_id);

CREATE TABLE exam_response_submissions (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES exam_responses(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_revision_id TEXT NOT NULL REFERENCES assessment_question_revisions(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  kind TEXT NOT NULL CHECK(kind IN ('exam-final','practice-check')),
  response_json TEXT NOT NULL,
  mark TEXT NOT NULL CHECK(mark IN ('unanswered','answered','skipped')),
  hint_level INTEGER NOT NULL DEFAULT 0 CHECK(hint_level BETWEEN 0 AND 3),
  created_at TEXT NOT NULL,
  UNIQUE(response_id,ordinal)
);
CREATE UNIQUE INDEX one_exam_final_submission ON exam_response_submissions(response_id)
  WHERE kind='exam-final';
CREATE INDEX response_submissions_attempt ON exam_response_submissions(attempt_id,ordinal);

CREATE TABLE exam_grades (
  id TEXT PRIMARY KEY,
  response_submission_id TEXT NOT NULL REFERENCES exam_response_submissions(id) ON DELETE CASCADE,
  question_revision_id TEXT NOT NULL REFERENCES assessment_question_revisions(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK(origin IN ('deterministic','ai','manual')),
  state TEXT NOT NULL CHECK(state IN ('final','needs-review','failed')),
  points REAL,
  max_points REAL NOT NULL CHECK(max_points > 0),
  assessment_json TEXT,
  criteria_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT,
  manual_reason TEXT,
  supersedes_grade_id TEXT REFERENCES exam_grades(id) ON DELETE SET NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK(points IS NULL OR (points >= 0 AND points <= max_points)),
  CHECK((origin='manual' AND length(trim(manual_reason)) > 0) OR origin <> 'manual'),
  CHECK((state='final' AND points IS NOT NULL) OR state <> 'final')
);
CREATE UNIQUE INDEX one_current_exam_grade ON exam_grades(response_submission_id)
  WHERE is_current=1;
CREATE INDEX exam_grades_question ON exam_grades(question_revision_id,created_at);
CREATE INDEX exam_grades_submission_history ON exam_grades(response_submission_id,created_at);
```

The C4 migration also creates this history guard after `exam_responses` exists:

```sql
CREATE TRIGGER committed_assessment_question_history_delete_guard
BEFORE DELETE ON assessment_question_revisions
WHEN OLD.committed_at IS NOT NULL AND EXISTS (
  SELECT 1 FROM exam_responses WHERE question_revision_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'committed_question_immutable'); END;
```

There is deliberately no arbitrary single-committed-question DELETE command or reparent API. The only valid cascade deletion of committed content is an explicit user deletion of the **whole unused blueprint** after its native command proves no attempts reference any of its revisions. That is destruction of an unused owned artifact, not mutation of examination history. Any attempted revision/response/grade reference makes its blueprint ineligible. After users explicitly delete all associated attempt histories, the blueprint may again qualify as unused; deleting paper history is then a separately confirmed action. A privileged local DB editor is outside the application's tamper-evidence claim.

C4 intentionally creates the full grade schema, including nullable assessment/rubric/provenance/manual fields, so C5 does not rebuild authoritative storage. C4 only writes deterministic origin and final objective/blank grades. C5 writes AI/manual rows. `exam_attempts` never stores `learning_item_id`, rating, due date, interval, stability, memory state, Queue priority or other scheduler columns.

All points constraints are backed by exact application scoring validation. Real numeric sums retain precision; only UI rounds. Attempt current grade retrieval uses `is_current=1`; no provider timestamp can reorder history.

## 7. C6 — Evidence/gap SQL contract

```sql
CREATE TABLE learning_evidence (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,         -- preserve historical identity; no cascade from concepts
  concept_label TEXT NOT NULL,
  plan_id TEXT REFERENCES study_plans(id) ON DELETE SET NULL,
  node_id TEXT,
  source_kind TEXT NOT NULL CHECK(source_kind IN
    ('exam-final','practice-check','diagnostic-final','review-result')),
  source_id TEXT NOT NULL,
  grade_id TEXT REFERENCES exam_grades(id) ON DELETE CASCADE,
  evidence_group_id TEXT NOT NULL,
  question_fingerprint TEXT,
  observed_score REAL CHECK(observed_score IS NULL OR
    (observed_score >= 0 AND observed_score <= 1)),
  outcome TEXT NOT NULL CHECK(outcome IN
    ('correct','partial','incorrect','misconception','unanswered','skipped','review-lapse')),
  misconception TEXT,
  learner_confidence REAL CHECK(learner_confidence IS NULL OR
    (learner_confidence >= 0 AND learner_confidence <= 1)),
  hint_level INTEGER NOT NULL DEFAULT 0 CHECK(hint_level >= 0),
  grader_origin TEXT NOT NULL CHECK(grader_origin IN
    ('deterministic','ai','manual','user-review')),
  occurred_at TEXT NOT NULL,
  policy_version TEXT NOT NULL DEFAULT 'evidence-v1' CHECK(policy_version='evidence-v1'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_kind,source_id,concept_id)
);
CREATE INDEX learning_evidence_concept ON learning_evidence(concept_id,occurred_at DESC);
CREATE INDEX learning_evidence_group ON learning_evidence(evidence_group_id,concept_id);
CREATE INDEX learning_evidence_plan ON learning_evidence(plan_id,node_id,occurred_at DESC);
CREATE INDEX learning_evidence_grade ON learning_evidence(grade_id);

CREATE TABLE learning_concept_summaries (
  concept_id TEXT PRIMARY KEY,
  concept_label TEXT NOT NULL,
  policy_version TEXT NOT NULL CHECK(policy_version='evidence-v1'),
  evidence_cutoff TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN
    ('insufficient-evidence','needs-attention','developing','demonstrated-consistently')),
  stats_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX learning_summaries_level ON learning_concept_summaries(level,computed_at DESC);

CREATE TABLE learning_gaps (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  concept_label TEXT NOT NULL,
  plan_id TEXT REFERENCES study_plans(id) ON DELETE SET NULL,
  node_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN
    ('weak_prerequisite','missing_concept','repeatedly_failed','read_never_reviewed',
     'disconnected_cluster','weak_transfer')),
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','dismissed','resolved')),
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  evidence_cutoff TEXT NOT NULL,
  legacy_import_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(concept_id,kind,rule_id)
);
CREATE INDEX learning_gaps_active ON learning_gaps(status,plan_id,last_detected_at DESC);
CREATE INDEX learning_gaps_concept ON learning_gaps(concept_id,kind,status);

CREATE TABLE learning_gap_evidence (
  gap_id TEXT NOT NULL REFERENCES learning_gaps(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN
    ('review_lapse','unreviewed_reading','graph_edge','assessment')),
  description TEXT NOT NULL,
  source_ref_id TEXT REFERENCES study_source_refs(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(gap_id,record_id,kind)
);
CREATE INDEX learning_gap_evidence_record ON learning_gap_evidence(record_id,kind);

CREATE TABLE learning_remediations (
  id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL REFERENCES learning_gaps(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN
    ('open-source','review-extract','tutor','targeted-practice','card-proposals',
     'follow-up-exam','plan-adjustment')),
  status TEXT NOT NULL CHECK(status IN ('suggested','accepted','dismissed','completed')),
  source_ref_ids_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(gap_id,kind)
);
CREATE INDEX learning_remediations_status ON learning_remediations(gap_id,status);
```

`learning_concept_summaries` is a deterministic projection that may be deleted/rebuilt from evidence under the same policy version. Existing review_results are read-only; a `review-result` evidence row is disconnected from `exam_grades` and uses `source_id=review_results.id` (text). No review rating becomes an automated scheduler write. When an exam history is deleted, its grade evidence cascades; summaries/gaps are recomputed before the delete command returns so stale recommendations do not survive.

## 8. Validation ownership and transaction boundaries

| Validation | Owner | Timing |
|---|---|---|
| Goal/text/table-bound checks | Shared TS DTO + Rust command defensive checks | Before persistence; Rust remains authority |
| Scope collection/tag resolution/id freeze | Rust repository using existing document ownership tables | Create/regenerate/publish draft |
| Excerpt/revision/jump validity | Rust source service against live records | Ref creation/update and navigation/Ready publication |
| DAG/cycle/manual position | Pure TS plus repeat in Rust command validator before commit | Draft save, generation checkpoint, Publish |
| Blueprint quotas | Pure TS; Rust validates persisted quota and slots before Ready | Config save, generation checkpoint, Publish |
| Question discriminated union/gradeability | TS schema; Rust validates structural envelope and immutable committed state | Draft upsert and Publish |
| Response kind/ids/limits | TS editor + Rust submit/save command against pinned payload | Every Save/Check/Submit |
| Objective/rubric points | Pure TS deterministic grader; Rust validates range/member ownership CAS | Submit, Check, AI/manual grade commit |
| Provider output | runTask schema + custom fail-closed validator | Before job completion command |
| Job lease/idempotency/stale target | Rust only | Claim, complete, retry, resume, cancel |
| Evidence fold/gap/suppression | TS pure evidence-v1 with Rust transaction/update defensive checks | Final grade settlement/explicit local refresh |

The implementation may share validators through generated/plain DTO conversion but must not bypass Rust defensive checks because the UI ran them. Conversely, no TS command success is optimistic before SQLite commit.

## 9. Legacy localStorage reconciliation

### 9.1 `plethora-learning-paths`

C1 adds `legacyLearningPathsImport.ts` as a new feature adapter:

1. On native Study Plans first open, read only the old key and its Zustand envelope. Refuse newer/unknown malformed shape without deleting it.
2. Validate every goal/path/node; repair a node's mismatched path id to its containing path because the old creator failed to rebind it. Reject duplicate node ids, unknown goal ids, omitted-reorder survivors that cannot be reconstructed, invalid numeric mastery fields and cycles/dangling edges. Valid nodes are imported with `estimatedMasteryStart/targetMastery` treated as unverified legacy annotations, never current mastery.
3. Use a user-visible import preview showing valid/invalid counts. Do not silently drop malformed paths. Invalid material can be exported/copy-inspected; it is not published as a grounded plan.
4. `import_hash` hashes the canonical original payload. Rust assigns new prefixed ids while mapping old ids transactionally; `legacy_import_key` provides idempotency. Existing sourceDocIds resolve to current documents; deleted ids remain unsupported historical references rather than fabricated current citations.
5. Preserve user status as activity only when valid. Positions are recomputed using the new strict DAG; any cycle becomes an import issue requiring editing in Draft.
6. Only after the entire accepted import commits, rename the original key to `plethora-learning-paths:backup:v1` and set a migration marker. Failure keeps the old key for retry. The new store never writes the old key again.
7. Clear Paths/debug calls cannot delete SQLite data. Remove the old persist reducer while retaining the debug store handle as a harmless API-backed cache.

### 9.2 `plethora-knowledge-gaps`

C6 imports old gaps only as `legacy-localstorage-v1` rule records. Their `masteryEstimate`/`variance` are stored in import provenance, not mapped to `ConceptMasterySummary.observedMean` or presented as measured mastery. Preserve status/dismissal and legacy evidence descriptions where resolvable; assign `legacy_import_key` deterministically. Recompute all current states under `evidence-v1`; unresolved historical claims are marked unverified. Backup/rename the old key only after accepted idempotent import. Remove the old persisted store authority.

## 10. Source deletion, plan deletion and exam history

- **Document/extract deleted:** existing source owner deletes its rows. `study_source_refs` deliberately retain document/extract ids, excerpt, hash/revision and navigation snapshot. Navigation checks live state and returns Missing; plan coverage/ready future generation exclude missing evidence. Existing results do not disappear.
- **Source content changed:** historical refs stay unchanged and resolve Stale. Starting a new generation freezes a new source scope. In-flight jobs fail `source_changed` before their next checkpoint, preventing mixed revisions. Existing published versions/papers remain tied to old snapshots.
- **Concept deleted:** version/question `concept_id` columns become null but labels/objectives/evidence ids remain. `learning_evidence` intentionally retains `concept_id` as a historical string and label; new remediation cannot resolve the deleted concept and offers source/custom plan actions instead.
- **Plan deleted:** versions/nodes/prerequisites/activity cascade. Blueprint plan_id and evidence plan_id become null; revision plan_version_id becomes null. Questions, attempts, grades, evidence and source refs remain accessible in assessment history. Any user-created cards remain normal cards.
- **Blueprint deleted with no attempts:** heads/revisions/questions/links cascade; source refs used elsewhere remain. With attempts, Delete returns invalid_state and offers Archive.
- **Attempt/history permanently deleted:** attempt → responses → submissions → current/historical grades → exam evidence/gap links/remediation dispositions cascade, then recompute affected summaries/gaps. Delete unused source refs only when no plan/question/gap association remains. Documents, extracts, cards and review results are never touched.
- **Cancel attempt/job:** is not deletion; all confirmed work remains for review/resume according to lifecycle.

## 11. Backup, sync and upgrade behavior

- Native full database backup's `VACUUM INTO` includes all new rows automatically when database backup is selected. Restoration restores matched schema versions after migration. Verify plans/questions/responses/grades and refs against fixture checksums.
- Existing explicit `src/utils/appStateExport.ts` / `appStateImport.ts` are a separate schema with id remapping. This program does **not** claim support; UI must not label that JSON as a complete Study Plans backup. A future export proposal can add versioned artifacts transactionally.
- Existing two-way sync `EntityType`, bootstrap table list, merge and registry do not include these artifacts. Do not insert a partial EntityType or apply last-write-wins to committed history. Native artifacts are local to that database until a dedicated conflict/identity sync design exists.
- New payload readers accept exactly `schemaVersion=1` plus documented unknown-field preservation policy. A newer major version returns `unsupported_version` and preserves the row, rather than erasing/overwriting it from an older build.
- Additive schema upgrades cannot be rolled back by rewriting migration history. Application rollback may leave unknown tables unused, but opening newer-version JSON in an old build must be refused. The supported rollback for user mistakes is version copy/new draft, not DB downgrading.
- Every persisted enum/delimited value is validated at the Rust/TS boundary; corrupt JSON marks the owning artifact unavailable with recovery guidance and does not cascade deletion.

## 12. Migration verification checklist

For each migration:

1. Fresh in-memory DB applies through the new migration; prior-populated DB upgrades without changing pre-existing rows.
2. `PRAGMA foreign_key_check`, expected indexes, unique constraints, CHECK failures and trigger behavior are asserted.
3. Migration registry names remain sorted, unique and replay status remains based on exact full names.
4. Crash/failure injection before commit leaves neither head pointer nor partial child/source/job/response/grade/evidence records.
5. Legacy store fixtures include empty, malformed, cyclic, duplicate, partially reordered and deleted-source cases; retry returns the same imported ids/counts.
6. Existing document/card/review/answer-assessment migration tests and `cargo test` remain green. TypeScript and native migrations are not marked complete solely because the new tables exist.
