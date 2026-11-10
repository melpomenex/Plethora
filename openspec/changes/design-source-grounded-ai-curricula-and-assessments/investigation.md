# Technical Investigation: Source-Grounded AI Curricula & Assessments

## 1. Problem Evidence

1. **Screenshot 09**: AI generated a Shingles Q&A card where the question asked why older adults get shingles, but the answer stated that shingles is more severe in older adults. Furthermore, the card bore the type badge "Ordered steps" despite having only 1 question and 1 answer.
2. **Screenshot 10**: AI proposed a cloze card that completely omitted `{{c1::...}}` cloze delimiters, producing an unmasked sentence that broke in Review Mode.
3. **Screenshot 11**: A standard single-sentence Q&A card was flagged as "complex structure", prompting the user to edit it in Flashcard Studio rather than allowing quick inline editing.

## 2. Root Cause Analysis

1. **Permissive Card Schema (`src/lib/ai/schemas/recallQuestion.ts:145`)**:
   `recallQuestionSchema` checked for strings but did not run regex validation for `{{c1::...}}` or check minimum step counts for `ordered-steps`.
2. **Ambiguous LLM System Prompt**:
   The prompt instructed the model to "consider procedural steps", leading models to label any factual card as "ordered steps" even when only one fact was present.
3. **Overzealous Studio Complexity Gate (`src/components/review/studio/DraftCardList.tsx:120`)**:
   The logic checking whether a card required Studio editing checked `hasMath || isCloze || isProcedure` without checking whether the cloze or procedure was actually complex.

## 3. Remediation Strategy

- Add pre-presentation validation `validateGeneratedCard`.
- Enforce $\ge 2$ steps for ordered-steps; auto-convert 1-step cards to `qa`.
- Require valid `{{c1::...}}` syntax for clozes.
- Refine Studio complexity thresholds.
