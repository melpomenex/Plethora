/**
 * Task adapters for Extract, Article, and Tag workflows.
 */

import { generateNativePrompt, summarize, OnDeviceAiError } from "./onDeviceAI";
import { resolveAiPath } from "./provider";

export interface ExtractAnalysisResult {
  summary?: string;
  keyPoints?: string[];
  questions?: string[];
  suggestedTags?: string[];
  provenance?: string;
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

  const promptText = [
    `Extract up to ${count} core key points from the text below.`,
    "Format each key point on a line starting with a bullet marker '• '.",
    "No preamble, no commentary.",
    "",
    trimmed,
  ].join("\n");

  const requestId = `kp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 512 });

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

  const promptText = [
    `Generate up to ${count} clear study questions to test understanding of the text below.`,
    "One question per line starting with 'Q: '.",
    "No preamble, no answers.",
    "",
    trimmed,
  ].join("\n");

  const requestId = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 512 });

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

  const promptText = [
    "Suggest 3 to 5 concise topic tags for the text below.",
    "Output tags as a single comma-separated list on one line.",
    "No preamble, no hashtag prefix.",
    "",
    trimmed,
  ].join("\n");

  const requestId = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 128 });
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
    return summarize(trimmed, { format: "paragraph" });
  }

  let focusInstruction = "Focus on actionable takeaways and practical steps.";
  if (focus === "background") {
    focusInstruction = "Focus on context, historical background, and fundamental concepts.";
  }

  const promptText = [
    `Summarize the article below. ${focusInstruction}`,
    "Write 2 concise paragraphs.",
    "",
    trimmed,
  ].join("\n");

  const requestId = `art-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 512 });
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
