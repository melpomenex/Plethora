## 1. Contextual Tutor, Inline Personalization & Concept Map Core Modules

- [x] 1.1 Implement `src/lib/study-plans/studyMode/contextualTutor.ts` with `CONTEXTUAL_TUTOR_PROMPTS` (all 7 prompts) and `buildStudyModeTutorPacket` injecting passage/anchor, objective, recent practice answers, misconceptions, knowledge authority, and preferences.
- [x] 1.2 Implement `src/lib/study-plans/studyMode/inlinePersonalization.ts` defining the 5 inline adjustment chips (`Simpler`, `More technical`, `Use an analogy`, `Show an example`, `Go deeper`) and reversible subject-specific preference patch builders; extend `studyModeComponentTask` in `studyModeTasks.ts` to accept `styleAdjustment`.
- [x] 1.3 Implement deterministic layered graph layout and evidence-state mapping in `src/lib/study-plans/studyMode/conceptMapGraph.ts` (never marking read-only nodes as understood).

## 2. Contextual Tutor, Inline Chips & Interactive Concept Map UI

- [x] 2.1 Build `ContextualTutorBar` (`src/components/viewer/study-mode/ContextualTutorBar.tsx`) rendering the 7 one-click prompts and mounting Plethora's existing `TutorSheet` with the injected context packet.
- [x] 2.2 Build `InlinePersonalizationChips` (`src/components/viewer/study-mode/InlinePersonalizationChips.tsx`) attached to explanations with the opt-in, reversible "Save as default for this topic" + Undo bar.
- [x] 2.3 Build `InteractiveConceptMap` (`src/components/viewer/study-mode/InteractiveConceptMap.tsx`) with pan/zoom, directional labeled edges, keyboard-accessible node selection, real mastery badges, and contextual node inspector (jump to anchor, explain, practice, flashcards, prerequisites).
- [x] 2.4 Wire `ContextualTutorBar`, `InlinePersonalizationChips`, and `InteractiveConceptMap` into `StudyModeWorkspace.tsx`.

## 3. Verification & Tests

- [x] 3.1 Write unit and integration tests in `src/lib/study-plans/studyMode/__tests__/wave3TutorPersonalizationMap.test.tsx` covering tutor context injection, all 7 contextual prompts, inline chips + reversible subject defaults, concept map layout/pan/zoom/keyboard selection, honest mastery badges, and node inspector actions.
- [x] 3.2 Run `openspec validate`, `npx tsc --noEmit`, `npx eslint`, and `npx vitest run`.
