## Why

Currently `DocumentViewer.tsx` passes raw `currentDocument.content ?? ""` to Study Mode, which is empty, stale, or unparsed HTML for PDFs, EPUBs, videos, and audiobooks, and passes inaccurate locators (e.g., `kind: "text"` for EPUBs and videos). Meanwhile, `scopeKey.ts` bakes `sourceRevision` into `scope_key` (breaking `mark_scope_artifacts_stale` and prior-revision history), `study_mode_sessions` lacks a `scope_key` column (causing multi-scope session collisions on the same document), and `submit_formative_answer` in Rust has a schema mismatch when inserting into `learning_evidence` so formative evidence is silently dropped.

Study Mode requires accurate, source-aware study scopes, bounded model context assembly, revision-independent canonical scope identity, verified citation navigation into the canonical reader, and working backend evidence persistence.

## What Changes

- **Source-Aware Study Scopes**: Add an unobtrusive scope selector supporting meaningful scopes for the active source (`current_section`, `current_chapter`, `selected_passage`, `pdf_page_range`, `media_segment`, `entire_document`, `study_plan_assignment`) with sensible defaults based on entry point.
- **Canonical Source Context & Bounded Model Evidence**: Introduce a shared `resolveStudySourceContext` pipeline reusing Plethora's existing `useDocumentOutlineStore`, `pdfContextText` / `pdfOcrContextText`, `videoContext.transcript`, `ExactSearchHitLocation`, and token-budgeted chunk selection so large books/PDFs/transcripts never dump raw full-document text into AI prompts.
- **Revision-Independent Stable Scope Identity & Session Persistence**:
  - Keep `scope_key` deterministic and revision-independent (incorporating document/plan/topic/segment, scope kind, and canonical scope identity) while storing `source_revision` in its dedicated column so `mark_scope_artifacts_stale` and prior-revision Artifact History work accurately.
  - Add SQLite migration `166_study_mode_session_scope_key` adding `scope_key` (and index) to `study_mode_sessions` so distinct scopes on the same document maintain independent sessions.
  - Preserve legacy document-wide artifacts without misclassifying them as chapter- or passage-specific verified artifacts.
- **Fix Formative Learning Evidence Persistence (Rust)**: Repair the SQLite `INSERT INTO learning_evidence` in `src-tauri/src/database/study_mode_repository.rs` to match migration 143's schema (`concept_label`, `observed_score`, `outcome`, `hint_level`, `learner_confidence`, `occurred_at`, `updated_at`, `source_kind = 'practice-check'`) so formative submissions reliably update mastery and knowledge gaps.
- **Canonical Citation Navigation & Knowledge Authority**: Wire `onJumpToSource` from `StudyModeWorkspace` through `DocumentViewerWrapper` to `DocumentViewer`'s canonical jump/highlight mechanisms across EPUB, PDF, HTML, Markdown, YouTube, Video, and Audio, with clear recovery when an anchor cannot be resolved.

## Capabilities

### New Capabilities
- `study-mode-source-scopes`: Source-aware scope selector, bounded context assembly with token budgeting and provider-consent preservation, revision-independent canonical `scope_key` + session `scope_key` migration, repaired `learning_evidence` recording, and verified citation navigation into the canonical reader.

### Modified Capabilities
- (None archived in `openspec/specs/`; reconciles the `sourceRevision`-in-`scope_key` contradiction in the unarchived `redesign-study-mode-foundation-and-workspace/specs/study-mode-session-grounding/spec.md`.)

## Dependencies

- Depends on `refactor-study-mode-workspace`.

## Non-Goals

- Creating a new parallel source-anchor type incompatible with `ExactSearchHitLocation`.
- Auto-running external web research in `source-only` mode.
- Silently broadening cloud provider authorization on scope changes.

## Impact

- **Frontend Source Resolution**: New `src/lib/study-plans/studyMode/sourceScopeResolver.ts`, updates to `src/lib/study-plans/studyMode/scopeKey.ts`, `src/types/studyMode.ts`, `src/api/study-mode.ts`, `src/components/viewer/DocumentViewerWrapper.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/StudyModeWorkspace.tsx`.
- **Backend (Rust/SQLite)**: `src-tauri/src/database/migrations.rs` (migration 166), `src-tauri/src/models/study_mode.rs`, `src-tauri/src/database/study_mode_repository.rs`, `src-tauri/src/commands/study_mode.rs`.
