# Architectural Design: Source-Grounded AI Curricula & Assessments

## Problem Diagnosis

### 1. Low Quality Non-Sequitur Q&A & Step Mismatch
In Screenshot 09:
- Generated Question: *"Why are people more likely to get shingles as they get older?"*
- Generated Answer: *"The disease tends to be more severe in older adults."*
The answer does not explain why older adults are more prone to shingles (e.g. waning cell-mediated immunity against varicella-zoster virus), but instead restates severity.
Furthermore, the card was tagged with the type badge `"Ordered steps"` despite containing only a single question and single answer.

### 2. Malformed Cloze Syntax
In Screenshot 10:
The AI generator created a cloze card whose question field contained plain prose without any `{{c1::...}}` delimiters, or with empty markers `{{c1::}}`. In Review Mode, the card was unplayable because no cloze deletion could be masked.

### 3. False Complexity Studio Redirect
In Screenshot 11:
A basic single-sentence Q&A card displayed an alert:
*"This card has complex structure. Open in Flashcard Studio to edit."*
Forcing users out of their active flow into the full Flashcard Studio editor adds massive friction to routine card generation.

## Architectural Solutions

### 1. Pre-Presentation Card Validation Pipeline
In `src/lib/ai/schemas/recallQuestion.ts`:
Introduce a deterministic sanitizer and validator:
```ts
export interface CardValidationOutcome {
  valid: boolean;
  sanitizedType: "qa" | "cloze" | "ordered-steps" | "multi-choice";
  errors: string[];
}

export function validateGeneratedCard(card: RawGeneratedCard): CardValidationOutcome {
  const errors: string[] = [];
  let sanitizedType = card.type;

  // 1. Cloze syntax validation
  if (sanitizedType === "cloze") {
    const clozePattern = /\{\{c\d+::([^}]+)\}\}/g;
    const text = card.cloze_text || card.question || "";
    const matches = Array.from(text.matchAll(clozePattern));
    if (matches.length === 0) {
      errors.push("Cloze card is missing {{c1::...}} deletion markers");
    } else if (matches.some(m => !m[1] || m[1].trim().length === 0)) {
      errors.push("Cloze deletion marker cannot be empty");
    }
  }

  // 2. Ordered steps validation
  if (sanitizedType === "ordered-steps") {
    const steps = card.steps ?? extractNumberedSteps(card.answer);
    if (steps.length < 2) {
      // Degrade gracefully to simple QA rather than failing
      sanitizedType = "qa";
    }
  }

  // 3. QA non-emptiness & length checks
  if (sanitizedType === "qa") {
    if (!card.question || card.question.trim().length < 5) {
      errors.push("Question is too short or empty");
    }
    if (!card.answer || card.answer.trim().length < 2) {
      errors.push("Answer is too short or empty");
    }
  }

  return {
    valid: errors.length === 0,
    sanitizedType,
    errors
  };
}
```

### 2. Semantic Alignment Prompt Engineering
In `src/features/assistant/chatFlashcardArtifacts.ts`:
Refine the system prompt for card generation:
- *Coherence Rule*: The answer MUST directly satisfy the question's interrogative pronoun (e.g. "Why" must answer with causation/mechanism; "When" must answer with timing; "Where" must answer with location).
- *Atomicity Rule*: Each card must test exactly one atomic concept or relationship.
- *Step Rule*: Only tag as `ordered-steps` if the knowledge represents a sequential procedure or chronological process with $\ge 2$ ordered phases.

### 3. Recalibrated Complexity Heuristics
In `src/components/review/studio/DraftCardList.tsx`:
A card is classified as `complex` (requiring Studio redirect) ONLY IF:
1. It contains 3+ separate cloze indices (`c1`, `c2`, `c3`), OR
2. It contains embedded image occlusions with multiple masked regions, OR
3. It contains complex LaTeX formulas with multi-line environments.
Single-sentence Q&A cards, single-deletion clozes, and 2-step sequences remain fully editable inline in Chat and Review without redirecting.
