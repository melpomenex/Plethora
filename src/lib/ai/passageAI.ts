/**
 * Task adapters for passage-level AI actions (explain, summarize, simplify,
 * key terms, Q&A).
 *
 * Every adapter routes through `runAiAction`, so the on-device/cloud decision,
 * the fallback toast and the cancellation semantics live in one place. The
 * passage is truncated to the on-device token budget before sending and the
 * result carries a `truncated` flag so the UI can say the input was shortened.
 */

import {
  generateStreamingPrompt,
  OnDeviceAiError,
  type OnDeviceRequirement,
} from "./onDeviceAI";
import {
  chunkTextByTokens,
  resolveTokenBudget,
  DEFAULT_TOKEN_BUDGET,
} from "./chunkTextByTokens";
import { checkAnswerGrounding } from "./cardValidator";
import { runAiAction } from "./provider";
import {
  answerQuestion,
  summarizeContent,
  simplifyContent,
  extractKeyPoints,
  type SimplificationLevel,
} from "../../api/ai";

export type ExplanationPreset = "simple" | "detailed" | "study-note";

/** Headroom left for the prompt instructions wrapped around the passage. */
const PROMPT_RESERVE_TOKENS = 200;

/** Default maximum output tokens for passage operations to keep on-device decode time under 3-5 seconds. */
export const DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS = 192;

export interface PassageActionOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  /** Token budget for the passage itself. Defaults to the chunker's default. */
  maxTokens?: number;
  /** Maximum generated output tokens. Defaults to DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

export interface PassageExplainOptions extends PassageActionOptions {
  preset?: ExplanationPreset;
}

export interface PassageSummarizeOptions extends PassageActionOptions {
  maxWords?: number;
}

export interface PassageSimplifyOptions extends PassageActionOptions {
  level?: SimplificationLevel;
}

export interface PassageKeyTermsOptions extends PassageActionOptions {
  count?: number;
}

export interface PassageResult {
  text: string;
  /** True when the passage was shortened to fit the input budget. */
  truncated: boolean;
  baseModelName?: string;
  /** Set by `answerPassage` only: whether the answer is supported by the passage. */
  grounded?: boolean;
  confidenceScore?: number;
  reasons?: string[];
}

/** What an adapter's on-device/cloud branch produces before flags are attached. */
interface Draft {
  text: string;
  baseModelName?: string;
}

/**
 * Trim a passage to the input budget. Returns the (possibly shortened) passage
 * and whether anything was dropped.
 */
function fitPassage(passage: string, maxTokens?: number): { passage: string; truncated: boolean } {
  const trimmed = passage.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Passage text cannot be empty.");
  }
  const budget = resolveTokenBudget((maxTokens ?? DEFAULT_TOKEN_BUDGET) - PROMPT_RESERVE_TOKENS);
  const chunks = chunkTextByTokens(trimmed, budget);
  return { passage: chunks[0], truncated: chunks.length > 1 };
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Run a prompt on-device, streaming chunks to the caller as they arrive. */
async function onDevicePrompt(
  prefix: string,
  promptText: string,
  options: PassageActionOptions,
  systemInstruction?: string,
  defaultMaxTokens = DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS
): Promise<Draft> {
  let text = "";
  const res = await generateStreamingPrompt(
    {
      requestId: requestId(prefix),
      text: promptText,
      systemInstruction,
      maxOutputTokens: options.maxOutputTokens ?? defaultMaxTokens,
    },
    {
      signal: options.signal,
      onChunk: (chunk) => {
        text += chunk;
        options.onChunk?.(chunk);
      },
      onRetry: options.onRetry,
    }
  );
  return { text: res.text || text, baseModelName: res.baseModelName };
}

/** Cloud results arrive whole; emit them as one chunk so the UI path is uniform. */
function emitWhole(text: string, options: PassageActionOptions): Draft {
  options.onChunk?.(text);
  return { text };
}

async function runPassageAction(
  action: { onDevice: () => Promise<Draft>; cloud: () => Promise<Draft> },
  label: string,
  truncated: boolean,
  requirement: OnDeviceRequirement = "prompt"
): Promise<PassageResult> {
  const res = await runAiAction(action, label, requirement);
  if (!res) {
    throw new OnDeviceAiError("model_unavailable", "No AI path is available.");
  }
  return { ...res, truncated };
}

/**
 * Answer a question grounded in a specific passage in 1-2 direct sentences.
 */
export async function answerPassage(
  question: string,
  passage: string,
  options: PassageActionOptions = {}
): Promise<PassageResult> {
  const trimmedQ = question.trim();
  if (!trimmedQ) {
    throw new OnDeviceAiError("invalid_argument", "Question and passage text cannot be empty.");
  }
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);

  const promptText = [
    "Answer the following question based ONLY on the provided passage in 1-2 direct sentences.",
    "Be direct and concise. If the passage does not contain enough information to answer, state that clearly.",
    "",
    `Passage:\n${text}`,
    "",
    `Question: ${trimmedQ}`,
  ].join("\n");

  const result = await runPassageAction(
    {
      onDevice: () => onDevicePrompt("qa", promptText, options),
      cloud: async () => emitWhole(await answerQuestion(trimmedQ, text), options),
    },
    "Passage Q&A",
    truncated
  );

  const grounding = checkAnswerGrounding(result.text, text);
  return {
    ...result,
    grounded: grounding.grounded,
    confidenceScore: grounding.score,
    reasons: grounding.grounded ? [] : ["unsupported_assertion"],
  };
}

function presetInstruction(preset: ExplanationPreset): string {
  if (preset === "detailed") {
    return "Provide a structured, step-by-step detailed breakdown of key concepts in this passage.";
  }
  if (preset === "study-note") {
    return "Summarize this passage as 3 concise bullet points for a study card highlighting core terms and facts.";
  }
  return "Explain the core concepts of this passage in 1-2 clear, direct sentences for a mobile study note.";
}

/**
 * Explain a passage according to a preset.
 */
export async function explainPassage(
  passage: string,
  options: PassageExplainOptions = {}
): Promise<PassageResult> {
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);
  const instruction = presetInstruction(options.preset ?? "simple");
  const promptText = [instruction, "No preamble or meta commentary.", "", `Passage:\n${text}`].join(
    "\n"
  );
  const defaultMaxTokens = options.preset === "detailed" ? 256 : DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS;

  return runPassageAction(
    {
      onDevice: () => onDevicePrompt("exp", promptText, options, undefined, defaultMaxTokens),
      cloud: async () => emitWhole(await answerQuestion(instruction, text), options),
    },
    "Explanation",
    truncated
  );
}

/**
 * Summarize a passage using streaming Prompt API for fast incremental feedback.
 */
export async function summarizePassage(
  passage: string,
  options: PassageSummarizeOptions = {}
): Promise<PassageResult> {
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);
  const maxWords = options.maxWords ?? 100;
  const promptText = [
    `Summarize the key points of this passage in concise bullet points or 1-2 clear sentences (under ${maxWords} words).`,
    "No preamble, no conversational filler.",
    "",
    `Passage:\n${text}`,
  ].join("\n");

  return runPassageAction(
    {
      onDevice: () => onDevicePrompt("sum", promptText, options),
      cloud: async () => emitWhole(await summarizeContent(text, maxWords), options),
    },
    "Summary",
    truncated,
    "prompt"
  );
}

/**
 * Rewrite a passage in plainer language.
 */
export async function simplifyPassage(
  passage: string,
  options: PassageSimplifyOptions = {}
): Promise<PassageResult> {
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);
  const level = options.level ?? "highschool";
  const instruction = `Rewrite this passage in plain language a ${level} reader can follow in 1-2 simple sentences, keeping every fact intact.`;
  const promptText = [instruction, "No preamble or meta commentary.", "", `Passage:\n${text}`].join(
    "\n"
  );

  return runPassageAction(
    {
      onDevice: () => onDevicePrompt("simp", promptText, options),
      cloud: async () => emitWhole(await simplifyContent(text, level), options),
    },
    "Simplification",
    truncated
  );
}

/**
 * Pull the key terms/points out of a passage as a bulleted list.
 */
export async function keyTermsPassage(
  passage: string,
  options: PassageKeyTermsOptions = {}
): Promise<PassageResult> {
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);
  const count = Math.max(1, options.count ?? 5);
  const promptText = [
    `List the ${count} most important terms or points in this passage, one per line, each as "term — concise definition".`,
    "No preamble or meta commentary.",
    "",
    `Passage:\n${text}`,
  ].join("\n");

  return runPassageAction(
    {
      onDevice: () => onDevicePrompt("terms", promptText, options),
      cloud: async () =>
        emitWhole(
          (await extractKeyPoints(text, count)).map((point) => `- ${point}`).join("\n"),
          options
        ),
    },
    "Key terms",
    truncated
  );
}
