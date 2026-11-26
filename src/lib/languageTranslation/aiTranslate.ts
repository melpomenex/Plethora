import { getActiveCloudConfig } from "../ai/providers/cloudProvider";
import { hasCloudProvider, prefersOnDevice, resolveAiPath, type AiPath } from "../ai/provider";
import { runTask } from "../ai/tasks/runTask";
import type { AITaskDefinition } from "../ai/tasks/types";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import { useSettingsStore } from "../../stores/settingsStore";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import type { TranslationProviderCapabilities } from "./capability";
import type { TranslationProvider } from "./provider";

export interface LanguageTranslationTaskInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

const languageTranslationTask: AITaskDefinition<LanguageTranslationTaskInput, string> = {
  id: "language-sentence-translation",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nTranslate the sentence into the requested target language. Return only the translation with no preamble, quotes, or explanation.`,
  buildInput: ({ text, sourceLanguage, targetLanguage }) => ({
    text: [
      `Source language: ${sourceLanguage}`,
      `Target language: ${targetLanguage}`,
      "Sentence:",
      wrapUntrustedBlock("sentence", text),
    ].join("\n"),
  }),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 45_000,
  budgetPolicy: "pre-budgeted",
};

let cachedAiPath: AiPath | null = null;

function hasLocalDecisionEngine(): boolean {
  const engine = useSettingsStore.getState().settings.daqe?.decisionEngine;
  return Boolean(engine?.baseUrl?.trim() && engine?.model?.trim());
}

/** Refresh cached AI routing path asynchronously using the shared AI resolver. */
export async function refreshAiTranslationPath(): Promise<AiPath> {
  let path: AiPath = "none";
  try {
    path = await resolveAiPath("prompt");
  } catch {
    path = hasCloudProvider() ? "cloud" : "none";
  }
  if (path === "none" && prefersOnDevice() && hasLocalDecisionEngine()) {
    path = "ondevice";
  }
  cachedAiPath = path;
  return path;
}

/** Synchronous best-known AI path from cached probe + live store state. */
export function getEffectiveAiPathSync(explicitAiPath?: AiPath): AiPath {
  if (explicitAiPath) return explicitAiPath;
  if (cachedAiPath === "ondevice" && prefersOnDevice()) return "ondevice";
  if (prefersOnDevice() && hasLocalDecisionEngine()) return "ondevice";
  if (hasCloudProvider()) return "cloud";
  return "none";
}

/** True when the effective AI path keeps text on the local device. */
export function isAiLocalExecutionSync(explicitAiPath?: AiPath): boolean {
  const path = getEffectiveAiPathSync(explicitAiPath);
  if (path === "ondevice") return true;
  if (path !== "cloud") return false;
  const active = getActiveCloudConfig();
  return active ? providerAllowsKeylessAccess(active.provider, active.baseUrl) : false;
}

/** Reset cached AI path (useful in tests). */
export function resetAiTranslationPathCache(): void {
  cachedAiPath = null;
}

function capabilitiesForAiPath(path: AiPath): TranslationProviderCapabilities {
  if (path === "ondevice") {
    return {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: true,
      supportsCancellation: true,
      privacyDisclosure: "On-device AI translation. Sentence text stays on this device.",
    };
  }
  if (path === "cloud") {
    const active = getActiveCloudConfig();
    const isLocalEndpoint = active ? providerAllowsKeylessAccess(active.provider, active.baseUrl) : false;
    return {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: isLocalEndpoint,
      sendsTextOffDevice: !isLocalEndpoint,
      requiresCredentials: false,
      configured: true,
      supportsCancellation: true,
      model: active?.model,
      privacyDisclosure: isLocalEndpoint
        ? "Local AI endpoint translation. Sentence text stays on this device."
        : "Sentence text may be sent to your configured AI provider for translation.",
    };
  }
  return {
    sentenceTranslation: true,
    supportedLanguagePairs: ["*"],
    offlineAvailable: false,
    sendsTextOffDevice: true,
    requiresCredentials: false,
    configured: false,
    supportsCancellation: true,
    privacyDisclosure: "Configure an on-device or cloud AI provider for translation.",
  };
}

/** Cloud/on-device AI translation routed through the existing task layer. */
export function createAiTranslationProvider(options?: { aiPath?: AiPath }): TranslationProvider {
  return {
    id: "plethora-ai-translate",
    kind: "ai",
    version: "1.0.0",
    get capabilities(): TranslationProviderCapabilities {
      return capabilitiesForAiPath(getEffectiveAiPathSync(options?.aiPath));
    },
    translate: async (request, callOptions) => {
      const result = await runTask(
        languageTranslationTask,
        {
          text: request.text,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
        },
        { signal: callOptions?.signal, targetId: request.cacheKey },
      );
      return { translatedText: result.output.trim() };
    },
  };
}
