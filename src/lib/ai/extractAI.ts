/**
 * Task adapters for Extract, Article, and Tag workflows.
 *
 * Routes through `runAiAction` + `runTask` so Windows System AI, Foundry Local,
 * Android Nano, Apple FM, and cloud fallbacks share one spine.
 */

import { summarizePassage } from "./passageAI";
import { runAiAction } from "./provider";
import { OnDeviceAiError } from "./onDeviceAI";
import { fnv1aHash } from "./providers/types";
import { runTask } from "./tasks/runTask";
import {
  articleSummaryTask,
  extractKeyPointsTask,
  studyQuestionsTask,
  suggestTagsTask,
} from "./tasks/definitions/extractTasks";
import type { AITaskDefinition } from "./tasks/types";

export interface ExtractAnalysisResult {
  summary?: string;
  keyPoints?: string[];
  questions?: string[];
  suggestedTags?: string[];
  provenance?: string;
}

function targetId(text: string): string {
  return fnv1aHash(text.slice(0, 4096));
}

async function runExtractTask<I>(
  task: AITaskDefinition<I, string>,
  input: I,
  targetIdKey: string,
  label: string
): Promise<{ text: string; baseModelName?: string }> {
  const res = await runAiAction(
    {
      onDevice: () =>
        runTask(task, input, { targetId: targetIdKey, kind: "ondevice" }),
      cloud: () =>
        runTask(task, input, { targetId: targetIdKey, kind: "cloud" }),
    },
    label
  );
  if (!res) {
    throw new OnDeviceAiError("model_unavailable", "No AI path is available.");
  }
  return res;
}

/**
 * Extract key bullet points from text.
 */
export async function extractKeyPoints(
  text: string,
  count = 5
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new OnDeviceAiError("invalid_argument", "Text cannot be empty.");

  const tid = targetId(trimmed);
  const res = await runExtractTask(
    extractKeyPointsTask,
    { text: trimmed, count },
    tid,
    "Extract key points"
  );

  const points: string[] = [];
  for (const line of res.text.split(/\r?\n/)) {
    const clean = line.replace(/^[-*•\d.)\s]+/, "").trim();
    if (clean) points.push(clean);
  }

  return points.slice(0, count);
}

/**
 * Generate comprehension/study questions from text.
 */
export async function generateStudyQuestions(
  text: string,
  count = 5
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new OnDeviceAiError("invalid_argument", "Text cannot be empty.");

  const tid = targetId(trimmed);
  const res = await runExtractTask(
    studyQuestionsTask,
    { text: trimmed, count },
    tid,
    "Study questions"
  );

  const questions: string[] = [];
  for (const line of res.text.split(/\r?\n/)) {
    const match = /^[-*\d.)\s]*\**\s*(?:q|question)?\s*\**\s*[:.]?\s*(.+)$/i.exec(line.trim());
    if (match && match[1].trim()) {
      questions.push(match[1].trim());
    }
  }

  return questions.slice(0, count);
}

/**
 * Suggest 3-5 normalized tags for text.
 */
export async function suggestTags(
  text: string,
  existingTags: string[] = []
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const tid = targetId(trimmed);
    const res = await runExtractTask(
      suggestTagsTask,
      { text: trimmed, existingTags },
      tid,
      "Suggest tags"
    );
    const rawTags = res.text
      .split(",")
      .map((t) => t.replace(/^[#\s]+/, "").trim().toLowerCase())
      .filter((t) => t.length > 1);

    const existingSet = new Set(existingTags.map((t) => t.toLowerCase()));
    const uniqueTags = Array.from(new Set(rawTags)).filter((t) => !existingSet.has(t));
    return uniqueTags.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Summarize an article with a specific focus.
 */
export async function summarizeArticle(
  text: string,
  focus: "key-points" | "actionable" | "background" = "key-points"
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new OnDeviceAiError("invalid_argument", "Article text cannot be empty.");

  if (focus === "key-points") {
    const res = await summarizePassage(trimmed, { maxWords: 120 });
    return res.text;
  }

  const tid = targetId(trimmed);
  const res = await runExtractTask(
    articleSummaryTask,
    { text: trimmed, focus },
    tid,
    "Article summary"
  );
  return res.text;
}

/**
 * Execute independent subtasks for an extract inbox item.
 */
export async function analyzeExtract(
  text: string
): Promise<ExtractAnalysisResult> {
  const result: ExtractAnalysisResult = { provenance: "unified-router" };

  const summaryPromise = summarizePassage(text, { maxWords: 100 })
    .then((s) => {
      result.summary = s.text;
    })
    .catch(() => undefined);

  const keyPointsPromise = extractKeyPoints(text, 5)
    .then((kp) => {
      result.keyPoints = kp;
    })
    .catch(() => undefined);

  const questionsPromise = generateStudyQuestions(text, 5)
    .then((q) => {
      result.questions = q;
    })
    .catch(() => undefined);

  const tagsPromise = suggestTags(text)
    .then((t) => {
      result.suggestedTags = t;
    })
    .catch(() => undefined);

  await Promise.allSettled([summaryPromise, keyPointsPromise, questionsPromise, tagsPromise]);

  return result;
}
