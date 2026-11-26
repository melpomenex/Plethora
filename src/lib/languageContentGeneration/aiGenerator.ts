import { isAnyAiAvailable, resolveAiPath, type AiPath } from "../ai/provider";
import { getActiveCloudConfig } from "../ai/providers/cloudProvider";
import { isCancelledError } from "../ai/errors";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition, AITaskResult, AITaskRunOptions } from "../ai/tasks/types";
import {
  checkNumber,
  checkString,
  isRecord,
  type ValidationOutcome,
} from "../ai/schemas/common";
import { contentFingerprint, digestText128 } from "../languageProcessing/fingerprints";
import { ensureCloudAiDisclosure } from "../privacy/cloudAiDisclosure";
import { useSettingsStore } from "../../stores/settingsStore";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import {
  ALL_CONTENT_GENERATION_ACTIONS,
  type ContentGenerationAction,
  type ContentGenerationMode,
  type GeneratedLanguageDocument,
  type LanguageContentGenerationRequest,
  type LanguageContentGenerator,
} from "./types";

const AI_GENERATOR_ID = "plethora-ai-language-content";
const AI_GENERATOR_VERSION = "1.0.0";
const MAX_SOURCE_SNIPPET_CHARS = 3200;
const MAX_VOCAB_ITEMS_IN_PROMPT = 48;

export interface AiGeneratedContentPayload {
  title: string;
  content: string;
  claimedCoveragePercent?: number;
}

const SUPPORTED_ACTION_SET = new Set<ContentGenerationAction>(ALL_CONTENT_GENERATION_ACTIONS);

const ACTION_INSTRUCTIONS: Record<ContentGenerationAction, string> = {
  generate: "Write engaging reading material tailored to the learner's level and vocabulary.",
  "short-story": "Write a cohesive short story with clear narrative flow tailored to the learner's vocabulary.",
  article: "Write an informative, natural article with clear headings or paragraphs.",
  dialogue: "Write a realistic multi-turn dialogue between speakers with clear speaker labels.",
  "explanatory-passage": "Write a clear explanatory passage introducing and illustrating the topic.",
  "graded-reader": "Write a graded reader chapter using controlled, high-frequency grammar and clear context clues.",
  "vocabulary-reinforcement": "Write natural text that weaves the learner's learning and target vocabulary repeatedly in memorable contexts.",
  "grammar-focus": "Write natural examples and connected prose highlighting the requested grammar focus.",
  "comprehension-exercise": "Write a short target-language reading passage followed by concise comprehension questions.",
  "listening-passage": "Write a natural spoken-style monologue or broadcast transcript suited for listening practice.",
  "personalized-conversation": "Write a personalized conversational prompt and natural sample turns tailored to the learner.",
  simplify: "Adapt the provided source document to use simpler vocabulary and shorter, clearer sentences while preserving core meaning.",
  "make-harder": "Adapt the provided source document to use richer vocabulary, more natural idioms, and more complex sentence structures while preserving core meaning.",
  harder: "Adapt the provided source document to use richer vocabulary, more natural idioms, and more complex sentence structures while preserving core meaning.",
  "explain-passages": "Adapt the provided source document by keeping the passage readable and adding concise target/base-language explanations of difficult expressions.",
  "rewrite-familiar": "Rewrite the provided source document using words the learner already knows or is familiar with, replacing rare words with simpler equivalents.",
  "shorter-version": "Condense the provided source document into a shorter, faithful summary version appropriate for the learner's level.",
  "graded-adaptation": "Produce a graded-reader adaptation of the provided source document calibrated to the learner's proficiency and target coverage.",
};

const LENGTH_GUIDANCE: Record<LanguageContentGenerationRequest["length"], { words: string; maxOutputTokens: number }> = {
  short: { words: "120-200 words", maxOutputTokens: 600 },
  medium: { words: "250-420 words", maxOutputTokens: 1100 },
  long: { words: "500-800 words", maxOutputTokens: 1800 },
};

function effectiveAction(request: LanguageContentGenerationRequest): ContentGenerationAction {
  if (request.action === "generate" && request.mode) return request.mode;
  return request.action;
}

function formatBoundedVocabulary(request: LanguageContentGenerationRequest): string {
  const items = request.learnerContext.items.slice(0, MAX_VOCAB_ITEMS_IN_PROMPT);
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const bucket = grouped.get(item.state) ?? [];
    const label = item.lemma && item.lemma !== item.surface
      ? `${item.surface} (${item.lemma})`
      : item.surface;
    bucket.push(label);
    grouped.set(item.state, bucket);
  }
  const lines: string[] = [];
  for (const state of ["known", "familiar", "learning", "encountered", "new"] as const) {
    const words = grouped.get(state);
    if (words && words.length > 0) {
      lines.push(`${state}: ${words.join(", ")}`);
    }
  }
  if (request.targetVocabulary?.length) {
    lines.push(`target_focus: ${request.targetVocabulary.slice(0, 20).join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "No prior learner vocabulary provided.";
}

export function validateAiGeneratedContentOutput(output: unknown): ValidationOutcome<AiGeneratedContentPayload> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["output: expected JSON object"] };
  }
  const title = checkString(output.title, "title", errors, { minLength: 1, maxLength: 200 });
  const content = checkString(output.content, "content", errors, { minLength: 1, maxLength: 24_000 });
  let claimedCoveragePercent: number | undefined;
  if (output.claimedCoveragePercent !== undefined) {
    claimedCoveragePercent = checkNumber(output.claimedCoveragePercent, "claimedCoveragePercent", errors, {
      min: 0,
      max: 100,
    });
  }
  if (errors.length > 0 || !title || !content) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title,
      content,
      ...(claimedCoveragePercent !== undefined ? { claimedCoveragePercent } : {}),
    },
  };
}

export const languageContentGenerationTask: AITaskDefinition<
  LanguageContentGenerationRequest,
  AiGeneratedContentPayload
> = {
  id: "language-content-generation",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "You are an expert language-learning content author.",
    "Write natural, accurate text in the requested target language calibrated to the learner's vocabulary and proficiency.",
    "When adapting source material, preserve its meaning while applying the requested adaptation without copying prompt instructions.",
    'Return ONLY a valid JSON object of the form {"title":"string","content":"string"} with no markdown fences or commentary.',
  ].join("\n"),
  buildInput: (request) => {
    const action = effectiveAction(request);
    const guidance = LENGTH_GUIDANCE[request.length] ?? LENGTH_GUIDANCE.medium;
    const lines: string[] = [
      `Action: ${action}`,
      `Instruction: ${ACTION_INSTRUCTIONS[action]}`,
      `Target language: ${request.targetLanguage}`,
      `Base language: ${request.baseLanguage}`,
      `Length target: ${request.length} (~${guidance.words})`,
    ];
    if (request.proficiency) {
      lines.push(`Learner proficiency: ${request.proficiency}`);
    }
    if (request.genre) {
      lines.push(`Genre: ${request.genre}`);
    }
    if (request.targetCoveragePercent !== undefined) {
      lines.push(
        `Target lexical coverage: ${Math.round(request.targetCoveragePercent)}% of words should come from the learner's known/familiar/learning vocabulary.`,
      );
    }
    if (request.topic.trim()) {
      lines.push("Topic:", wrapUntrustedBlock("topic", request.topic.trim().slice(0, 400)));
    }
    if (request.grammarFocus?.trim()) {
      lines.push("Grammar focus:", wrapUntrustedBlock("grammar-focus", request.grammarFocus.trim().slice(0, 400)));
    }
    lines.push(
      "Bounded learner vocabulary sample:",
      wrapUntrustedBlock("learner-vocabulary", formatBoundedVocabulary(request)),
    );

    const sourceSnippet = request.sourceText?.trim() || request.learnerContext.currentSource?.text?.trim();
    if (sourceSnippet) {
      lines.push(
        "Source document excerpt to adapt:",
        wrapUntrustedBlock("source-document", sourceSnippet.slice(0, MAX_SOURCE_SNIPPET_CHARS)),
      );
    }

    if (request.refinementFeedback) {
      const fb = request.refinementFeedback;
      lines.push(
        `Refinement attempt ${fb.attempt}: the previous draft measured ${fb.measuredCoveragePercent.toFixed(1)}% coverage against target ${fb.targetCoveragePercent.toFixed(1)}%.`,
        "Adjust vocabulary difficulty so the text hits the target lexical coverage while staying natural.",
      );
      if (fb.unknownWords?.length) {
        lines.push(
          "Unknown words detected in previous draft (replace or simplify most of these using known vocabulary):",
          wrapUntrustedBlock("unknown-words", fb.unknownWords.slice(0, 30).join(", ")),
        );
      }
      lines.push(
        "Previous draft:",
        wrapUntrustedBlock("previous-draft", fb.previousText.slice(0, MAX_SOURCE_SNIPPET_CHARS)),
      );
    }

    lines.push('Respond with ONLY JSON: {"title":"string","content":"string"}');
    return { text: lines.join("\n") };
  },
  outputKind: "structured",
  schema: {
    name: "LanguageContentGenerationOutput",
    nativeName: "LanguageContentGenerationOutput",
    json: '{"title":"string","content":"string"}',
  },
  validate: (output) => validateAiGeneratedContentOutput(output),
  maxOutputTokens: 1800,
  timeoutMs: 60_000,
  budgetPolicy: "estimate",
};

export interface AiLanguageContentGeneratorDeps {
  isAnyAiAvailableFn?: typeof isAnyAiAvailable;
  resolveAiPathFn?: typeof resolveAiPath;
  runTaskFn?: <I, O>(
    task: AITaskDefinition<I, O>,
    input: I,
    options?: AITaskRunOptions,
  ) => Promise<AITaskResult<O>>;
  getActiveCloudConfigFn?: typeof getActiveCloudConfig;
  ensureCloudAiDisclosureFn?: typeof ensureCloudAiDisclosure;
  getAiSettingsFn?: () => { strictLocalOnly?: boolean; allowCloudFallback?: boolean } | undefined;
  now?: () => number;
  createId?: () => string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

function makeGeneratedDocumentId(request: LanguageContentGenerationRequest, now: number, customId?: () => string): string {
  if (customId) {
    const id = customId();
    if (id && id !== request.sourceDocumentId) return id;
  }
  const suffix = digestText128(`${request.requestId}:${request.profileId}:${now}:${request.refinementFeedback?.attempt ?? 0}`).slice(0, 16);
  return `lang_gen_${suffix}`;
}

/**
 * AI-backed personalized language content generator and document adapter.
 * Routes through `runTask` (`resolveAiPath("prompt")` / `isAnyAiAvailable("prompt")`),
 * supports both on-device and configured cloud providers, and strictly enforces
 * `AbortSignal` and `allowCloud` / `privacy` boundaries.
 */
export function createAiLanguageContentGenerator(
  deps: AiLanguageContentGeneratorDeps = {},
): LanguageContentGenerator {
  const checkAiAvailable = deps.isAnyAiAvailableFn ?? isAnyAiAvailable;
  const resolvePath = deps.resolveAiPathFn ?? resolveAiPath;
  const executeTask = deps.runTaskFn ?? runTask;
  const activeCloudConfig = deps.getActiveCloudConfigFn ?? getActiveCloudConfig;
  const checkCloudDisclosure = deps.ensureCloudAiDisclosureFn ?? ensureCloudAiDisclosure;
  const getAiSettings = deps.getAiSettingsFn ?? (() => {
    try {
      return useSettingsStore.getState().settings?.ai;
    } catch {
      return undefined;
    }
  });
  const now = deps.now ?? Date.now;

  return {
    id: AI_GENERATOR_ID,
    version: AI_GENERATOR_VERSION,
    supports(action: ContentGenerationAction): boolean {
      return SUPPORTED_ACTION_SET.has(action);
    },
    async generate(request: LanguageContentGenerationRequest): Promise<GeneratedLanguageDocument> {
      throwIfAborted(request.signal);

      const available = await checkAiAvailable("prompt");
      throwIfAborted(request.signal);
      if (!available) {
        throw new Error("ai-provider-unavailable");
      }

      const path: AiPath = await resolvePath("prompt");
      throwIfAborted(request.signal);
      if (path === "none") {
        throw new Error("ai-provider-unavailable");
      }

      const aiSettings = getAiSettings();
      const strictLocalOnly = aiSettings?.strictLocalOnly === true;
      const cloudAllowed =
        request.privacy === "allow-cloud" &&
        request.allowCloud !== false &&
        !strictLocalOnly;

      let forcedKind: AITaskRunOptions["kind"];
      if (path === "cloud") {
        const cloudConfig = activeCloudConfig();
        const isLocalEndpoint = cloudConfig
          ? providerAllowsKeylessAccess(cloudConfig.provider, cloudConfig.baseUrl)
          : false;
        if (!isLocalEndpoint && !cloudAllowed) {
          throw new Error("cloud-ai-not-permitted");
        }
        if (!isLocalEndpoint) {
          const disclosed = await checkCloudDisclosure({
            featureClass: "ai_actions",
            provider: cloudConfig?.provider ?? "cloud",
            isLocal: false,
          });
          throwIfAborted(request.signal);
          if (!disclosed) {
            throw new Error("cloud-ai-disclosure-declined");
          }
        }
        forcedKind = "cloud";
      } else if (!cloudAllowed || aiSettings?.allowCloudFallback !== true) {
        // Pin on-device so `runTask` cannot silently fall back to cloud.
        forcedKind = "ondevice";
      }

      const guidance = LENGTH_GUIDANCE[request.length] ?? LENGTH_GUIDANCE.medium;
      const maxOutputTokens = request.maxOutputTokens ?? guidance.maxOutputTokens;
      const targetId = `${request.requestId}:${request.action}:${request.refinementFeedback?.attempt ?? 0}`;

      let result: AITaskResult<AiGeneratedContentPayload>;
      try {
        result = await executeTask(languageContentGenerationTask, request, {
          signal: request.signal,
          kind: forcedKind,
          maxOutputTokens,
          targetId,
        });
      } catch (error) {
        if (request.signal?.aborted || isCancelledError(error)) {
          throw new Error("cancelled");
        }
        throw error;
      }

      throwIfAborted(request.signal);

      const createdAt = now();
      const mode: ContentGenerationMode | undefined =
        request.mode ??
        (request.action !== "generate" &&
        !["simplify", "make-harder", "harder", "explain-passages", "rewrite-familiar", "shorter-version", "graded-adaptation"].includes(request.action)
          ? (request.action as ContentGenerationMode)
          : undefined);
      const sourceFingerprint =
        request.sourceFingerprint ??
        (request.sourceText ? contentFingerprint(request.sourceText) : undefined);

      return {
        documentId: makeGeneratedDocumentId(request, createdAt, deps.createId),
        profileId: request.profileId,
        title: result.output.title.trim() || request.topic.trim() || "Generated passage",
        content: result.output.content,
        sourceDocumentId: request.sourceDocumentId,
        sourceFingerprint,
        generatedFingerprint: contentFingerprint(result.output.content),
        targetLanguage: request.targetLanguage,
        measuredCoverageStatus: "pending",
        claimedCoveragePercent: result.output.claimedCoveragePercent,
        providerId: result.providerId,
        providerVersion: AI_GENERATOR_VERSION,
        modelId: result.baseModelName,
        createdAt,
        provenance: {
          requestId: request.requestId,
          action: request.action,
          privacy: result.providerKind === "cloud" && cloudAllowed ? "allow-cloud" : "local-only",
          mode,
          providerKind: result.providerKind,
          modelId: result.baseModelName,
          sourceDocumentId: request.sourceDocumentId,
        },
      };
    },
  };
}
