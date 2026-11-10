## Why

AI flashcard and curricula generation is only as valuable as the pedagogical quality of the synthesized items. Currently, AI card generation frequently produces non-sequitur Q&A pairs (e.g. asking why older adults get shingles but answering that the disease is more severe, screenshot 09), misclassifies single Q&A items as "Ordered steps" (screenshot 09), generates cloze cards missing mandatory `{{c1::...}}` syntax (screenshot 10), and flags ordinary simple Q&A cards as complex, forcing users into an unnecessary Flashcard Studio redirect (`screenshot_11`). Establishing strict source-grounded card validation and complexity classification ensures that generated study items are atomic, accurate, and easy to review.

## What Changes

- Implement rigorous pre-presentation validation for AI-generated cards in `recallQuestion.ts` and `chatFlashcardArtifacts.ts`:
  - Validate that cloze cards contain valid, non-empty `{{c1::...}}` syntax.
  - Enforce that "Ordered steps" card types require at least 2 distinct sequential steps; classify single items as standard Q&A.
  - Perform semantic question-answer alignment validation, discarding non-sequitur pairs.
- Calibrate complexity thresholds in `DraftCardList.tsx` so simple Q&A cards remain inline without triggering Flashcard Studio redirects.
- Ground all generated cards in verified source passage spans, attaching citation handles and text offsets.

## Capabilities

### New Capabilities

- `source-grounded-ai-curricula-and-assessments`: Syntactic and semantic validation of AI-generated study cards, minimum-step enforcement for procedural cards, and accurate card complexity routing.

### Modified Capabilities

- `queue-flashcard-review-cards`: Validate cloze and QA schemas before saving to queue.
- `flashcard-studio-section-mentions`: Reserve Flashcard Studio routing strictly for multi-step or complex card editing.

## Impact

- **Frontend**: `src/lib/ai/schemas/recallQuestion.ts`, `src/features/assistant/chatFlashcardArtifacts.ts`, `src/components/review/studio/DraftCardList.tsx`, `src/components/review/useCardAnswerAssessment.ts`.
- **Invariants**: Valid existing cards remain untouched. Card generation respects token budgets and provider privacy settings.
