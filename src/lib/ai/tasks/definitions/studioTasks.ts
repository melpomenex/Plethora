/**
 * Task definitions for Flashcard Studio / review assistance (task 1.8).
 *
 * Card question/answer text and source context are user/document content and
 * therefore enter prompts only inside untrusted blocks (design D9).
 */

import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

function studioSystemInstruction(core: string): string {
  return `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${core}`;
}

export interface CardHintInput {
  question: string;
  answer: string;
}

export const reviewHintTask: AITaskDefinition<CardHintInput, string> = {
  id: "studio-review-hint",
  taskType: "review-hint",
  modelClass: "full",
  systemInstruction: studioSystemInstruction(
    "You write subtle one-sentence hints that help a learner recall a flashcard answer without stating it. CRITICAL CONSTRAINT: do NOT state the answer or reveal the direct key answer terms."
  ),
  buildInput: ({ question, answer }) => ({
    text: [
      "Provide a subtle 1-sentence hint for answering the flashcard question below.",
      "",
      "Question:",
      wrapUntrustedBlock("card-question", question),
      "",
      "Answer:",
      wrapUntrustedBlock("card-answer", answer),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 128,
  timeoutMs: 120_000,
  streaming: false,
};

export interface CardExplanationInput {
  question: string;
  answer: string;
  sourceContext?: string;
}

export const explainCardTask: AITaskDefinition<CardExplanationInput, string> = {
  id: "studio-explain-card",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: studioSystemInstruction(
    "You explain why a flashcard answer is correct in 2 concise sentences, grounded in the provided card and any source context."
  ),
  buildInput: ({ question, answer, sourceContext }) => ({
    text: [
      "Explain why the following flashcard answer is correct in 2 concise sentences.",
      ...(sourceContext
        ? ["Source Context:", wrapUntrustedBlock("card-source", sourceContext), ""]
        : []),
      "Question:",
      wrapUntrustedBlock("card-question", question),
      "",
      "Answer:",
      wrapUntrustedBlock("card-answer", answer),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 120_000,
};

registerTasks(reviewHintTask, explainCardTask);
