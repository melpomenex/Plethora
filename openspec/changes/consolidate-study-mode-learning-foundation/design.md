# Design: Consolidate Study Mode Learning Foundation

## Data Model Changes (Migration 162)

- `study_mode_sessions`: `id TEXT PRIMARY KEY`, `scope_kind TEXT NOT NULL` (`standalone_document | standalone_selection | study_plan_topic | study_plan_segment`), `document_id TEXT`, `study_plan_id TEXT`, `plan_version_id TEXT`, `topic_id TEXT`, `segment_id TEXT`, `source_revision TEXT NOT NULL`, `knowledge_authority TEXT NOT NULL DEFAULT 'source-only'`, `active_view TEXT NOT NULL DEFAULT 'learn'`, `last_locator_json TEXT`, `status TEXT NOT NULL DEFAULT 'active'`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.
- `study_mode_artifacts`: `id TEXT PRIMARY KEY`, `session_id TEXT REFERENCES study_mode_sessions(id) ON DELETE CASCADE`, `artifact_type TEXT NOT NULL`, `schema_version INTEGER NOT NULL DEFAULT 1`, `scope_key TEXT NOT NULL`, `source_ids_json TEXT NOT NULL`, `source_revision TEXT NOT NULL`, `anchors_json TEXT NOT NULL`, `segment_ids_json TEXT NOT NULL`, `concept_ids_json TEXT NOT NULL`, `objective_ids_json TEXT NOT NULL`, `plan_id TEXT`, `plan_version_id TEXT`, `preference_fingerprint TEXT NOT NULL DEFAULT ''`, `task_id TEXT NOT NULL`, `task_version TEXT NOT NULL`, `prompt_version TEXT NOT NULL`, `provider_id TEXT`, `model_id TEXT`, `knowledge_authority TEXT NOT NULL`, `validation_status TEXT NOT NULL`, `quality_eval_json TEXT`, `payload_json TEXT NOT NULL`, `is_stale INTEGER NOT NULL DEFAULT 0`, `is_locked INTEGER NOT NULL DEFAULT 0`, `dismissed INTEGER NOT NULL DEFAULT 0`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.

## Architecture & Migration

- **System A -> System B Bridge**: On `get_study_trail_overview`, if `study_trail_items` is empty for a version that has authored `study_reading_trails`, backfill authored assignments into `learning_segments` + `study_trail_items` (`authored_override = 1`) without deleting legacy `study_reading_trails` rows.
- **Source Grounding Fixes**: Apply `disambiguate_duplicate_chunk_ids` in `study_source_repository.rs` rich-text projection so `#occ:N` chunks verify cleanly; decode HTML entities in `html_plain_text` parity checks; respect `selected.extractIds` in `generate_study_trail_segments_core`.
- **Privacy & Failure Handling**: Fail closed if any source is `is_ai_excluded` or `strict_local_only` conflicts with route; preserve historical artifacts as `is_stale = 1` when `source_revision` changes.
