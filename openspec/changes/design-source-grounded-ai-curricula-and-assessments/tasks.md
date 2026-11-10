# Tasks: Source-Grounded AI Curricula & Assessments

## 1. Schema Validation & Sanitization

- [ ] 1.1 Implement `validateGeneratedCard` in `src/lib/ai/schemas/recallQuestion.ts` enforcing valid cloze brackets and degrading 1-step items from `ordered-steps` to `qa`.
- [ ] 1.2 Update `src/features/assistant/chatFlashcardArtifacts.ts` to execute `validateGeneratedCard` before creating card artifacts.
- [ ] 1.3 Add Vitest unit tests in `src/lib/ai/schemas/__tests__/recallQuestion.validation.test.ts` testing cloze syntax, step thresholds, and fallback types.

## 2. Prompt Coherence & Step Classification

- [ ] 2.1 Refactor generation system prompt in `chatFlashcardArtifacts.ts` to demand strict question-answer semantic alignment and atomic focus.
- [ ] 2.2 Add unit test verifying that prompt templates require minimum 2 steps for sequential procedures.

## 3. Flashcard Studio Redirect Calibration

- [ ] 3.1 Update complexity determination logic in `src/components/review/studio/DraftCardList.tsx` to reserve Studio redirects exclusively for multi-deletion clozes, complex occlusions, and multi-line LaTeX.
- [ ] 3.2 Ensure standard Q&A cards render inline edit controls directly in Chat and Review.
- [ ] 3.3 Add component test in `src/components/review/studio/__tests__/DraftCardList.complexity.test.tsx` verifying simple Q&A cards do not show the Studio redirect banner.
- [ ] 3.4 Run `npm run bench:check` to ensure no performance regression.
