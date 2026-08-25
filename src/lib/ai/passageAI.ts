/**
 * Task adapters for passage-level AI actions (explain, summarize, simplify,
 * key terms, Q&A).
 *
 * Every adapter routes through `runAiAction`, so the on-device/cloud
 * decision, the fallback toast and the cancellation semantics live in one
 * place; each branch executes the corresponding `AITaskDefinition` through
 * `runTask` (design D4/D30) with static system instructions and untrusted
 * passage blocks. The passage is truncated to the on-device token budget
 * before sending and the result carries a `truncated` flag so the UI can say
 * the input was shortened.
 */

import { OnDeviceAiError } from "./onDeviceAI";
import {
  chunkTextByTokens,
  resolveTokenBudget,
  DEFAULT_TOKEN_BUDGET,
} from "./chunkTextByTokens";
import { checkAnswerGrounding } from "./cardValidator";
import { runAiAction, hasCloudProvider } from "./provider";
import { fnv1aHash } from "./providers/types";
import { runTask } from "./tasks/runTask";
import type { AITaskDefinition } from "./tasks/types";
import { ensureCloudAiDisclosure } from "../privacy/cloudAiDisclosure";
import { getActiveCloudConfig } from "./providers/cloudProvider";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import { AIError } from "./errors";
import {
  DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  DETAILED_PASSAGE_MAX_OUTPUT_TOKENS,
  explainPassageTask,
  passageKeyTermsTask,
  passageQATask,
  passageSimplifyTask,
  passageSummarizeTask,
  type ExplanationPreset,
} from "./tasks/definitions/passageTasks";
import type { SimplificationLevel } from "../../api/ai";

export {
  DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS,
  DETAILED_PASSAGE_MAX_OUTPUT_TOKENS,
};
export type { ExplanationPreset };

/** Headroom left for the prompt instructions wrapped around the passage. */
const PROMPT_RESERVE_TOKENS = 200;

export interface PassageActionOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  /** Token budget for the passage itself. Defaults to the chunker's default. */
  maxTokens?: number;
  /** Maximum generated output tokens. Defaults to DEFAULT_PASSAGE_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /** Skip on-device routing and run through the configured cloud provider. */
  cloudOnly?: boolean;
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
export function fitPassage(passage: string, maxTokens?: number): { passage: string; truncated: boolean } {
  const trimmed = passage.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Passage text cannot be empty.");
  }
  const budget = resolveTokenBudget((maxTokens ?? DEFAULT_TOKEN_BUDGET) - PROMPT_RESERVE_TOKENS);
  const chunks = chunkTextByTokens(trimmed, budget);
  return { passage: chunks[0], truncated: chunks.length > 1 };
}

function toDraft(result: { text: string; baseModelName?: string }): Draft {
  return { text: result.text, baseModelName: result.baseModelName };
}

/** Run a passage task on both branches of `runAiAction`, mapping to a Draft. */
async function runPassageTask<I>(
  task: AITaskDefinition<I, string>,
  input: I,
  options: PassageActionOptions,
  targetId: string,
  label: string,
  truncated: boolean
): Promise<PassageResult> {
  if (options.cloudOnly) {
    if (!hasCloudProvider()) {
      throw new OnDeviceAiError("model_unavailable", "No cloud AI provider is configured.");
    }
    const config = getActiveCloudConfig();
    const isLocal = config
      ? providerAllowsKeylessAccess(config.provider, config.baseUrl)
      : false;
    const disclosed = await ensureCloudAiDisclosure({
      featureClass: "ai_actions",
      provider: config?.provider ?? "cloud",
      isLocal,
    });
    if (!disclosed) {
      throw new AIError("FeatureDisabled", "Cloud AI disclosure was not accepted.", {
        code: "permission_denied",
      });
    }
    const draft = await runTask(task, input, {
      targetId,
      kind: "cloud",
      signal: options.signal,
      onChunk: options.onChunk,
      onRetry: options.onRetry,
      maxOutputTokens: options.maxOutputTokens,
    }).then(toDraft);
    return { ...draft, truncated };
  }

  const res = await runAiAction(
    {
      onDevice: () =>
        runTask(task, input, {
          targetId,
          kind: "ondevice",
          signal: options.signal,
          onChunk: options.onChunk,
          onRetry: options.onRetry,
          maxOutputTokens: options.maxOutputTokens,
        }).then(toDraft),
      cloud: () =>
        runTask(task, input, {
          targetId,
          kind: "cloud",
          signal: options.signal,
          onChunk: options.onChunk,
          onRetry: options.onRetry,
          maxOutputTokens: options.maxOutputTokens,
        }).then(toDraft),
    },
    label
  );
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
  const targetId = fnv1aHash(`passage-qa\u0000${trimmedQ}\u0000${text}`);

  const result = await runPassageTask(
    passageQATask,
    { question: trimmedQ, passage: text },
    options,
    targetId,
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

/**
 * Explain a passage according to a preset.
 */
export async function explainPassage(
  passage: string,
  options: PassageExplainOptions = {}
): Promise<PassageResult> {
  const { passage: text, truncated } = fitPassage(passage, options.maxTokens);
  const preset = options.preset ?? "simple";
  const task = explainPassageTask(preset);
  const targetId = fnv1aHash(`${task.id}\u0000${text}`);

  return runPassageTask(task, { passage: text }, options, targetId, "Explanation", truncated);
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
  const targetId = fnv1aHash(`passage-summarize\u0000${maxWords}\u0000${text}`);

  return runPassageTask(
    passageSummarizeTask,
    { passage: text, maxWords },
    options,
    targetId,
    "Summary",
    truncated
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
  const targetId = fnv1aHash(`passage-simplify\u0000${level}\u0000${text}`);

  return runPassageTask(
    passageSimplifyTask,
    { passage: text, level },
    options,
    targetId,
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
  const targetId = fnv1aHash(`passage-key-terms\u0000${count}\u0000${text}`);

  return runPassageTask(
    passageKeyTermsTask,
    { passage: text, count },
    options,
    targetId,
    "Key terms",
    truncated
  );
}
