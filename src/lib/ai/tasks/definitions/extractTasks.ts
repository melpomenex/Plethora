/**
 * Task definitions for Extract / Article / Tag workflows (task 1.8).
 *
 * These run on-device only (their pre-task-layer behavior): the adapters pin
 * `kind: "ondevice"` and surface bridge errors through the unified taxonomy.
 * `suggestTags` is the design-D3 `fast` class; the generative extraction
 * tasks are `full`.
 */

import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

function extractSystemInstruction(core: string): string {
  return `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${core}`;
}

export interface TextCountInput {
  text: string;
  count: number;
}

export const extractKeyPointsTask: AITaskDefinition<TextCountInput, string> = {
  id: "extract-key-points",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: extractSystemInstruction(
    "You extract study material from source text. Follow the requested output format exactly."
  ),
  buildInput: ({ text, count }) => ({
    text: [
      `Extract up to ${count} core key points from the text below.`,
      "Format each key point on a line starting with a bullet marker '• '.",
      "No preamble, no commentary.",
      "",
      wrapUntrustedBlock("extract", text),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  streaming: false,
};

export const studyQuestionsTask: AITaskDefinition<TextCountInput, string> = {
  id: "extract-study-questions",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: extractSystemInstruction(
    "You write comprehension questions over source text. Follow the requested output format exactly."
  ),
  buildInput: ({ text, count }) => ({
    text: [
      `Generate up to ${count} clear study questions to test understanding of the text below.`,
      "One question per line starting with 'Q: '.",
      "No preamble, no answers.",
      "",
      wrapUntrustedBlock("extract", text),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  streaming: false,
};

export interface SuggestTagsInput {
  text: string;
  existingTags: string[];
}

export const suggestTagsTask: AITaskDefinition<SuggestTagsInput, string> = {
  id: "extract-suggest-tags",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: extractSystemInstruction(
    "You suggest concise topic tags for source text. Output tags as a single comma-separated list on one line. No preamble, no hashtag prefix."
  ),
  buildInput: ({ text }) => ({
    text: ["Suggest 3 to 5 concise topic tags for the text below.", "", wrapUntrustedBlock("extract", text)].join(
      "\n"
    ),
  }),
  outputKind: "text",
  maxOutputTokens: 128,
  timeoutMs: 120_000,
  streaming: false,
};

export type ArticleFocus = "key-points" | "actionable" | "background";

export interface ArticleSummaryInput {
  text: string;
  focus: ArticleFocus;
}

export const articleSummaryTask: AITaskDefinition<ArticleSummaryInput, string> = {
  id: "extract-article-summary",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: extractSystemInstruction(
    "You summarize articles for a reader in concise paragraphs. Follow the requested output format exactly."
  ),
  buildInput: ({ text, focus }) => {
    const focusInstruction =
      focus === "background"
        ? "Focus on context, historical background, and fundamental concepts."
        : "Focus on actionable takeaways and practical steps.";
    return {
      text: [
        `Summarize the article below. ${focusInstruction}`,
        "Write 2 concise paragraphs.",
        "",
        wrapUntrustedBlock("article", text),
      ].join("\n"),
    };
  },
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  streaming: false,
};

registerTasks(extractKeyPointsTask, studyQuestionsTask, suggestTagsTask, articleSummaryTask);
