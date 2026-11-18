# Proposal: Implement Concept-Grounded Guided Reading and Adaptive Study Trails

## Problem Statement

Plethora's Study Plans system currently supports curriculum DAGs, prerequisite relationships, source citations (`study_source_refs`), lessons, Socratic tutoring, formal assessments, and assessment-driven learning gaps. However, its existing Guided Reading Trail (`study_reading_trails` / `generateReadingManifest.ts`) merely takes `topic.sourceRefIds`—the citations attached during curriculum generation—and expands each excerpt by ±240 characters inside a single `semantic_chunks` row.

As a result, learners are frequently directed to tables of contents, bibliographies, indexes, publisher metadata, bare chapter headings, superficial keyword mentions, or arbitrary embedding chunks that lack surrounding context and do not actually teach the target learning objective. Architecturally, the system conflates five distinct entities: (1) a source citation, (2) a prerequisite relationship, (3) a coherent instructional source section (`LearningSegment`), (4) a learner's study assignment (`StudyTrailItem`), and (5) evidence of understanding (formative checks vs. formal assessments).

## Goals

1. **First-Class `LearningSegment` Entity**: Introduce a durable, versioned, revision-tracked SQLite abstraction representing coherent instructional ranges within sources, supporting many-to-many relationships with learning objectives and concepts.
2. **Source-Structure-Aware Instructional Retrieval Pipeline**: Analyze document structure per format (EPUB, PDF, HTML, Markdown, Plain Text, Transcripts), deterministically classify and exclude non-instructional regions (TOC, bibliography, index, front matter, running headers/footers, bare headings, incidental mentions) with contextual exception support, expand candidates to coherent section/paragraph boundaries, evaluate instructional quality, and validate per-objective coverage (`adequately_covered`, `partially_covered`, `multi_segment`, `insufficient`, `no_match`, `source_unavailable`, `revision_changed`).
3. **Prerequisite-Aware Study Trail Planner**: Convert the authoritative `study_plan_prerequisites` DAG + validated `LearningSegment`s into an ordered Study Trail that distinguishes Concept Order, Source Order, and Study Order, groups adjacent sections into coherent sessions, deduplicates shared segments, and respects manual overrides.
4. **First-Class Study Queue UX**: Add a primary **Study Queue** mode alongside List and Graph in `StudyPlanEditor`, featuring a prominent **Continue Learning** card, prerequisite readiness, duration estimates, rationale, alternative sources, and full assignment actions.
5. **Format-Agnostic Guided Reading Mode**: Upgrade `DocumentViewer` + `useStudyTrailReader` with a responsive contextual Study Trail panel (desktop side panel / mobile compact sheet), restrained start/end boundary indicators, range progress tracking, persistent resume locators, Socratic tutor/notes access, and support for EPUB, PDF, HTML, Markdown, Plain Text, and transcript-backed media.
6. **Formative Comprehension Checks, Assessment Eligibility, and Adaptive Remediation**: Connect completed reading assignments to brief, objective-aligned formative checks (without mutating formal assessment grades or FSRS items), configurable assessment eligibility policies (`guided`, `assessment-first`, `open`), and targeted `LearningSegment` remediation on failed objectives.
7. **Authoring, Inspection, and Correction UX**: Provide a **Preview Study Trail** interface to inspect, accept, reject, replace, expand/contract, manually select, reorder, and per-objective regenerate assignments while preserving manual overrides.

## Non-Goals

- Replacing the existing `study_plan_prerequisites` DAG or curriculum graph (`StudyPlanGraphView`).
- Creating a separate document renderer outside `DocumentViewer`.
- Replacing or mutating the formal `assessment_blueprints` / `exam_attempts` / `exam_grades` engine or FSRS scheduling.
- Uploading full documents silently to cloud models or running unbounded LLM loops.
