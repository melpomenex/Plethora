# Traceability Matrix: Source-Grounded AI Curricula & Assessments

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 09**: Shingles QA non-sequitur & 1-step ordered steps | `src/lib/ai/schemas/recallQuestion.ts:145` | `source-grounded-ai-curricula-and-assessments`: Syntactic and structural validation of generated cards | Tasks 1.1, 1.2, 2.1 | T01: Card schema validation suite |
| **Screenshot 10**: Malformed cloze missing `{{c1::...}}` | `src/features/assistant/chatFlashcardArtifacts.ts:188` | `source-grounded-ai-curricula-and-assessments`: Syntactic and structural validation of generated cards | Tasks 1.1, 1.3 | T01: Card schema validation suite |
| **Screenshot 11**: Simple QA flagged as complex / Studio redirect | `src/components/review/studio/DraftCardList.tsx:120` | `source-grounded-ai-curricula-and-assessments`: Accurate card complexity classification | Tasks 3.1, 3.2, 3.3 | T02: Complexity routing test |
