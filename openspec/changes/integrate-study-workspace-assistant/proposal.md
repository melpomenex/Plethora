## Why

In the current architecture, `AssistantPanel` sits permanently alongside `DocumentViewer` while `StudyModeWorkspace` opens as a separate competing panel and launches `TutorSheet` independently—causing visual clutter, uncoordinated panels, and an Assistant that has no awareness of the user's active Study Mode scope, active artifact, or current learning activity. Meanwhile, `GuidedReadingPanel` (Study Trail) and `StudyModeWorkspace` can render simultaneously as competing learning panels.

Study Mode must integrate cleanly with Plethora's existing Assistant, Learning Agent, Socratic Tutor, Study Plans, Study Trails, and Flashcard promotion workflows without creating a second chat engine or competing panels.

## What Changes

- **Reuse Existing Assistant Infrastructure**: When Study Mode is entered, preserve existing Assistant conversation history and hide the Assistant by default (`"focused"` layout), storing prior visibility so Read Mode restores it on exit. Allow explicit toggle into `"with-assistant"` layout, which reuses `AssistantPanel` (and `MobileAssistantHost` on mobile) and replaces `"with-source"` rather than adding a third column.
- **Study-Aware Bounded Assistant Context**: Enrich `AssistantContext` when in Study Mode with bounded study context (active scope label, bounded scope excerpt, active learning activity/tab, active artifact summary, selected concept map node, knowledge authority, Study Plan context) while strictly excluding hidden formative answer keys and avoiding full-document injection.
- **Contextual Study → Assistant Actions**: Expose contextual actions (Explain differently, Another example, Understand my mistake, Ask a follow-up, Compare with source, Create flashcard) that route through Plethora's existing Assistant / Socratic Tutor / FlashcardStudioModal workflows.
- **Socratic Tutor & Study Plan / Study Trail Coordination**:
  - Wire Socratic Tutor invocation from Learn, incorrect Practice answers, weak concept remediation, Concept Map nodes, and Progress recommendations.
  - Suspend `GuidedReadingPanel` while Study Mode owns the workspace and surface Study Trail navigation (previous/next assigned passage, return to Study Trail) cleanly inside the Study Mode header when a Study Trail is active.
  - Preserve Study Plan identity (`planId`, `versionId`, `topicId`, `segmentId`), authorized passages, and FSRS isolation.

## Capabilities

### New Capabilities
- `study-workspace-assistant-integration`: Coordinated `AssistantPanel` / `MobileAssistantHost` hosting in `"with-assistant"` layout, bounded study-aware `AssistantContext` with answer-key protection, Socratic Tutor entry points, Study Trail / Study Plan coordination, and explicit flashcard promotion.

### Modified Capabilities
- (None archived in `openspec/specs/`.)

## Dependencies

- Depends on `refactor-study-mode-workspace` and `implement-source-aware-study-scopes`.

## Non-Goals

- Building a separate Study Mode chat UI or independent conversation database.
- Auto-creating flashcards or modifying FSRS scheduling on formative practice completion.
- Leaking formative question answer keys or rubrics into Assistant context.

## Impact

- **Assistant & Context**: `src/components/viewer/DocumentViewerWrapper.tsx`, `src/lib/study-plans/studyMode/studyAssistantContext.ts` (new), `src/components/viewer/StudyModeWorkspace.tsx`.
- **Tutor, Study Trails & Promotion**: `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/study-mode/ContextualTutorBar.tsx`, `src/components/viewer/study-mode/PracticePanel.tsx`, `src/components/viewer/study-mode/InteractiveConceptMap.tsx`.
