/**
 * Task adapters for Extract, Article, and Tag workflows.
 *
 * Internally each adapter executes its `AITaskDefinition` through `runTask`
 * (design D4/D30) with the on-device provider pinned, preserving the
 * pre-task-layer behavior of these always-on-device flows; line parsing and
 * tag normalization stay here as post-processing.
 */

import { summarize, OnDeviceAiError } from "./onDeviceAI";
import { fnv1aHash } from "./providers/types";
import { runTask } from "./tasks/runTask";
import {
  articleSummaryTask,
  extractKeyPointsTask,
  studyQuestionsTask,
  suggestTagsTask,
} from "./tasks/definitions/extractTasks";

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

/**
 * Extract key bullet points from text.
 */
export async function extractKeyPoints(
  text: string,
  count = 5
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new OnDeviceAiError("invalid_argument", "Text cannot be empty.");

  const res = await runTask(
    extractKeyPointsTask,
    { text: trimmed, count },
    { kind: "ondevice", targetId: targetId(trimmed) }
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

  const res = await runTask(
    studyQuestionsTask,
    { text: trimmed, count },
    { kind: "ondevice", targetId: targetId(trimmed) }
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
    const res = await runTask(
      suggestTagsTask,
      { text: trimmed, existingTags },
      { kind: "ondevice", targetId: targetId(trimmed) }
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
 *
 * `key-points` uses the ML Kit Summarization API (hierarchical chunk
 * reduction) rather than a prompt task; the focused variants run the article
 * summary task on-device.
 */
export async function summarizeArticle(
  text: string,
  focus: "key-points" | "actionable" | "background" = "key-points"
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new OnDeviceAiError("invalid_argument", "Article text cannot be empty.");

  if (focus === "key-points") {
    return summarize(trimmed, { format: "paragraph" });
  }

  const res = await runTask(
    articleSummaryTask,
    { text: trimmed, focus },
    { kind: "ondevice", targetId: targetId(trimmed) }
  );
  return res.text;
}

/**
 * Execute independent subtasks for an extract inbox item.
 * Runs each subtask independently so a failure in one does not block others.
 */
export async function analyzeExtract(
  text: string
): Promise<ExtractAnalysisResult> {
  const result: ExtractAnalysisResult = {};

  const summaryPromise = summarize(text, { format: "paragraph" })
    .then((s) => { result.summary = s; })
    .catch(() => undefined);

  const keyPointsPromise = extractKeyPoints(text, 5)
    .then((kp) => { result.keyPoints = kp; })
    .catch(() => undefined);

  const questionsPromise = generateStudyQuestions(text, 5)
    .then((q) => { result.questions = q; })
    .catch(() => undefined);

  const tagsPromise = suggestTags(text)
    .then((t) => { result.suggestedTags = t; })
    .catch(() => undefined);

  await Promise.allSettled([summaryPromise, keyPointsPromise, questionsPromise, tagsPromise]);

  result.provenance = "ondevice-gemini-nano";
  return result;
}
