import { isGroqConfigured } from "../../api/groqTranscription";
import { type AiPath } from "../ai/provider";
import { createConfiguredShadowingProviders } from "../languageShadowing/providers";
import type { ShadowingRecognitionProvider } from "../languageShadowing";
import { createAiWritingProvider } from "../languageWriting/aiWritingProvider";
import type { WritingProvider } from "../languageWriting";
import type { PronunciationProviderManifest } from "../languagePronunciation";
import { createProductionReadingAssistRegistry, hasProductionReadingAssistProvider } from "../languageReadingAssist/productionRegistry";
import { createTranslationProviderRegistry } from "../languageTranslation/registry";
import { createMlKitTranslationProvider } from "../languageTranslation/mlkitTranslate";
import { createAppleTranslationProvider } from "../languageTranslation/appleTranslate";
import {
  createAiTranslationProvider,
  getEffectiveAiPathSync,
  isAiLocalExecutionSync,
} from "../languageTranslation/aiTranslate";
import { isNativeMobile, isTauri, nativePlatform } from "../tauri";
import type {
  LanguageHostCapability,
  LanguageHostCapabilityName,
  LanguageHostSurface,
} from "./types";
import { LANGUAGE_HOST_CAPABILITY_NAMES } from "./types";
import type { LanguageProfile } from "../../types/languageProfile";

function isAndroid(): boolean {
  if (!isTauri() || !isNativeMobile()) return false;
  const platform = nativePlatform();
  return platform === null ? true : platform === "android";
}

function unavailable(name: LanguageHostCapabilityName, reason: LanguageHostCapability["reason"], detail?: string): LanguageHostCapability {
  return { name, available: false, offline: false, reason, detail };
}

function available(name: LanguageHostCapabilityName, offline: boolean, detail?: string): LanguageHostCapability {
  return { name, available: true, offline, detail };
}

export interface LanguageHostCapabilityInput {
  surface: LanguageHostSurface;
  profile?: LanguageProfile | null;
  aiPath?: AiPath;
}

function translationAvailable(profile?: LanguageProfile | null, aiPath?: AiPath): LanguageHostCapability {
  const effectiveAiPath = getEffectiveAiPathSync(aiPath);
  const registry = createTranslationProviderRegistry([
    createMlKitTranslationProvider(),
    createAppleTranslationProvider(),
    createAiTranslationProvider({ aiPath: effectiveAiPath }),
  ]);
  const source = profile?.targetLanguage ?? "es";
  const target = profile?.baseLanguage ?? "en";
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const selection = registry.select({
    sourceLanguage: source,
    targetLanguage: target,
    policy: { privacy: "allow-cloud", offline: isOffline },
  });
  if (selection.provider) {
    return available("translation", selection.provider.capabilities.offlineAvailable, selection.provider.id);
  }
  const reason = selection.considered.find((candidate) => candidate.reason)?.reason;
  return unavailable(
    "translation",
    reason === "offline" ? "offline" : reason === "privacy-blocked" ? "privacy-blocked" : "unsupported-capability",
    "No translation provider is configured for this language pair.",
  );
}

export function createProductionShadowingProviders(): readonly ShadowingRecognitionProvider[] {
  return createConfiguredShadowingProviders();
}

export function createProductionPronunciationManifest(
  providers: readonly ShadowingRecognitionProvider[],
): PronunciationProviderManifest | undefined {
  const provider = providers[0];
  if (!provider) return undefined;
  return {
    providerId: provider.id,
    providerVersion: provider.version,
    capabilities: provider.route === "cloud" ? ["transcription", "word-confidence"] : ["transcription"],
    languages: ["*"],
    sendsAudioOffDevice: provider.route === "cloud",
    maxAudioMs: 120_000,
    configured: true,
  };
}

/** Truthful runtime capability map for production Language Mode hosts. */
export function resolveLanguageHostCapabilities(
  input: LanguageHostCapabilityInput,
): Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>> {
  const effectiveAiPath = getEffectiveAiPathSync(input.aiPath);
  const aiAvailable = effectiveAiPath !== "none";
  const aiOffline = isAiLocalExecutionSync(effectiveAiPath);
  const shadowingProviders = createProductionShadowingProviders();
  const writingProvider = createAiWritingProvider({ aiPath: effectiveAiPath });
  const readingAssist = hasProductionReadingAssistProvider();
  const translation = translationAvailable(input.profile, effectiveAiPath);
  const practiceDetail = [
    "dictation",
    shadowingProviders.length > 0 ? "stt" : null,
    writingProvider ? "writing" : null,
  ].filter(Boolean).join("+");

  const map = Object.fromEntries(
    LANGUAGE_HOST_CAPABILITY_NAMES.map((name) => {
      switch (name) {
        case "analysis":
        case "annotations":
        case "peek":
        case "sentenceMode":
        case "mining":
          return [name, available(name, true)];
        case "translation":
          return [name, translation];
        case "readingAssist":
          return [name, readingAssist
            ? available("readingAssist", false, "plethora-ai-gloss")
            : unavailable("readingAssist", "unsupported-capability", "No reading-assist provider is configured.")];
        case "tutor":
          return [name, aiAvailable
            ? available("tutor", aiOffline, effectiveAiPath === "ondevice" ? "ondevice-ai" : "configured-ai")
            : unavailable("tutor", "unsupported-capability", "Configure an AI provider to use the language tutor.")];
        case "practice":
          return [name, available(
            "practice",
            true,
            practiceDetail,
          )];
        case "originalAudio":
          return [name, available("originalAudio", true)];
        case "frameCapture":
          return [name, unavailable("frameCapture", "unsupported-capability", "Frame capture is not available.")];
        default:
          return [name, unavailable(name as LanguageHostCapabilityName, "unsupported-capability")];
      }
    }),
  ) as Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;

  return map;
}

export function createProductionLanguageHostBindings(aiPath?: AiPath) {
  const effectiveAiPath = getEffectiveAiPathSync(aiPath);
  const shadowingProviders = createProductionShadowingProviders();
  return {
    shadowingProviders,
    writingProvider: createAiWritingProvider({ aiPath: effectiveAiPath }),
    pronunciationManifest: createProductionPronunciationManifest(shadowingProviders),
    readingAssistRegistry: createProductionReadingAssistRegistry(),
    defaultSttRoute: shadowingProviders.some((provider) => provider.route === "local")
      ? "local" as const
      : isGroqConfigured()
        ? "cloud" as const
        : "local" as const,
  };
}

export function isAndroidMlKitTranslationAvailable(): boolean {
  return isAndroid();
}
