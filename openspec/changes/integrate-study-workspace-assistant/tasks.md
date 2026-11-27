## 1. Study-Aware Assistant Context & Hosting
- [x] 1.1 Create `src/lib/study-plans/studyMode/studyAssistantContext.ts` to assemble bounded study context for `AssistantPanel` / `MobileAssistantHost` while strictly stripping unanswered formative answer keys and rubrics.
- [x] 1.2 Coordinate `AssistantPanel` and `useRegisterMobileAssistant` in `DocumentViewerWrapper.tsx` with `DocumentPresentationMode` and `StudyWorkspaceLayout`, preserving conversation history across transitions.
- [x] 1.3 Wire contextual "Ask Assistant" actions from Learn, Practice feedback, and Concept Map nodes to open `"with-assistant"` with study context attached.

## 2. Socratic Tutor, Study Plans, Study Trails & Promotion
- [x] 2.1 Suppress `GuidedReadingPanel` while Study Mode owns the document workspace and surface compact Study Trail context/navigation in the Study Mode header when a Study Trail is active.
- [x] 2.2 Pass active `studyPlanContext` (`planId`, `versionId`, `topicId`, `segmentId`) from `DocumentViewer` / `useStudyTrail` into `StudyModeWorkspace`.
- [x] 2.3 Verify Socratic Tutor (`TutorSheet`) launch from Learn, Practice remediation, Concept Map nodes, and Progress recommendations preserves tutor state and authority boundaries.
- [x] 2.4 Wire explicit flashcard promotion to `FlashcardStudioModal` and verify FSRS scheduling is untouched by formative practice.
