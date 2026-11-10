# Verification Plan: Source-Grounded AI Curricula & Assessments

## Automated Test Suites

### T01: Card Schema Validation Suite (Vitest)
- File: `src/lib/ai/schemas/__tests__/recallQuestion.validation.test.ts`
- Scenarios:
  - Validate cloze with text `"The capital of France is {{c1::Paris}}."` $\to$ `valid: true`.
  - Validate cloze missing brackets $\to$ `valid: false`, error contains `missing {{c1::...}}`.
  - Validate `ordered-steps` with 1 item $\to$ `valid: true`, `sanitizedType: "qa"`.
  - Validate `ordered-steps` with 3 items $\to$ `valid: true`, `sanitizedType: "ordered-steps"`.

### T02: Card Complexity Determination Suite (Vitest)
- File: `src/components/review/studio/__tests__/DraftCardList.complexity.test.tsx`
- Scenarios:
  - Pass standard Q&A card to `DraftCardList`. Assert inline editor renders without "Open in Studio" banner.
  - Pass cloze card with 4 deletion keys (`c1`, `c2`, `c3`, `c4`). Assert Studio banner is displayed.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that schema regex validation executes in under 0.05ms per card.
