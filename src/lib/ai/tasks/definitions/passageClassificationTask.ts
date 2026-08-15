/**
 * `PassageClassificationTask` — passage extract-worthiness scoring (design
 * D23 / ai-knowledge-relationships spec, tasks 6.6/6.7).
 *
 * Fast model class, structured output validated against the canonical
 * `PassageClassification` schema (`schemas/passageClassification.ts`). Runs
 * ON DEMAND for content the reader has already scrolled past (the viewer
 * controller guarantees this — never precomputed for whole documents), with
 * results cached by chunk content hash (`passage_scores`).
 *
 * The passage text is untrusted document content and enters the user turn
 * ONLY inside an untrusted block (D9).
 */

import {
  PASSAGE_CLASSIFICATION_SCHEMA,
  validatePassageClassification,
  type PassageClassification,
} from "../../schemas/passageClassification";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import type { AITaskDefinition, AITaskRunOptions } from "../types";

export const PASSAGE_CLASSIFICATION_TASK_ID = "passage-classification";

/** Fast-class latency budget; scoring happens during idle reading time. */
export const PASSAGE_CLASSIFICATION_TIMEOUT_MS = 20_000;
/** One small envelope: type + score + one-sentence reason + action. */
export const PASSAGE_CLASSIFICATION_MAX_OUTPUT_TOKENS = 200;

export interface PassageClassificationInput {
  /** The already-read passage to classify — untrusted document content. */
  passage: string;
  /** Optional document title for context — untrusted document content. */
  documentTitle?: string;
}

const PASSAGE_CLASSIFICATION_CORE_INSTRUCTION = [
  'You classify a single passage from an <untrusted_source> block by its role in the document and score how worthwhile it is to extract for spaced repetition.',
  "type is one of: fundamental-claim, definition, important-example, key-argument, formula, process, comparison, supporting-detail, transition, bibliography, low-value.",
  "extractWorthiness is 0.0-1.0: how much a learner gains from keeping this exact passage as an extract/card. Core definitional/argumentative/formula content scores high; narrative glue, transitions between sections, reference lists, and boilerplate score low.",
  "reason is one short sentence grounded in the passage itself.",
  "suggestedLearningAction is one of: none, extract, flashcard, highlight — what a reader would most plausibly do with it (none for low-worthiness passages).",
  "Return ONLY the JSON object.",
].join("\n");

function buildPassageClassificationInput(input: PassageClassificationInput) {
  const lines = [
    "Classify this passage:",
    "",
    ...(input.documentTitle
      ? ["Document title:", wrapUntrustedBlock("document-title", input.documentTitle), ""]
      : []),
    "Passage:",
    wrapUntrustedBlock("passage", input.passage),
    "",
    `Respond with ONLY a JSON object of this shape: ${PASSAGE_CLASSIFICATION_SCHEMA.json}`,
  ];
  return { text: lines.join("\n") };
}

export const passageClassificationTask: AITaskDefinition<
  PassageClassificationInput,
  PassageClassification
> = {
  id: PASSAGE_CLASSIFICATION_TASK_ID,
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${PASSAGE_CLASSIFICATION_CORE_INSTRUCTION}`,
  buildInput: buildPassageClassificationInput,
  outputKind: "structured",
  schema: PASSAGE_CLASSIFICATION_SCHEMA,
  validate: (output) => validatePassageClassification(output),
  maxOutputTokens: PASSAGE_CLASSIFICATION_MAX_OUTPUT_TOKENS,
  timeoutMs: PASSAGE_CLASSIFICATION_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

/**
 * Run the passage-classification task. Thin wrapper over `runTask`; callers
 * own the chunk-hash cache write (`passage_scores`) after a successful run.
 */
export async function runPassageClassification(
  input: PassageClassificationInput,
  options: AITaskRunOptions = {}
) {
  const run = await runTask(passageClassificationTask, input, {
    targetId: `passage-score:${input.passage.slice(0, 96)}`,
    ...options,
  });
  return { classification: run.output, run };
}

registerTasks(passageClassificationTask);
