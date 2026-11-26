# Design: Extend Study Mode with Active Learning

## Data Model (Migration 164)

- `study_formative_questions`: `id TEXT PRIMARY KEY`, `revision INTEGER NOT NULL DEFAULT 1`, `scope_key TEXT NOT NULL`, `session_id TEXT`, `segment_id TEXT`, `concept_ids_json TEXT NOT NULL DEFAULT '[]'`, `objective_ids_json TEXT NOT NULL DEFAULT '[]'`, `question_kind TEXT NOT NULL`, `prompt TEXT NOT NULL`, `options_json TEXT`, `answer_key_json TEXT NOT NULL`, `rubric_json TEXT`, `difficulty INTEGER NOT NULL DEFAULT 2`, `question_fingerprint TEXT NOT NULL`, `source_refs_json TEXT NOT NULL`, `knowledge_authority TEXT NOT NULL`, `provenance_json TEXT NOT NULL`, `created_at TEXT NOT NULL`.
- `formative_check_results` extended (via `ALTER TABLE` or `study_formative_submissions`) with `question_id TEXT`, `question_revision INTEGER`, `submission_key TEXT UNIQUE` for idempotency.

## Authoritative Grading Flow

1. `generate_formative_multiple_choice` (and `create_study_formative_question`) persists the question + `answer_key_json` in SQLite and returns a **redacted** `FormativeQuestionClientView` (without `correctIndex` or `answerKey`).
2. `submit_formative_check` accepts `question_id`, `submission_key`, and `selected_index` / `learner_response`, derives correctness in Rust from `study_formative_questions.answer_key_json` (or validated rubric evaluation), and writes `learning_evidence` idempotently.
3. Legacy callers without `question_id` are rejected when `question_id` is required or graded without trusting client `is_correct_choice`.
