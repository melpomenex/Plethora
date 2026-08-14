/**
 * Task adapters and grounding checks for Passage Q&A and Explanation.
 */

import { generateStreamingPrompt, generateNativePrompt, OnDeviceAiError } from "./onDeviceAI";
import { checkAnswerGrounding } from "./cardValidator";
import { runAiAction, resolveAiPath } from "./provider";

export type ExplanationPreset = "simple" | "detailed" | "study-note";

export interface PassageAnswerOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
}

export interface PassageExplainOptions extends PassageAnswerOptions {
  preset?: ExplanationPreset;
}

export interface PassageAnswerResult {
  answer: string;
  grounded: boolean;
  confidenceScore: number;
  reasons: string[];
  baseModelName?: string;
}

export interface PassageExplainResult {
  explanation: string;
  preset: ExplanationPreset;
  baseModelName?: string;
}

/**
 * Answer a question grounded in a specific passage context.
 */
export async function answerPassage(
  question: string,
  passage: string,
  options: PassageAnswerOptions = {}
): Promise<PassageAnswerResult> {
  const trimmedQ = question.trim();
  const trimmedP = passage.trim();

  if (!trimmedQ || !trimmedP) {
    throw new OnDeviceAiError("invalid_argument", "Question and passage text cannot be empty.");
  }

  const promptText = [
    "Answer the following question based ONLY on the provided passage.",
    "Be direct and concise. If the passage does not contain enough information to answer, state that clearly.",
    "",
    `Passage:\n${trimmedP}`,
    "",
    `Question: ${trimmedQ}`,
  ].join("\n");

  const requestId = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let rawAnswer = "";
  let baseModelName: string | undefined;

  const path = await resolveAiPath("prompt");

  if (path === "ondevice") {
    const res = await generateStreamingPrompt(
      {
        requestId,
        text: promptText,
        maxOutputTokens: 512,
      },
      {
        signal: options.signal,
        onChunk: (chunk) => {
          rawAnswer += chunk;
          options.onChunk?.(chunk);
        },
        onRetry: options.onRetry,
      }
    );
    rawAnswer = res.text || rawAnswer;
    baseModelName = res.baseModelName;
  } else {
    // Cloud path fallback or non-streaming ondevice fallback
    const res = await generateNativePrompt({
      requestId,
      text: promptText,
      maxOutputTokens: 512,
    });
    rawAnswer = res.text;
    baseModelName = res.baseModelName;
    options.onChunk?.(rawAnswer);
  }

  const grounding = checkAnswerGrounding(rawAnswer, trimmedP);
  const reasons: string[] = [];

  if (!grounding.grounded) {
    reasons.push("unsupported_assertion");
  }

  return {
    answer: rawAnswer,
    grounded: grounding.grounded,
    confidenceScore: grounding.score,
    reasons,
    baseModelName,
  };
}

/**
 * Generate a mobile-optimized explanation of a passage according to a preset.
 */
export async function explainPassage(
  passage: string,
  options: PassageExplainOptions = {}
): Promise<PassageExplainResult> {
  const trimmedP = passage.trim();
  if (!trimmedP) {
    throw new OnDeviceAiError("invalid_argument", "Passage text cannot be empty.");
  }

  const preset = options.preset ?? "simple";
  let presetInstruction = "Explain this passage in simple, clear terms in 2-3 short paragraphs for mobile reading.";

  if (preset === "detailed") {
    presetInstruction = "Provide a structured, step-by-step detailed breakdown of key concepts in this passage.";
  } else if (preset === "study-note") {
    presetInstruction = "Summarize this passage as a bulleted study note highlighting core terms and facts.";
  }

  const promptText = [
    presetInstruction,
    "No preamble or meta commentary.",
    "",
    `Passage:\n${trimmedP}`,
  ].join("\n");

  const requestId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let rawExplanation = "";
  let baseModelName: string | undefined;

  const path = await resolveAiPath("prompt");

  if (path === "ondevice") {
    const res = await generateStreamingPrompt(
      {
        requestId,
        text: promptText,
        maxOutputTokens: 512,
      },
      {
        signal: options.signal,
        onChunk: (chunk) => {
          rawExplanation += chunk;
          options.onChunk?.(chunk);
        },
        onRetry: options.onRetry,
      }
    );
    rawExplanation = res.text || rawExplanation;
    baseModelName = res.baseModelName;
  } else {
    const res = await generateNativePrompt({
      requestId,
      text: promptText,
      maxOutputTokens: 512,
    });
    rawExplanation = res.text;
    baseModelName = res.baseModelName;
    options.onChunk?.(rawExplanation);
  }

  return {
    explanation: rawExplanation,
    preset,
    baseModelName,
  };
}
