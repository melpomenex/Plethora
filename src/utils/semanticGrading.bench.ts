/**
 * AI-grading routing hot path — `gradeTypedAnswerSemantic` decides local vs
 * cloud vs heuristic for every graded typed answer (see semanticGrading.ts).
 * This is the path the removed wall-clock assertion in wave5Performance.test.ts
 * nominally guarded; here it is measured under the gate instead.
 *
 * Determinism: fixed inputs and fixed deps (local fails, cloud succeeds; the
 * both-fail variant exercises the heuristic fallback). No random, no clock.
 */
import { bench } from "vitest";
import {
  gradeTypedAnswerSemantic,
  type SemanticGradeInput,
} from "./semanticGrading";

// Deps shape isn't exported from the module; derive it from the function.
type SemanticGradeDeps = Parameters<typeof gradeTypedAnswerSemantic>[1];

const input: SemanticGradeInput = {
  question: "What is FSRS?",
  expectedAnswer: "A modern spaced repetition scheduler",
  userAnswer: "A spaced repetition scheduler",
  route: "local-first",
};

const deps: SemanticGradeDeps = {
  gradeWithLocal: async () => {
    throw new Error("local unavailable");
  },
  gradeWithCloud: async () => ({
    isCorrect: true,
    similarity: 0.92,
    provider: "cloud" as const,
  }),
};

// Cloud-first with both providers down: exercises the heuristic fallback.
const cloudFirstBothDown: SemanticGradeInput = { ...input, route: "cloud-first" };
const bothDown: SemanticGradeDeps = {
  gradeWithLocal: async () => {
    throw new Error("local unavailable");
  },
  gradeWithCloud: async () => {
    throw new Error("cloud unavailable");
  },
};

const ROUTINGS_PER_ITERATION = 300;

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the routing).
let sink = 0;

bench("semanticGrading/routing-fallback", async () => {
  let acc = 0;
  for (let i = 0; i < ROUTINGS_PER_ITERATION; i += 1) {
    // Cycle the three routing shapes: local-fallback, cloud-fallback, heuristic.
    const [inp, depsToUse] =
      i % 3 === 0 ? [input, deps] : i % 3 === 1 ? [cloudFirstBothDown, deps] : [input, bothDown];
    const result = await gradeTypedAnswerSemantic(inp, depsToUse);
    acc = (acc ^ Math.round(result.similarity * 1_000_000) ^ (result.isCorrect ? 1 : 0)) | 0;
  }
  sink ^= acc;
});
