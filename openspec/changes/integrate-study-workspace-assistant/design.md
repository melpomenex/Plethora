## Context

`DocumentViewerWrapper.tsx` already builds `AssistantContext` and renders `AssistantPanel` (desktop) and registers `useRegisterMobileAssistant` (mobile). `StudyModeWorkspace.tsx` mounts `TutorSheet` and `ContextualTutorBar` directly. `DocumentViewer.tsx` mounts `GuidedReadingPanel` whenever `hasStudyTrailControls` is true, even while `StudyModeWorkspace` is open.

## Goals / Non-Goals

**Goals:**
- Coordinate `AssistantPanel` visibility with `StudyWorkspaceLayout`: hidden in `"focused"` and `"with-source"`, shown alongside `StudyModeWorkspace` in `"with-assistant"`, with existing conversation state untouched.
- Enrich `AssistantContext` with a bounded `studyWorkspaceContext` summary (current scope, active tab/activity, active artifact excerpt, selected concept node, knowledge authority, and Study Plan metadata) — strictly stripping `answerKey`, `correctIndex`, `expectedBlanks`, `correctOrder`, and `requiredKeyFacts` while a practice question is unanswered!
- Allow contextual actions in `StudyModeWorkspace` (e.g., "Ask Assistant about this", "Help me understand my mistake") to open `"with-assistant"` or launch `TutorSheet` with prefilled context.
- Suppress `GuidedReadingPanel` while Study Mode owns the document workspace and expose Study Trail previous/next passage controls in the Study Mode workspace header when `studyRequest` is active.

**Non-Goals:**
- Changing `AssistantPanel`'s conversation storage format or provider routing.
- Duplicating `TutorSheet` or `FlashcardStudioModal`.

## Decisions

1. **Answer-Key Protection**: A pure helper `buildStudyAssistantContext` in `src/lib/study-plans/studyMode/studyAssistantContext.ts` builds the bounded study prompt context (`<= 2400` chars) and explicitly omits any active unanswered question's answer key, correct index, expected blanks, or rubric facts. Only post-submission feedback/misconception is eligible to be shared.
2. **Layout Coordination**: `DocumentViewerWrapper` renders `AssistantPanel` when `presentationMode === "read"` (normal behavior) OR when `presentationMode === "study" && studyLayout === "with-assistant"`. Entering `"study"` never deletes or resets `AssistantPanel`'s stored conversation snapshot.
3. **Study Trail Coordination**: When `presentationMode === "study"` and `studyRequest` is active, `DocumentViewer` hides `GuidedReadingPanel` so there is no competing side panel, and `StudyModeWorkspace` displays compact Study Trail context (topic/segment label + Prev/Next assigned passage actions wired to `useStudyTrail`).
4. **Explicit Promotion**: Flashcard promotion actions across Practice, Guided Loop, and Concept Map invoke `onPromoteFlashcard(prompt, explanation)`, which opens `FlashcardStudioModal` with seeded draft content—never auto-creating cards or mutating FSRS.
