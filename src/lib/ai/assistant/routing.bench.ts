/**
 * Seeded benchmarks for the pure planner/routing/citation paths (task 6.5).
 *
 * Inputs are built with the shared seeded PRNG; no network, filesystem, Tauri
 * or wall-clock input is used, and every body consumes its result through a
 * module-level sink so the engine cannot elide the work.
 */

import { bench } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { resolveRoute } from "./routing";
import { renderAnswer } from "./citationView";
import { planSourceContext } from "./sourcePlan";
import type { Citation } from "./conversations/types";

const WORDS = [
  "attention", "gradient", "retrieval", "mechanism", "chapter", "passage",
  "context", "evidence", "citation", "summary",
];

function sentence(rand: () => number, words: number): string {
  const parts: string[] = [];
  for (let i = 0; i < words; i++) {
    parts.push(WORDS[Math.floor(rand() * WORDS.length)]);
  }
  return parts.join(" ");
}

const rand = seededRandom(0xc0ffee);
const QUESTION_WORDS = [3, 6, 9, 12];
const questions = Array.from({ length: 64 }, () => sentence(rand, QUESTION_WORDS[Math.floor(rand() * QUESTION_WORDS.length)]));
const citations: Citation[] = Array.from({ length: 12 }, (_, index) => ({
  id: `cite-${index}`,
  displayNumber: index + 1,
  refId: `chunk-${index}`,
  quote: sentence(rand, 30),
  title: `Document ${index}`,
  origin: "library",
  validation: "verified",
  documentId: `doc-${index}`,
  locator: { page: index + 1 },
}));
const answerBlob = Array.from(
  { length: 40 },
  (_, index) => `Claim ${index} [${index % 12}] ${sentence(rand, 12)}.`,
).join(" ");
const pageText = sentence(rand, 900);

// Module-level sink so benchmark results cannot be optimized away.
let sink: unknown;

bench("routing resolveRoute (64 questions)", () => {
  for (const question of questions) {
    sink = resolveRoute({
      question,
      policy: { mode: "auto", origin: "inferred" },
      attachments: [],
      permissions: { authorizedDocumentIds: new Set(["doc-0", "doc-1"]) },
    });
  }
});

bench("citation renderAnswer (40 claims)", () => {
  sink = renderAnswer(answerBlob, citations);
});

bench("sourcePlan page context", () => {
  sink = planSourceContext({
    kind: "pdf",
    position: { page: 12 },
    pageText: () => pageText,
    budgetTokens: 3000,
  });
});
