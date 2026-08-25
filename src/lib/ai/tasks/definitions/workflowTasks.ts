/**
 * AI workflow tasks for the legacy AI Workflows page — routed through runTask.
 */

import {
  answerQuestion,
  extractKeyPoints,
  generateTitle,
  simplifyContent,
  summarizeContent,
  type SimplificationLevel,
} from "../../../api/ai";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

function workflowSystem(core: string): string {
  return `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${core}`;
}

export interface WorkflowTextInput {
  content: string;
}

export const workflowSummarizeTask: AITaskDefinition<WorkflowTextInput, string> = {
  id: "workflow-summarize",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: workflowSystem(
    "Summarize the provided content concisely. No preamble."
  ),
  buildInput: ({ content }) => ({
    text: [
      "Summarize the following content in under 200 words.",
      "",
      wrapUntrustedBlock("content", content),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  cloudExecutor: ({ content }) => summarizeContent(content, 200),
};

export const workflowTitleTask: AITaskDefinition<WorkflowTextInput, string> = {
  id: "workflow-title",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: workflowSystem(
    "Generate a short, descriptive title for study material. Output only the title text."
  ),
  buildInput: ({ content }) => ({
    text: [
      "Generate a concise title (max 12 words) for the following content.",
      "",
      wrapUntrustedBlock("content", content),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 64,
  timeoutMs: 60_000,
  cloudExecutor: ({ content }) => generateTitle(content),
};

export interface WorkflowKeyPointsInput extends WorkflowTextInput {
  count: number;
}

export const workflowKeyPointsTask: AITaskDefinition<WorkflowKeyPointsInput, string> = {
  id: "workflow-key-points",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: workflowSystem(
    "Extract key points as a bullet list. No preamble."
  ),
  buildInput: ({ content, count }) => ({
    text: [
      `Extract up to ${count} key points from the content below as bullet lines.`,
      "",
      wrapUntrustedBlock("content", content),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  cloudExecutor: async ({ content, count }) => {
    const points = await extractKeyPoints(content, count);
    return points.join("\n");
  },
};

export interface WorkflowSimplifyInput extends WorkflowTextInput {
  level: SimplificationLevel;
}

export const workflowSimplifyTask: AITaskDefinition<WorkflowSimplifyInput, string> = {
  id: "workflow-simplify",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: workflowSystem(
    "Rewrite content for the requested reading level. Keep all facts. No preamble."
  ),
  buildInput: ({ content, level }) => ({
    text: [
      `Rewrite for a ${level} reading level.`,
      "",
      wrapUntrustedBlock("content", content),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  cloudExecutor: ({ content, level }) => simplifyContent(content, level),
};

export interface WorkflowQaInput extends WorkflowTextInput {
  question: string;
}

export const workflowQaTask: AITaskDefinition<WorkflowQaInput, string> = {
  id: "workflow-qa",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: workflowSystem(
    "Answer from the passage only. Be direct. If unknown, say so."
  ),
  buildInput: ({ content, question }) => ({
    text: [
      wrapUntrustedBlock("passage", content),
      "",
      "Question:",
      wrapUntrustedBlock("question", question),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 120_000,
  cloudExecutor: ({ content, question }) => answerQuestion(question, content),
};

registerTasks(
  workflowSummarizeTask,
  workflowTitleTask,
  workflowKeyPointsTask,
  workflowSimplifyTask,
  workflowQaTask
);
