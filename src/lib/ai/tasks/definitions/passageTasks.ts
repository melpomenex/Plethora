/**
 * Task definitions for passage-level actions (design D4; task 1.8/1.9).
 *
 * Static `systemInstruction`s carry the untrusted-content containment clause
 * (D9) plus the task's stable instructions — transmitted via the
 * system-instruction/prompt-prefix field so the on-device provider can reuse
 * a cached KV prefix across invocations. Dynamic values (word budget, level,
 * preset-specific counts) live in the user turn.
 *
 * Legacy cloud behavior is preserved exactly (design D30): when the router
 * resolves a cloud provider, `cloudExecutor`s call the same `src/api/ai`
 * commands the pre-task-layer adapters used, with the same arguments.
 */

import {
  answerQuestion,
  extractKeyPoints,
  simplifyContent,
  summarizeContent,
  type SimplificationLevel,
} from "../../../../api/ai";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

export type ExplanationPreset = "simple" | "detailed" | "study-note";

export const DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS = 192;
export const DETAILED_PASSAGE_MAX_OUTPUT_TOKENS = 256;

/** Well beyond the internal 45s streaming fallback window; a safety net. */
export const PASSAGE_TASK_TIMEOUT_MS = 90_000;

function passageSystemInstruction(core: string): string {
  return `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${core}`;
}

export interface PassageTaskInput {
  passage: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Passage Q&A
// ──────────────────────────────────────────────────────────────────────────

export interface PassageQuestionInput extends PassageTaskInput {
  question: string;
}

export const passageQATask: AITaskDefinition<PassageQuestionInput, string> = {
  id: "passage-qa",
  taskType: "passage-qa",
  modelClass: "full",
  systemInstruction: passageSystemInstruction(
    "Answer the user's question based ONLY on the provided passage in 1-2 direct sentences. Be direct and concise. If the passage does not contain enough information to answer, state that clearly. No preamble or meta commentary."
  ),
  buildInput: ({ question, passage }) => ({
    text: [
      "Passage:",
      wrapUntrustedBlock("passage", passage),
      "",
      "Question:",
      wrapUntrustedBlock("question", question),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
  budgetPolicy: "pre-budgeted",
  cloudExecutor: ({ question, passage }) => answerQuestion(question, passage),
};

// ──────────────────────────────────────────────────────────────────────────
// Explanation presets
// ──────────────────────────────────────────────────────────────────────────

function presetInstruction(preset: ExplanationPreset): string {
  if (preset === "detailed") {
    return "Provide a structured, step-by-step detailed breakdown of key concepts in this passage.";
  }
  if (preset === "study-note") {
    return "Summarize this passage as 3 concise bullet points for a study card highlighting core terms and facts.";
  }
  return "Explain the core concepts of this passage in 1-2 clear, direct sentences for a mobile study note.";
}

const explainTasks: Record<ExplanationPreset, AITaskDefinition<PassageTaskInput, string>> = {
  simple: {
    id: "passage-explain-simple",
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: passageSystemInstruction(`${presetInstruction("simple")} No preamble or meta commentary.`),
    buildInput: ({ passage }) => ({
      text: ["Passage:", wrapUntrustedBlock("passage", passage)].join("\n"),
    }),
    outputKind: "text",
    maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
    timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
    budgetPolicy: "pre-budgeted",
    cloudExecutor: ({ passage }) => answerQuestion(presetInstruction("simple"), passage),
  },
  detailed: {
    id: "passage-explain-detailed",
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: passageSystemInstruction(
      `${presetInstruction("detailed")} No preamble or meta commentary.`
    ),
    buildInput: ({ passage }) => ({
      text: ["Passage:", wrapUntrustedBlock("passage", passage)].join("\n"),
    }),
    outputKind: "text",
    maxOutputTokens: DETAILED_PASSAGE_MAX_OUTPUT_TOKENS,
    timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
    budgetPolicy: "pre-budgeted",
    cloudExecutor: ({ passage }) => answerQuestion(presetInstruction("detailed"), passage),
  },
  "study-note": {
    id: "passage-explain-study-note",
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: passageSystemInstruction(
      `${presetInstruction("study-note")} No preamble or meta commentary.`
    ),
    buildInput: ({ passage }) => ({
      text: ["Passage:", wrapUntrustedBlock("passage", passage)].join("\n"),
    }),
    outputKind: "text",
    maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
    timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
    budgetPolicy: "pre-budgeted",
    cloudExecutor: ({ passage }) => answerQuestion(presetInstruction("study-note"), passage),
  },
};

export function explainPassageTask(preset: ExplanationPreset): AITaskDefinition<PassageTaskInput, string> {
  return explainTasks[preset];
}

// ──────────────────────────────────────────────────────────────────────────
// Summarize
// ──────────────────────────────────────────────────────────────────────────

export interface PassageSummarizeInput extends PassageTaskInput {
  maxWords: number;
}

export const passageSummarizeTask: AITaskDefinition<PassageSummarizeInput, string> = {
  id: "passage-summarize",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: passageSystemInstruction(
    "Summarize the key points of the provided passage in concise bullet points or 1-2 clear sentences under the requested word limit. No preamble, no conversational filler."
  ),
  buildInput: ({ passage, maxWords }) => ({
    text: [
      `Summarize the key points of this passage in concise bullet points or 1-2 clear sentences (under ${maxWords} words).`,
      "",
      "Passage:",
      wrapUntrustedBlock("passage", passage),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
  budgetPolicy: "pre-budgeted",
  cloudExecutor: ({ passage, maxWords }) => summarizeContent(passage, maxWords),
};

// ──────────────────────────────────────────────────────────────────────────
// Simplify
// ──────────────────────────────────────────────────────────────────────────

export interface PassageSimplifyInput extends PassageTaskInput {
  level: SimplificationLevel;
}

export const passageSimplifyTask: AITaskDefinition<PassageSimplifyInput, string> = {
  id: "passage-simplify",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: passageSystemInstruction(
    "Rewrite the provided passage in plain language the requested reader level can follow in 1-2 simple sentences, keeping every fact intact. No preamble or meta commentary."
  ),
  buildInput: ({ passage, level }) => ({
    text: [
      `Rewrite this passage in plain language a ${level} reader can follow in 1-2 simple sentences, keeping every fact intact.`,
      "",
      "Passage:",
      wrapUntrustedBlock("passage", passage),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
  budgetPolicy: "pre-budgeted",
  cloudExecutor: ({ passage, level }) => simplifyContent(passage, level),
};

// ──────────────────────────────────────────────────────────────────────────
// Key terms
// ──────────────────────────────────────────────────────────────────────────

export interface PassageKeyTermsInput extends PassageTaskInput {
  count: number;
}

export const passageKeyTermsTask: AITaskDefinition<PassageKeyTermsInput, string> = {
  id: "passage-key-terms",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: passageSystemInstruction(
    'List the most important terms or points from the provided passage, one per line, each formatted as "term — concise definition". No preamble or meta commentary.'
  ),
  buildInput: ({ passage, count }) => ({
    text: [
      `List the ${count} most important terms or points in this passage, one per line, each as "term — concise definition".`,
      "",
      "Passage:",
      wrapUntrustedBlock("passage", passage),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  timeoutMs: PASSAGE_TASK_TIMEOUT_MS,
  budgetPolicy: "pre-budgeted",
  cloudExecutor: async ({ passage, count }) =>
    (await extractKeyPoints(passage, count)).map((point) => `- ${point}`).join("\n"),
};

registerTasks(
  passageQATask,
  explainTasks.simple,
  explainTasks.detailed,
  explainTasks["study-note"],
  passageSummarizeTask,
  passageSimplifyTask,
  passageKeyTermsTask
);
