# Proposal: Add Source-Grounded Multimodal Learning Views

## Problem Statement

Learners benefit from complementary representations—educational mind maps, interactive timelines/sequences/diagrams, conversational audio lessons, and narrated slide decks—when grounded in the same canonical instructional scope and generated strictly on demand. Currently, Knowledge Graph projections are library-wide only, Audio Editions only read verbatim document text, and there are no structured timelines, diagrams, or native narrated slides.

## Goals

1. **Educational Mind Maps**: Bounded, source-scoped concept map projections reusing `concepts`/`concept_links` + `ConceptMasterySummary` (with explicit `not-assessed` state), without silently mutating the user's personal Knowledge Graph.
2. **Interactive Timelines, Sequences & Diagrams**: Deterministic SVG/DOM rendering from validated structured schemas (never executing model-generated HTML/JS), with source links and ordering exercises.
3. **Conversational Audio Lessons**: Extend Audio Editions & TTS (`src/api/tts/`, `audioPlaybackStore.ts`) to synthesize verified single-speaker or teacher/student conversational lesson scripts on demand, with script-first verification and explicit misconception correction.
4. **Narrated Slide Lessons**: Lightweight native slide deck view with concise source-linked content, complementary narration script, TTS playback, and keyboard accessibility, generated strictly on demand.

## Dependencies

- `consolidate-study-mode-learning-foundation`, `implement-pedagogical-content-verification`, `add-optional-study-mode-and-learner-preferences`, `knowledge-graph`, `audio-editions`.

## Non-Goals / Out of Scope

- Generative image-model illustration pipelines (explicitly deprioritized per LearnLM paper findings).
- Automatic precomputation of audio or slides on document open.
