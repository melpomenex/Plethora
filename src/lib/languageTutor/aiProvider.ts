import { useSettingsStore } from "../../stores/settingsStore";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import { isCancelledError } from "../ai/errors";
import { isAnyAiAvailable, resolveAiPath, type AiPath } from "../ai/provider";
import { getActiveCloudConfig } from "../ai/providers/cloudProvider";
import {
  checkEnum,
  checkString,
  checkStringArray,
  isRecord,
  type ValidationOutcome,
} from "../ai/schemas/common";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition, AITaskResult, AITaskRunOptions } from "../ai/tasks/types";
import { ensureCloudAiDisclosure } from "../privacy/cloudAiDisclosure";
import { redactTutorMaterial, resolveTutorPrivacyPolicy } from "./privacy";
import { LanguageTutorService } from "./service";
import {
  ALL_TUTOR_MODES,
  type LanguageTutorProvider,
  type TutorAttribution,
  type TutorMode,
  type TutorRequest,
  type TutorResponse,
} from "./types";

const AI_TUTOR_PROVIDER_ID = "plethora-ai-language-tutor";
const AI_TUTOR_PROVIDER_VERSION = "1.0.0";
const MAX_VOCAB_ITEMS_IN_PROMPT = 24;
const MAX_HISTORY_TURNS_IN_PROMPT = 6;
const MAX_HISTORY_TURN_CHARS = 600;
const MAX_MESSAGE_CHARS = 1200;
const MAX_SOURCE_CHARS = 1200;

export interface AiTutorResponsePayload {
  text: string;
  attribution: TutorAttribution;
  targetEntryIds: string[];
}

export interface TutorModeMetadata {
  mode: TutorMode;
  label: string;
  description: string;
}

export const TUTOR_MODE_INSTRUCTIONS: Readonly<Record<TutorMode, string>> = {
  explain:
    "Explain the selected word, phrase, or passage in the base language with clear examples calibrated to the learner's vocabulary, separating source-grounded facts from general guidance.",
  roleplay:
    "Conduct an interactive roleplay scenario in the target language tailored to the learner's vocabulary and proficiency, staying in character and inviting the learner's next response.",
  rewrite:
    "Provide 2-3 natural rewrites or paraphrases in the target language (simpler, natural/idiomatic, and formal) and briefly explain the differences in the base language.",
  grammar:
    "Analyze the key grammatical structures, morphology, or syntax in the text and explain the rules concisely in the base language with targeted examples.",
  pronunciation:
    "Provide clear pronunciation guidance for the target text (syllable stress, challenging sounds, connected speech, tone/pitch notes, and phonetic cues) without fabricating audio scores.",
  collocation:
    "Highlight natural collocations, idioms, and high-frequency word partnerships around the target expression, contrasting natural pairings with common literal mistakes.",
  translate:
    "Provide an accurate, context-aware translation into the base language along with literal vs. idiomatic nuance notes and key lexical choices.",
  "minimal-pair":
    "Create focused minimal-pair contrasts (phonological, orthographic, or near-synonym pairs) related to the target text to sharpen the learner's discrimination.",
  conversation:
    "Practice a short, natural conversation in the target language using the learner's bounded vocabulary context, correcting only material errors.",
  correction:
    "Identify errors by category (grammar, morphology, spelling, word-choice, register, naturalness), explain each reason concisely, and preserve the learner's original wording.",
  practice:
    "Prompt the learner with short, targeted production exercises drawing on words from their bounded vocabulary context.",
};

export const TUTOR_MODE_METADATA: readonly TutorModeMetadata[] = [
  { mode: "explain", label: "Explain", description: "Source-grounded explanation calibrated to your vocabulary" },
  { mode: "roleplay", label: "Roleplay", description: "Interactive target-language scenario at your level" },
  { mode: "rewrite", label: "Rewrite", description: "Simpler, idiomatic, and formal target-language alternatives" },
  { mode: "grammar", label: "Grammar", description: "Concise grammar and structure breakdown in context" },
  { mode: "pronunciation", label: "Pronunciation", description: "Stress, rhythm, tone, and tricky sound guidance" },
  { mode: "collocation", label: "Collocation", description: "Natural word partnerships and idiomatic pairings" },
  { mode: "translate", label: "Translate", description: "Context-aware translation with nuance notes" },
  { mode: "minimal-pair", label: "Minimal Pair", description: "Targeted sound, spelling, or meaning contrasts" },
  { mode: "conversation", label: "Conversation", description: "Short guided chat with gentle error correction" },
  { mode: "correction", label: "Correction", description: "Categorized feedback preserving your wording" },
  { mode: "practice", label: "Vocab Practice", description: "Short active production prompts from your lexicon" },
];

const SUPPORTED_MODE_SET = new Set<TutorMode>(ALL_TUTOR_MODES);

function defaultAttributionForRequest(request: TutorRequest): TutorAttribution {
  if (request.context.currentSource?.text) return "grounded";
  if (
    request.mode === "roleplay" ||
    request.mode === "rewrite" ||
    request.mode === "practice" ||
    request.mode === "minimal-pair"
  ) {
    return "generated";
  }
  return "general";
}

function formatBoundedContextItems(request: TutorRequest): string {
  const items = request.context.items.slice(0, MAX_VOCAB_ITEMS_IN_PROMPT);
  if (items.length === 0) return "No prior learner lexicon items supplied.";
  return items
    .map((item) => {
      const lemmaNote = item.lemma && item.lemma !== item.surface ? ` lemma=${item.lemma}` : "";
      return `${item.entryId} | ${item.surface}${lemmaNote} | state=${item.state} | evidence=${item.evidenceCount}`;
    })
    .join("\n");
}

export function validateAiTutorResponse(
  output: unknown,
  input: TutorRequest,
): ValidationOutcome<AiTutorResponsePayload> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["output: expected JSON object"] };
  }
  const text = checkString(output.text, "text", errors, { minLength: 1, maxLength: 8000 });
  let attribution: TutorAttribution | undefined;
  if (output.attribution !== undefined) {
    attribution = checkEnum(
      output.attribution,
      ["grounded", "generated", "general"] as const,
      "attribution",
      errors,
    );
  } else {
    attribution = defaultAttributionForRequest(input);
  }

  let targetEntryIds: string[] = [];
  if (output.targetEntryIds !== undefined) {
    const parsedIds = checkStringArray(output.targetEntryIds, "targetEntryIds", errors, {
      max: MAX_VOCAB_ITEMS_IN_PROMPT,
      maxLength: 128,
    });
    if (parsedIds) {
      const allowedIds = new Set(input.context.items.map((item) => item.entryId));
      targetEntryIds = [...new Set(parsedIds.filter((id) => allowedIds.has(id)))];
    }
  }

  if (errors.length > 0 || !text || !attribution) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      text,
      attribution,
      targetEntryIds,
    },
  };
}

export const languageTutorTask: AITaskDefinition<TutorRequest, AiTutorResponsePayload> = {
  id: "language-tutor-turn",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "You are Plethora's learner-aware language tutor.",
    "Adapt your response to the learner's target language, base language, proficiency, and bounded vocabulary context.",
    "Follow the requested tutor mode instruction precisely.",
    "Ground explanations in the provided current source excerpt whenever one is supplied; never fabricate citations or entry IDs.",
    'Return ONLY a valid JSON object of the form {"text":"string","attribution":"grounded|generated|general","targetEntryIds":["string"]} with no markdown fences or commentary.',
  ].join("\n"),
  buildInput: (request) => {
    const modeInstruction = TUTOR_MODE_INSTRUCTIONS[request.mode] ?? TUTOR_MODE_INSTRUCTIONS.explain;
    const lines: string[] = [
      `Mode: ${request.mode}`,
      `Mode instruction: ${modeInstruction}`,
      `Target language: ${request.context.targetLanguage}`,
      `Base language: ${request.context.baseLanguage}`,
    ];

    if (request.context.proficiency?.trim()) {
      lines.push(
        "Learner proficiency:",
        wrapUntrustedBlock("learner-proficiency", redactTutorMaterial(request.context.proficiency, 120)),
      );
    }

    if (request.context.lexiconSummary) {
      const summary = request.context.lexiconSummary;
      lines.push(
        `Lexicon overview (aggregate counts): total=${summary.totalEntries}, known=${summary.knownCount}, familiar=${summary.familiarCount}, learning=${summary.learningCount}, encountered=${summary.encounteredCount}, new=${summary.newCount}`,
      );
    }

    if (request.targetLexicalCoveragePercent !== undefined) {
      const bounded = Math.max(0, Math.min(100, Math.round(request.targetLexicalCoveragePercent)));
      lines.push(`Soft lexical familiarity target: ~${bounded}% known/familiar vocabulary.`);
    }

    if (request.correctionLevel) {
      lines.push(`Correction granularity: ${request.correctionLevel}`);
    }

    lines.push(
      "Bounded learner vocabulary sample (use entry IDs only when directly referenced):",
      wrapUntrustedBlock("learner-vocabulary", formatBoundedContextItems(request)),
    );

    if (request.context.currentSource?.text) {
      const docHint = request.context.currentSource.documentId
        ? ` (document ${request.context.currentSource.documentId})`
        : "";
      lines.push(
        `Current source excerpt${docHint}:`,
        wrapUntrustedBlock(
          "current-source",
          redactTutorMaterial(request.context.currentSource.text, MAX_SOURCE_CHARS),
        ),
      );
    }

    if (request.conversationHistory?.length) {
      const recent = request.conversationHistory.slice(-MAX_HISTORY_TURNS_IN_PROMPT);
      lines.push("Recent conversation turns (oldest first):");
      recent.forEach((turn, index) => {
        lines.push(
          `${turn.role === "user" ? "Learner" : "Tutor"}: ${wrapUntrustedBlock(
            `history-${index + 1}-${turn.role}`,
            redactTutorMaterial(turn.text, MAX_HISTORY_TURN_CHARS),
          )}`,
        );
      });
    }

    lines.push(
      "Learner request / selected text:",
      wrapUntrustedBlock("learner-message", redactTutorMaterial(request.message, MAX_MESSAGE_CHARS)),
      'Respond with ONLY JSON: {"text":"string","attribution":"grounded|generated|general","targetEntryIds":["string"]}',
    );

    return { text: lines.join("\n") };
  },
  outputKind: "structured",
  schema: {
    name: "LanguageTutorResponse",
    nativeName: "LanguageTutorResponse",
    json: '{"text":"string","attribution":"grounded|generated|general","targetEntryIds":["string"]}',
  },
  validate: (output, input) => validateAiTutorResponse(output, input),
  maxOutputTokens: 900,
  timeoutMs: 60_000,
  budgetPolicy: "estimate",
};

export interface AiLanguageTutorProviderDeps {
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
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

function buildBoundedRequest(request: TutorRequest): TutorRequest {
  const safeItems = request.context.items.slice(0, MAX_VOCAB_ITEMS_IN_PROMPT).map((item) => ({
    ...item,
    redacted: true,
  }));
  const safeSource = request.context.currentSource?.text
    ? {
        documentId: request.context.currentSource.documentId,
        text: redactTutorMaterial(request.context.currentSource.text, MAX_SOURCE_CHARS),
        redacted: true,
      }
    : undefined;
  return {
    ...request,
    message: redactTutorMaterial(request.message, MAX_MESSAGE_CHARS),
    context: {
      ...request.context,
      items: safeItems,
      currentSource: safeSource,
    },
  };
}

/**
 * Production learner-aware `LanguageTutorProvider` backed by Plethora's shared
 * `runTask` / `resolveAiPath` layer. Supports all tutor modes, on-device offline
 * execution, explicit cloud opt-in/disclosure, prompt-injection containment, and
 * `AbortSignal` cancellation.
 */
export function createAiLanguageTutorProvider(
  deps: AiLanguageTutorProviderDeps = {},
): LanguageTutorProvider {
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
    id: AI_TUTOR_PROVIDER_ID,
    version: AI_TUTOR_PROVIDER_VERSION,
    supports(mode: TutorMode): boolean {
      return SUPPORTED_MODE_SET.has(mode);
    },
    async respond(request: TutorRequest): Promise<TutorResponse> {
      throwIfAborted(request.signal);
      if (!SUPPORTED_MODE_SET.has(request.mode)) {
        throw new Error("unsupported-tutor-mode");
      }
      if (request.profileId !== request.context.profileId) {
        throw new Error("invalid-tutor-context");
      }
      if (!request.message.trim()) {
        throw new Error("empty-tutor-message");
      }

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
      const cloudConfig = activeCloudConfig();
      const isLocalEndpoint = cloudConfig
        ? providerAllowsKeylessAccess(cloudConfig.provider, cloudConfig.baseUrl)
        : false;
      const cloudExplicitlyBlocked =
        request.privacy === "local-only" ||
        request.allowCloud === false ||
        request.cloudConsent === false ||
        strictLocalOnly;

      const resolvedConsent: boolean | null =
        request.cloudConsent !== undefined
          ? request.cloudConsent
          : request.privacy === "allow-cloud" && request.allowCloud !== false
            ? true
            : null;

      const policy = resolveTutorPrivacyPolicy({
        aiPath: path,
        cloudConsent: cloudExplicitlyBlocked ? false : resolvedConsent,
        hasByoProvider: Boolean(cloudConfig),
        isLocalEndpoint,
      });

      let forcedKind: AITaskRunOptions["kind"];
      if (path === "cloud") {
        if (!isLocalEndpoint && cloudExplicitlyBlocked) {
          throw new Error("cloud-ai-not-permitted");
        }
        if (policy.requiresConsent && !policy.consented) {
          throw new Error("cloud-ai-consent-required");
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
      } else {
        const cloudFallbackPermitted =
          !cloudExplicitlyBlocked &&
          policy.path !== "none" &&
          (request.privacy === "allow-cloud" || request.cloudConsent === true) &&
          aiSettings?.allowCloudFallback === true;
        if (!cloudFallbackPermitted) {
          // Pin on-device so `runTask` cannot silently fall back to cloud.
          forcedKind = "ondevice";
        }
      }

      const boundedRequest = buildBoundedRequest(request);
      const targetId = `lang-tutor:${boundedRequest.profileId}:${boundedRequest.mode}:${boundedRequest.message}`;

      let result: AITaskResult<AiTutorResponsePayload>;
      try {
        result = await executeTask(languageTutorTask, boundedRequest, {
          signal: request.signal,
          kind: forcedKind,
          targetId,
        });
      } catch (error) {
        if (request.signal?.aborted || isCancelledError(error)) {
          throw new Error("cancelled");
        }
        throw error;
      }

      throwIfAborted(request.signal);

      const sentOffDevice = result.providerKind === "cloud" && !isLocalEndpoint;

      return {
        text: result.output.text,
        attribution: result.output.attribution,
        targetEntryIds: result.output.targetEntryIds,
        providerId: result.providerId || AI_TUTOR_PROVIDER_ID,
        providerVersion: AI_TUTOR_PROVIDER_VERSION,
        createdAt: now(),
        modelId: result.baseModelName,
        providerKind: result.providerKind,
        privacyPath: sentOffDevice ? policy.path : "local",
        sendsMaterialOffDevice: sentOffDevice,
      };
    },
  };
}

/** Production `LanguageTutorService` wired to `createAiLanguageTutorProvider()`. */
export function createProductionLanguageTutorService(
  deps: AiLanguageTutorProviderDeps = {},
): LanguageTutorService {
  return new LanguageTutorService([createAiLanguageTutorProvider(deps)]);
}
