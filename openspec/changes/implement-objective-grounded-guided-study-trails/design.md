# Design: Concept-Grounded Guided Reading and Adaptive Study Trails

## Current Architecture Analysis

- **Study Plans (`src-tauri/src/database/study_plan_repository.rs`, `src/components/study-plans/StudyPlanEditor.tsx`)**: Versioned plans (`draft` / `published`), `study_plan_nodes`, `study_plan_prerequisites` DAG, `study_source_refs`, `study_plan_node_activity`. `StudyPlanEditor` currently switches between `List` (`PlanOutline`) and `Graph` (`StudyPlanGraphView`).
- **Existing Reading Trail (`src-tauri/src/database/study_reading_repository.rs`, `src/lib/study-plans/reading/`)**: Migration 153 (`study_reading_trails`) stores a JSON manifest + session. `generateReadingManifest.ts` expands `topic.sourceRefIds` by ±240 chars. `useStudyTrailReader.ts` + `readerAdapters.ts` + `resolveReadingRange.ts` + `paintReadingPassage.ts` resolve and highlight ranges in EPUB, PDF, HTML, and Markdown viewers, with `StudyTrailControls.tsx` in the reader header.
- **Chunking & Retrieval (`src-tauri/src/ai_learning/chunker.rs`, `retrieval.rs`)**: Heading-aware chunker (`700–900` chars) and FTS5 + vector retrieval. Lacks structural classification (TOC/bibliography/index/front-matter exclusion), section-level expansion, and instructional quality evaluation.
- **Lessons, Assessments & Evidence (`study_lessons.rs`, `assessment_blueprints.rs`, `exam_sessions.rs`, `learning_evidence.rs`)**: Resumable lessons, immutable exam revisions, rubric grading, and `learning_gaps` / `WeakTopicWorkspace.tsx`.

## Proposed Architecture

### 1. Data Model (Migration `154_guided_study_trails`)
Additive SQLite tables:
- `learning_segments`: Durable, revision-tracked instructional range (`id`, `document_id`, `document_revision`, `format`, `title`, `parent_section_label`, `start_locator_json`, `end_locator_json`, `start_offset`, `end_offset`, `excerpt_preview`, `word_count`, `estimated_duration_seconds`, `structural_class`, `instructional_role`, `quality_score`, `quality_rationale`, `validation_status`, `readiness_status`, `generator_version`, `schema_version`, `provenance_json`, `created_at`, `updated_at`).
- `learning_segment_objectives`: Many-to-many link (`id`, `plan_id`, `version_id`, `node_id`, `objective_index`, `segment_id`, `coverage_status`, `alignment_score`, `selection_rationale`, `is_primary`, `is_required`, `authored_override`, `created_at`, `updated_at`).
- `study_trail_items`: Ordered learner assignments (`id`, `plan_id`, `version_id`, `node_id`, `objective_index`, `segment_id`, `trail_order`, `session_group_id`, `status`, `reading_progress`, `last_locator_json`, `is_required`, `is_remediation`, `remediation_gap_id`, `manual_order_override`, `rejected_reason`, `planner_rationale`, `updated_at`).
- `formative_check_results`: Formative comprehension check records (`id`, `plan_id`, `version_id`, `trail_item_id`, `node_id`, `objective_index`, `prompt_format`, `prompt_text`, `learner_response`, `outcome`, `feedback`, `recommended_segment_id`, `created_at`), strictly isolated from `exam_grades` and FSRS.

### 2. Instructional Retrieval Pipeline (`src-tauri/src/study_trail/`)
Progressive deterministic-first pipeline:
1. **Structural Document Analysis (`structural_analyzer.rs`)**: Parses format-native structure (Markdown ATX headings, HTML DOM/headings, PDF pages/headers/footers/TOC/bibliography/index, EPUB spine/headings, Plain text, Transcripts) into `StructuralUnit`s with canonical offsets and hierarchy.
2. **Instructional-Content Classification (`content_classifier.rs`)**: Deterministically classifies and excludes `toc`, `bibliography`, `index`, `front_matter`, `heading_only`, `running_header_footer`, and `incidental_mention` (with explicit contextual exception support, e.g., bibliography in research-methods topics).
3. **Candidate Discovery & Section Expansion (`retrieval_pipeline.rs`)**: Uses lexical/vector retrieval on non-excluded units, expands candidates to coherent paragraph/section boundaries (targeting ~5–15 min reading without splitting arguments), merges adjacent ranges, scores instructional quality (`quality_score`, `quality_rationale`), rejects all candidates if none teach the objective, and computes per-objective coverage (`adequately_covered`, `partially_covered`, `multi_segment`, `insufficient`, `no_match`, `source_unavailable`, `revision_changed`).

### 3. Prerequisite-Aware Trail Planner (`planner.rs`)
Uses `study_plan_prerequisites` DAG to compute topological Concept Order, inspects Source Order (`document_id`, `start_offset`), and produces Study Order:
- Respects all prerequisite dependencies.
- Prefers source continuity when prerequisites allow; groups adjacent sections of the same document into a `session_group_id`.
- Deduplicates shared `LearningSegment`s so learners do not reread the same passage unnecessarily.
- Preserves `authored_override` and `manual_order_override` across regeneration.

### 4. Learning Progression State Machine & Eligibility (`eligibility.rs`)
- `StudyTrailItem.status`: `pending` -> `in_progress` -> `reading_completed` -> `check_passed` | `check_needs_review` (or `skipped` / `deferred`).
- `AssessmentEligibilityPolicy`: `guided` (required segments + formative checks completed), `assessment-first` (allows test-out via formal/diagnostic assessment), `open` (advisory recommendations).

### 5. Privacy, Security & Performance
- Enforces `is_ai_excluded`, `is_local_only`, `sourceScope`, and `knowledgeAuthority` (`library` vs `model-only` vs `manual`).
- Precomputes and caches `LearningSegment`s per `(document_id, document_revision)` in SQLite so `Open Study Plan -> Continue Learning -> Open Reader` requires zero live LLM inference.
- Untrusted source text is never treated as instructions.
