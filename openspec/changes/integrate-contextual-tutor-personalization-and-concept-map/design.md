## Context

Wave 1 delivered the 4-tab, 3-pane workspace and Wave 2 delivered the Guided Loop, adaptive Practice Engine, and unified Evidence Progress. Wave 3 connects Study Mode to Plethora's existing Socratic `TutorSheet`, brings personalization inline onto explanations, and upgrades the `Explore` Concept Map from a static grid into an interactive node-edge graph.

## Goals / Non-Goals

**Goals:**
- Reuse Plethora's existing `TutorSheet` (`src/components/tutor/TutorSheet.tsx`) via a clean `buildStudyModeTutorPacket` adapter with 7 one-click contextual prompts.
- Add inline adjustment chips (`Simpler`, `More technical`, `Use an analogy`, `Show an example`, `Go deeper`) with opt-in, reversible subject-specific saving.
- Build a lightweight, zero-new-dependency interactive SVG Concept Map (`InteractiveConceptMap.tsx`) with deterministic layered layout (`conceptMapGraph.ts`), pan/zoom, keyboard navigation, real evidence-based mastery badges, and a contextual node inspector.

**Non-Goals:**
- Adding a heavy third-party graph library (Plethora already builds clean interactive SVG graphs in `StudyPlanGraphView.tsx`, and a deterministic layered SVG layout keeps bundle size tiny and 100% theme-aware).
- Playable TTS audio and narrated slides (Wave 4).

## Decisions

### 1. Contextual Tutor Injection (`src/lib/study-plans/studyMode/contextualTutor.ts`)
- Builds a bounded `StudyModeTutorPacket` (`topic`, `material`, `initialPrompt`, `studyContext`) injecting:
  - Active passage/selection excerpt + active anchor quote
  - Active learning objective
  - Last 3 practice attempts & detected misconceptions
  - Permitted knowledge authority & authorized source IDs
  - Bounded learner preferences
- Exposes the 7 required one-click prompts as `CONTEXTUAL_TUTOR_PROMPTS`.
- Launches Plethora's existing `TutorSheet` directly (or calls `onOpenTutor` if the host overrides it).

### 2. Inline Personalization (`src/lib/study-plans/studyMode/inlinePersonalization.ts`)
- Maps each adjustment chip (`simpler`, `more_technical`, `use_analogy`, `show_example`, `go_deeper`) to:
  - Prompt adjustment directive passed to `studyModeComponentTask`
  - Equivalent `StudyLearnerPreference` patch (`vocabularyTolerance`, `explanationDetail`, `teachingApproach`, `examplePreference`)
- Applying a chip regenerates the explanation immediately and reveals a subtle, transparent `"Save '<label>' as default for <subject>"` button.
- Clicking Save persists via `upsertStudyLearnerPreference` and shows an immediate `"Undo"` button that restores the previous preference snapshot (or deletes the subject override if none existed).

### 3. Interactive Concept Map (`src/lib/study-plans/studyMode/conceptMapGraph.ts` + `InteractiveConceptMap.tsx`)
- Deterministic topological/layered layout algorithm placing prerequisite nodes earlier (left-to-right / top-to-bottom) with clean non-overlapping coordinates and directional SVG `<marker>` arrows + relation labels.
- Maps each node against `StudyProgressSnapshot.concepts` (matching by ID or normalized label):
  - `demonstrated-consistently` → **Demonstrated understanding** (primary solid/ring)
  - `needs-attention` → **Needs practice** (destructive accent)
  - Everything else (including read-only exposure) → **Not assessed** (neutral muted)
- Interactive SVG canvas supports drag-to-pan, Zoom In / Zoom Out / Reset Fit buttons, and keyboard focus/selection on every node `<g role="button" tabIndex={0}>`.
- Contextual Inspector panel below/beside the graph shows node definition, mastery badge, prerequisites (clickable to focus prerequisite node), source anchor jump, "Explain Concept", "Practice Concept", and "Promote Flashcard".
