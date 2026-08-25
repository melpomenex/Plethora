/**
 * On-device flashcard generation via the task router (Nano, Apple FM, etc.).
 * Uses the same line-oriented format as the legacy Nano prompt for tolerant parsing.
 */

import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

export interface FlashcardGenerationInput {
  text: string;
  count: number;
}

export const flashcardGenerationTask: AITaskDefinition<FlashcardGenerationInput, string> = {
  id: "flashcard-generation",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}
You write spaced-repetition flashcards from source text. Follow the requested output format exactly.`,
  buildInput: ({ text, count }) => ({
    text: [
      `Write up to ${count} spaced-repetition flashcards from the text below.`,
      "Use exactly this line format and nothing else:",
      "Q: <question>",
      "A: <answer>",
      "CLOZE: <sentence with {{c1::the hidden part}}>",
      "One fact per card. Ground every answer in the source text. No preamble, no numbering, no commentary.",
      "",
      wrapUntrustedBlock("source", text),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 1024,
  timeoutMs: 90_000,
  streaming: false,
  requirement: "prompt",
};

registerTasks(flashcardGenerationTask);
