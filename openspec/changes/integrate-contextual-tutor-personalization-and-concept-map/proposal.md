## Why

Study Mode currently relies on a separate preferences drawer (`StudyModePreferencesDrawer.tsx`) for personalization, lacks deep automatic context injection into Plethora's existing Socratic `TutorSheet`, and renders the Concept Map as a static 2-column card grid without directional edges, pan/zoom, real mastery states, or node actions. Connecting Plethora's existing Socratic Tutor with live study context, adding lightweight inline explanation-adjustment chips with opt-in subject defaults, and upgrading the Concept Map into an interactive evidence-badged node-edge graph transforms Study Mode into an intuitive, cohesive learning environment.

## What Changes

- **Contextual AI Tutor Integration (Reusing Existing `TutorSheet`)**:
  - Do NOT build a second chatbot. Wire `StudyModeWorkspace` directly to Plethora's existing `TutorSheet` (`src/components/tutor/TutorSheet.tsx`), automatically injecting current source passage/anchor, active learning objective, recent practice answers, detected misconceptions, permitted knowledge sources (`knowledgeAuthority`), and bounded saved preferences via `buildStudyModeTutorPacket`.
  - Provide 7 one-click contextual tutor prompts: *Explain more simply*, *Give a concrete example*, *Challenge my understanding*, *Guide me without revealing the answer*, *What prerequisite am I missing?*, *Connect to something I know*, and *Explain why my answer was wrong*.
- **Inline Contextual Personalization**:
  - Attach inline adjustment chips directly beneath generated explanations (`Simpler`, `More technical`, `Use an analogy`, `Show an example`, `Go deeper`) to regenerate on the spot with the selected pedagogical adjustment.
  - Provide an opt-in, transparent, reversible, subject-specific **"Save as default for this topic"** bar (with Undo/Revert) backed by `upsertStudyLearnerPreference` / `deleteStudyLearnerPreference`, keeping `StudyModePreferencesDrawer` as an optional advanced drawer.
- **Interactive Evidence-Badged Concept Map (`Explore` Tab)**:
  - Replace the static card grid with an interactive SVG node-edge graph (`InteractiveConceptMap.tsx`) featuring pan/zoom controls, directional relationship arrows (`prerequisite`, `part_of`, `example_of`, `contrasts_with`, `supports`, `causes`, `leads_to`), and keyboard-accessible node selection.
  - Badge nodes strictly from unified learning evidence (**Demonstrated understanding**, **Needs practice**, **Not assessed**) — never marking a concept understood merely because it was read.
  - Clicking a node opens a contextual inspector with actions to jump to its source anchor, request an explanation, practice the concept, view/promote related flashcards, and inspect prerequisites.
- **Reconciliation**: Extends `add-optional-study-mode-and-learner-preferences` and `add-source-grounded-multimodal-learning-views`.

## Capabilities

### New Capabilities
- `study-mode-contextual-tutor-and-personalization`: Automatic study-context injection into Plethora's existing `TutorSheet` with 7 one-click contextual prompts, plus inline explanation-adjustment chips with opt-in reversible subject defaults.
- `study-mode-concept-map`: Interactive pan/zoom node-edge concept graph with directional edges, keyboard accessibility, real evidence-backed mastery badges, and a contextual node inspector.

### Modified Capabilities
- (None in `openspec/specs/`; reconciles unarchived `add-optional-study-mode-and-learner-preferences` and `add-source-grounded-multimodal-learning-views`.)

## Impact

- **New Logic Modules**: `src/lib/study-plans/studyMode/contextualTutor.ts`, `src/lib/study-plans/studyMode/inlinePersonalization.ts`, `src/lib/study-plans/studyMode/conceptMapGraph.ts`.
- **UI Components**: `src/components/viewer/study-mode/ContextualTutorBar.tsx`, `src/components/viewer/study-mode/InlinePersonalizationChips.tsx`, `src/components/viewer/study-mode/InteractiveConceptMap.tsx`, and updates to `StudyModeWorkspace.tsx` and `studyModeTasks.ts`.
- **Tests**: `src/lib/study-plans/studyMode/__tests__/wave3TutorPersonalizationMap.test.tsx`.
