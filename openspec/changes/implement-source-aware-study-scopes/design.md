## Context

Previously, `DocumentViewer.tsx` passed `currentDocument.content ?? ""` to `StudyModeWorkspace`, and `scopeKey.ts` embedded `rev:<sourceRevision>` inside `scope_key`. In SQLite, `study_mode_sessions` lacked a `scope_key` column, and `study_mode_repository.rs:submit_formative_answer` attempted to insert into non-existent columns of `learning_evidence`.

## Goals / Non-Goals

**Goals:**
- Resolve accurate, bounded source text and canonical `ExactSearchHitLocation` anchors across EPUB, PDF, HTML, Markdown, Plain Text, YouTube, Video, Audio, and Study Plan assignments.
- Expose only meaningful scope options for the current document type (e.g., PDF page/range for PDFs, chapters/sections when outline/headings exist, media segment for video/audio, selected passage when text is selected, Study Plan assignment when launched from a Study Plan).
- Enforce token/character budgets (`<= 6000` chars default, configurable by provider limit) with deterministic heading/passage windowing and honest coverage notices when studying an entire large document.
- Make `scope_key` revision-independent so `mark_scope_artifacts_stale(scope_key, currentRevision)` properly detects and flags stale artifacts when a source changes.
- Add `scope_key` to `study_mode_sessions` (migration 166) and fix `learning_evidence` insertion in `submit_formative_answer`.

**Non-Goals:**
- Rewriting Plethora's embedding/RAG indexing pipeline.
- Modifying `learning_evidence` table schema (migration 143 is authoritative).

## Decisions

1. **Scope Taxonomy**: Extend `StudyModeScopeKind` with `"current_section" | "current_chapter" | "pdf_page_range" | "media_segment"` while preserving `"standalone_document" | "standalone_selection" | "study_plan_topic" | "study_plan_segment"` for backward compatibility with existing DB rows and tests.
2. **Revision-Independent `scope_key`**: Remove `rev:` from `buildStudyScopeKey` (keeping an optional legacy matcher only if needed for read-only fallback) and pass `sourceRevision` separately on artifacts/sessions. On scope load, if persisted artifacts have `sourceRevision !== currentSourceRevision`, mark them stale cleanly.
3. **Migration 166 (`166_study_mode_session_scope_key`)**: `ALTER TABLE study_mode_sessions ADD COLUMN scope_key TEXT;` + `CREATE INDEX IF NOT EXISTS idx_study_mode_sessions_scope_key ON study_mode_sessions(scope_key, updated_at DESC);`. Relax the `scope_kind` check constraint only if needed or map sub-scopes cleanly while storing canonical `scope_key` on `study_mode_sessions` (mapping new frontend sub-scopes to `standalone_selection` or `standalone_document` if SQLite CHECK constraint is kept, OR migrating the table cleanly—keeping `scope_kind` CHECK compatible while `scope_key` carries the exact scope identity avoids table-rebuild risk in SQLite!). That's a super clean, zero-risk migration decision!
4. **Evidence Recording Fix**: In `study_mode_repository.rs:submit_formative_answer`, insert into `learning_evidence` using the exact migration-143 columns: `(id, concept_id, concept_label, plan_id, node_id, source_kind, source_id, grade_id, evidence_group_id, question_fingerprint, observed_score, outcome, misconception, learner_confidence, hint_level, grader_origin, occurred_at, policy_version, created_at, updated_at)` with `source_kind = 'practice-check'` and mapped outcome (`correct` | `partial` | `incorrect` | `misconception`), and add a Rust unit test asserting `res.evidence_recorded == true` and verifying the row in `learning_evidence`!
5. **Citation Navigation**: Clicking any citation chip or timeline/concept-map/slide anchor calls `onJumpToSource(quote, locator)`, which opens `"with-source"` (if in focused Study Mode) and invokes `DocumentViewer`'s canonical jump handler (`initialJump` / EPUB CFI / PDF page + highlight / HTML/MD scroll + quote highlight / media seek), showing an honest non-blocking notice if the anchor cannot be resolved.

## Performance & Privacy

- Scope resolution computes from already-loaded reader context (outline store, live PDF text window, transcript, HTML/MD text) without triggering full-book re-extraction.
- Changing scopes never alters `localOnlyPreferred` or cloud-consent boundaries.
