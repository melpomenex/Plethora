import type { ModelProfile } from "../api/transcription";
import { getOpenRouterApiKey } from "../services/transcription/providers/OpenRouterAsrProvider";
import type {
  SessionTranscriptionAuthorization,
  SessionTranscriptionPlanResult,
} from "../services/transcription/types";
import {
  acknowledgeCloudAiDisclosure,
  isCloudAiDisclosed,
  resolveCloudAiProviderClass,
  type CloudAiDisclosurePresenter,
} from "./privacy/cloudAiDisclosure";

export interface TranscriptionAudioSettings {
  provider: "local" | "groq" | "apple" | "android-ondevice" | "openrouter";
  mode?: "auto" | "fast" | "enhanced" | "realtime" | "offline";
  sttProvider?: "automatic" | "local" | "openrouter" | "premium";
  sttModel?: "automatic" | string;
  preferLocal?: boolean;
  automaticFallback?: boolean;
  preferredModelId?: string;
  language: string;
  groq: {
    apiKey: string;
    model: "whisper-large-v3" | "whisper-large-v3-turbo";
  };
  androidOnDevice?: {
    modelId?: string;
    pacing: "capped" | "full";
  };
}

export const MODEL_QUALITY_RANK = [
  "nemotron-3.5-asr-0.6b",
  "nvidia/nemotron-3.5-asr-0.6b",
  "cactus-whistle",
  "Cactus-Compute/whistle",
  "parakeet-tdt-ctc-110m",
  "sense-voice-small",
  "small",
  "distil-small.en",
  "base",
] as const;

export function isNemotronModelId(id?: string | null): boolean {
  if (!id) return false;
  const lower = id.toLowerCase();
  return lower.includes("nemotron");
}

export function isWhistleModelId(id?: string | null): boolean {
  if (!id) return false;
  const lower = id.toLowerCase();
  return lower.includes("whistle");
}

export type TranscriptionPlatform = "desktop" | "native-mobile";

export type Resolution =
  | {
      ok: true;
      provider: "local" | "groq" | "apple" | "android-ondevice" | "openrouter";
      modelId: string;
      modelLabel: string;
      /** Android on-device was chosen even though the user never picked it. */
      autoOnDevice?: boolean;
      substitution?:
        | "mobile-no-local"
        | "mobile-groq-substitute"
        | "on-device-unavailable"
        | "nemotron-cloud-substitute";
    }
  | {
      ok: false;
      reason:
        | "missing-groq-key"
        | "missing-openrouter-key"
        | "model-not-installed"
        | "no-model-selected"
        | "on-device-model-not-ready"
        | "mobile-local-unsupported";
      modelId?: string;
      modelLabel?: string;
      substitution?: "mobile-no-local" | "on-device-unavailable";
    };

export type FailedResolution = Extract<Resolution, { ok: false }>;
export type SuccessfulResolution = Extract<Resolution, { ok: true }>;

const GROQ_MODEL_LABELS: Record<string, string> = {
  "whisper-large-v3": "Whisper Large v3",
  "whisper-large-v3-turbo": "Whisper Large v3 Turbo",
};

function groqModelLabel(modelId: string): string {
  return GROQ_MODEL_LABELS[modelId] ?? modelId;
}

function profileLabel(profiles: ModelProfile[], modelId: string): string {
  return profiles.find((profile) => profile.id === modelId)?.name ?? modelId;
}

function bestInstalledProfile(profiles: ModelProfile[]): ModelProfile | undefined {
  const rank = new Map<string, number>(
    MODEL_QUALITY_RANK.map((id, index) => [id, index]),
  );
  return profiles
    .filter((profile) => profile.installed)
    .sort((left, right) => {
      const leftRank = isNemotronModelId(left.id) || isNemotronModelId(left.name)
        ? -1
        : (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER);
      const rightRank = isNemotronModelId(right.id) || isNemotronModelId(right.name)
        ? -1
        : (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return leftRank - rightRank;
    })[0];
}

function appleResolution(): Extract<Resolution, { ok: true }> {
  return {
    ok: true,
    provider: "apple",
    modelId: "apple-speech",
    modelLabel: "Apple Speech",
  };
}

export interface ResolveTranscriptionOptions {
  appleReady?: boolean;
  androidSttReady?: boolean;
  localNemotronReady?: boolean;
  localWhistleReady?: boolean;
  openRouterKey?: string;
}

export function resolveTranscription(
  audioSettings: TranscriptionAudioSettings,
  profiles: ModelProfile[],
  platform: TranscriptionPlatform,
  options: ResolveTranscriptionOptions = {},
): Resolution {
  if (audioSettings.provider === "apple") {
    if (options.appleReady === false) {
      // Explicit Apple with no engine: same Groq substitution as mobile-local.
    } else {
      return appleResolution();
    }
  }
  if (
    options.appleReady &&
    platform === "native-mobile" &&
    audioSettings.provider === "local"
  ) {
    return appleResolution();
  }

  // OpenRouter key resolution
  const resolvedOpenRouterKey =
    options.openRouterKey !== undefined
      ? options.openRouterKey
      : getOpenRouterApiKey();
  const hasOpenRouterKey = Boolean(resolvedOpenRouterKey && resolvedOpenRouterKey.trim().length > 0);

  // 1. Explicit OpenRouter legacy setting fallback (OpenRouter has no STT endpoint).
  const explicitOpenRouter =
    audioSettings.sttProvider === "openrouter" || audioSettings.provider === "openrouter";
  if (explicitOpenRouter) {
    if (audioSettings.groq.apiKey.trim()) {
      return {
        ok: true,
        provider: "groq",
        modelId: audioSettings.groq.model,
        modelLabel: groqModelLabel(audioSettings.groq.model),
        substitution: "mobile-groq-substitute",
      };
    }
    return {
      ok: false,
      reason: "missing-groq-key",
      modelId: "whisper-large-v3-turbo",
      modelLabel: "Whisper Large v3 Turbo",
    };
  }

  // Android on-device engine (android-on-device-transcription spec): explicit
  // choice wins; the mobile "no local engine" substitution prefers it
  // whenever a model is downloaded (default-on when ready).
  const androidSttEligible =
    platform === "native-mobile" && options.androidSttReady === true;
  if (audioSettings.provider === "android-ondevice") {
    if (androidSttEligible) {
      const modelId = audioSettings.androidOnDevice?.modelId?.trim() || "auto";
      return {
        ok: true,
        provider: "android-ondevice",
        modelId,
        modelLabel: modelId === "auto" ? "On-Device STT (auto)" : modelId,
      };
    }
    // Explicit on-device but unavailable (no model / not Android): Groq-if-
    // keyed fallback with a visible notice, else a surfaced error.
    if (audioSettings.groq.apiKey.trim()) {
      return {
        ok: true,
        provider: "groq",
        modelId: audioSettings.groq.model,
        modelLabel: groqModelLabel(audioSettings.groq.model),
        substitution: "on-device-unavailable",
      };
    }
    return {
      ok: false,
      reason: "on-device-model-not-ready",
      substitution: "on-device-unavailable",
    };
  }

  const appleUnavailable = audioSettings.provider === "apple" && options.appleReady === false;
  const isMobileLocal =
    (platform === "native-mobile" && (audioSettings.provider === "local" || audioSettings.sttProvider === "local")) ||
    appleUnavailable;

  if (isMobileLocal) {
    if (androidSttEligible) {
      // Default routing picks on-device on Android when a model is ready
      const modelId = isWhistleModelId(audioSettings.sttModel)
        ? "cactus-whistle"
        : isWhistleModelId(audioSettings.preferredModelId)
          ? "cactus-whistle"
          : (audioSettings.androidOnDevice?.modelId?.trim() || "auto");
      return {
        ok: true,
        provider: "android-ondevice",
        modelId,
        modelLabel: modelId === "cactus-whistle" ? "Whistle (Multilingual)" : (modelId === "auto" ? "On-Device STT (auto)" : modelId),
        autoOnDevice: true,
      };
    }

    // On mobile, local desktop models (Nemotron/Whisper) cannot run directly.
    if (audioSettings.groq.apiKey.trim()) {
      const isNemotron = isNemotronModelId(audioSettings.sttModel);
      return {
        ok: true,
        provider: "groq",
        modelId: audioSettings.groq.model,
        modelLabel: groqModelLabel(audioSettings.groq.model),
        substitution: isNemotron ? "mobile-groq-substitute" : "mobile-no-local",
      };
    }

    return {
      ok: false,
      reason: "missing-groq-key",
      modelId: isNemotronModelId(audioSettings.sttModel)
        ? "nemotron-3.5-asr-0.6b"
        : (audioSettings.sttModel || audioSettings.groq.model),
      modelLabel: isNemotronModelId(audioSettings.sttModel)
        ? "NVIDIA Nemotron 3.5 ASR 0.6B"
        : (audioSettings.sttModel || groqModelLabel(audioSettings.groq.model)),
      substitution: "mobile-no-local",
    };
  }

  const explicitCloud =
    audioSettings.provider === "groq" &&
    audioSettings.sttProvider !== "local" &&
    audioSettings.sttProvider !== "automatic";

  if (explicitCloud) {
    const modelId = audioSettings.groq.model;
    const modelLabel = groqModelLabel(modelId);
    if (!audioSettings.groq.apiKey.trim()) {
      return {
        ok: false,
        reason: "missing-groq-key",
        modelId,
        modelLabel,
      };
    }
    return {
      ok: true,
      provider: "groq",
      modelId,
      modelLabel,
    };
  }

  const hasInstalledNemotronProfile = profiles.some(
    (p) => p.installed && (isNemotronModelId(p.id) || isNemotronModelId(p.name)),
  );
  const nemotronAvailable = options.localNemotronReady === true || hasInstalledNemotronProfile;

  // 1. Explicit model selection in sttModel
  if (audioSettings.sttModel && audioSettings.sttModel !== "automatic") {
    if (isNemotronModelId(audioSettings.sttModel)) {
      if (nemotronAvailable || options.localNemotronReady !== false) {
        return {
          ok: true,
          provider: "local",
          modelId: "nemotron-3.5-asr-0.6b",
          modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
        };
      }
      if (hasOpenRouterKey && (audioSettings.automaticFallback ?? true)) {
        return {
          ok: true,
          provider: "openrouter",
          modelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
          modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
          substitution: "nemotron-cloud-substitute",
        };
      }
      return {
        ok: false,
        reason: "model-not-installed",
        modelId: audioSettings.sttModel,
        modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
      };
    }
    if (isWhistleModelId(audioSettings.sttModel)) {
      const explicitProfile = profiles.find((p) => p.installed && isWhistleModelId(p.id));
      if (explicitProfile || options.localWhistleReady === true) {
        return {
          ok: true,
          provider: "local",
          modelId: "cactus-whistle",
          modelLabel: explicitProfile?.name ?? "Cactus Whistle",
        };
      }
      return {
        ok: false,
        reason: "model-not-installed",
        modelId: audioSettings.sttModel,
        modelLabel: "Cactus Whistle",
      };
    }
    const explicitProfile = profiles.find((p) => p.id === audioSettings.sttModel);
    if (explicitProfile?.installed) {
      return {
        ok: true,
        provider: "local",
        modelId: explicitProfile.id,
        modelLabel: explicitProfile.name,
      };
    }
  }

  // 2. Explicit preferredModelId
  const preferredModelId = audioSettings.preferredModelId?.trim();
  if (preferredModelId) {
    if (isNemotronModelId(preferredModelId)) {
      return {
        ok: true,
        provider: "local",
        modelId: "nemotron-3.5-asr-0.6b",
        modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
      };
    }
    if (isWhistleModelId(preferredModelId)) {
      const preferred = profiles.find((profile) => profile.installed && isWhistleModelId(profile.id));
      if (preferred || options.localWhistleReady === true) {
        return {
          ok: true,
          provider: "local",
          modelId: "cactus-whistle",
          modelLabel: preferred?.name ?? "Cactus Whistle",
        };
      }
      return {
        ok: false,
        reason: "model-not-installed",
        modelId: preferredModelId,
        modelLabel: "Cactus Whistle",
      };
    }
    const preferred = profiles.find((profile) => profile.id === preferredModelId);
    if (preferred?.installed) {
      return {
        ok: true,
        provider: "local",
        modelId: preferred.id,
        modelLabel: preferred.name,
      };
    }
    // If preferred model is the uninstalled default "distil-small.en" and local Nemotron is ready, prioritize Nemotron
    if (preferredModelId === "distil-small.en" && nemotronAvailable && (audioSettings.preferLocal ?? true)) {
      return {
        ok: true,
        provider: "local",
        modelId: "nemotron-3.5-asr-0.6b",
        modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
      };
    }
    return {
      ok: false,
      reason: "model-not-installed",
      modelId: preferredModelId,
      modelLabel: preferred?.name ?? preferredModelId,
    };
  }

  // 3. Prefer local Nemotron if ready and preferLocal is true
  if (nemotronAvailable && (audioSettings.preferLocal ?? true)) {
    return {
      ok: true,
      provider: "local",
      modelId: "nemotron-3.5-asr-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    };
  }

  // 4. Fallback to best installed profile
  const fallback = bestInstalledProfile(profiles);
  if (fallback) {
    return {
      ok: true,
      provider: "local",
      modelId: fallback.id,
      modelLabel: profileLabel(profiles, fallback.id),
    };
  }

  // 5. If Nemotron is available as fallback
  if (nemotronAvailable) {
    return {
      ok: true,
      provider: "local",
      modelId: "nemotron-3.5-asr-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    };
  }

  if (preferredModelId) {
    return {
      ok: false,
      reason: "model-not-installed",
      modelId: preferredModelId,
      modelLabel: preferredModelId,
    };
  }

  return { ok: false, reason: "no-model-selected" };
}

/**
 * Async resolve with engine-readiness probes (Apple Speech + Android STT + Local Nemotron).
 * Probes run only for the options not supplied; failures default to not-ready
 * so resolution degrades gracefully.
 */
export async function resolveTranscriptionWithReadiness(
  audioSettings: TranscriptionAudioSettings,
  profiles: ModelProfile[],
  platform: TranscriptionPlatform,
  options: ResolveTranscriptionOptions = {},
): Promise<Resolution> {
  const [appleReady, androidSttReady, localNemotronReady, localWhistleReady] = await Promise.all([
    options.appleReady !== undefined
      ? Promise.resolve(options.appleReady)
      : import("./ai/apple/speech")
          .then((m) => m.isAppleSpeechReady())
          .catch(() => false),
    options.androidSttReady !== undefined
      ? Promise.resolve(options.androidSttReady)
      : import("./ai/android/androidStt")
          .then((m) => m.isAndroidSttReady())
          .catch(() => false),
    options.localNemotronReady !== undefined
      ? Promise.resolve(options.localNemotronReady)
      : import("../api/transcription")
          .then(async (m) => {
            const { canRunLocalNemotron } = await import(
              "../services/transcription/DeviceCapabilityService"
            );
            return canRunLocalNemotron() && (await m.isLocalNemotronInstalled());
          })
          .catch(() => false),
    options.localWhistleReady !== undefined
      ? Promise.resolve(options.localWhistleReady)
      : import("../api/transcription")
          .then((m) => m.isLocalWhistleInstalled())
          .catch(() => false),
  ]);
  const openRouterKey =
    options.openRouterKey !== undefined
      ? options.openRouterKey
      : getOpenRouterApiKey();
  return resolveTranscription(audioSettings, profiles, platform, {
    appleReady,
    androidSttReady,
    localNemotronReady,
    localWhistleReady,
    openRouterKey,
  });
}

export function describeResolution(resolution: Resolution): string {
  if (resolution.ok === false) {
    if (resolution.reason === "missing-openrouter-key") {
      return resolution.substitution === "mobile-no-local"
        ? "Local Nemotron is unavailable on mobile. Add an OpenRouter API key in AI settings to use Nemotron via OpenRouter cloud."
        : "An OpenRouter API key is required. Configure it in AI provider settings.";
    }
    if (resolution.reason === "missing-groq-key") {
      return resolution.substitution === "mobile-no-local"
        ? "Local transcription is unavailable on mobile. Add a Groq API key to use Groq instead."
        : "A Groq API key is required.";
    }
    if (resolution.reason === "mobile-local-unsupported") {
      return "Local transcription is unavailable on mobile. Use OpenRouter with Nemotron or configure Groq.";
    }
    if (resolution.reason === "on-device-model-not-ready") {
      return "On-device transcription is selected but no model is downloaded. Download one in On-Device AI settings or configure Groq.";
    }
    if (resolution.reason === "model-not-installed") {
      return `${resolution.modelLabel ?? resolution.modelId ?? "The selected model"} is not installed.`;
    }
    return "No transcription model is selected.";
  }

  const providerLabel =
    resolution.provider === "openrouter"
      ? "OpenRouter"
      : resolution.provider === "groq"
        ? "Groq"
        : resolution.provider === "apple"
          ? "Apple Speech"
          : resolution.provider === "android-ondevice"
            ? "On-Device STT"
            : "Local STT";
  const engine = `${providerLabel} · ${resolution.modelLabel}`;
  if (resolution.substitution === "nemotron-cloud-substitute") {
    return `${engine}. Local Nemotron is unavailable on mobile, so OpenRouter cloud Nemotron is being used.`;
  }
  if (resolution.substitution === "mobile-groq-substitute") {
    return `${engine}. Local transcription is unavailable on mobile, so Groq is being used instead.`;
  }
  if (resolution.substitution === "on-device-unavailable") {
    return `${engine}. On-device transcription is unavailable (no model downloaded), so Groq is being used instead.`;
  }
  return resolution.substitution === "mobile-no-local"
    ? `${engine}. Local transcription is unavailable on mobile, so ${providerLabel} is being used instead.`
    : engine;
}

export interface ResolveSessionPlanParams {
  session: {
    id: string;
    origin?: string;
    assetId?: string;
    transcriptRevision?: number;
  };
  documentPrivacy: {
    isLocalOnly: boolean;
    isAiExcluded: boolean;
  };
  audioSettings: TranscriptionAudioSettings;
  profiles: ModelProfile[];
  platform: TranscriptionPlatform;
  options?: {
    forceOffline?: boolean;
    isOnline?: boolean;
    appleReady?: boolean;
    androidSttReady?: boolean;
    localNemotronReady?: boolean;
    localWhistleReady?: boolean;
    openRouterKey?: string;
    disclosurePresenter?: CloudAiDisclosurePresenter | null;
    hasDurableConsent?: boolean;
  };
}

/**
 * Resolves a concrete, frozen, privacy-safe SessionTranscriptionPlan and authorization DTO
 * per OpenSpec D6.
 *
 * Guarantees:
 * - Strict adherence to document privacy: AI-excluded documents refuse execution;
 *   local-only documents never transmit audio to cloud providers.
 * - Offline enforcement: offline mode or network absence refuses cloud execution.
 * - Credentials & consent: API keys are validated, and cloud providers require
 *   durable consent (or a registered presenter). Missing presenter blocks remote execution.
 * - Executor assignment: assigns rust-local, native-android, native-apple, or frontend-service.
 * - Cancellation never falls back: execution plan is strictly frozen with a single provider/executor.
 */
export async function resolveSessionTranscriptionPlan(
  params: ResolveSessionPlanParams
): Promise<SessionTranscriptionPlanResult> {
  const { session, documentPrivacy, audioSettings, profiles, platform, options = {} } = params;

  // 1. Check AI-excluded policy
  if (documentPrivacy.isAiExcluded) {
    return {
      ok: false,
      reason: "ai-excluded",
      blockedReason: "policy-excluded",
      messageKey: "recording.aiExcluded",
    };
  }

  const isOffline =
    options.forceOffline === true ||
    options.isOnline === false ||
    audioSettings.mode === "offline";

  // 2. Check local-only document policy
  if (documentPrivacy.isLocalOnly) {
    const wantsExplicitCloud =
      (audioSettings.provider === "groq" ||
        audioSettings.provider === "openrouter" ||
        audioSettings.sttProvider === "openrouter" ||
        audioSettings.sttProvider === "premium") &&
      audioSettings.automaticFallback === false &&
      !audioSettings.preferLocal;

    if (wantsExplicitCloud) {
      return {
        ok: false,
        reason: "cloud-forbidden-for-local-only",
        blockedReason: "policy-excluded",
        messageKey: "recording.localOnlyPolicy",
      };
    }
  }

  // 3. Resolve candidate provider
  let candidateSettings = audioSettings;
  if (documentPrivacy.isLocalOnly || isOffline) {
    if (audioSettings.provider === "groq" || audioSettings.provider === "openrouter") {
      candidateSettings = {
        ...audioSettings,
        provider: "local",
        sttProvider: "local",
        preferLocal: true,
      };
    }
  }

  const resolution = resolveTranscription(candidateSettings, profiles, platform, {
    appleReady: options.appleReady,
    androidSttReady: options.androidSttReady,
    localNemotronReady: options.localNemotronReady,
    localWhistleReady: options.localWhistleReady,
    openRouterKey: options.openRouterKey,
  });

  if (resolution.ok === false) {
    const blockedReason = isOffline
      ? "offline-required"
      : documentPrivacy.isLocalOnly
      ? "policy-excluded"
      : "provider-unavailable";

    return {
      ok: false,
      reason: resolution.reason,
      blockedReason,
      messageKey: `recording.${resolution.reason}`,
    };
  }

  // 4. Map provider to executor and verify privacy / cloud consent
  const provider = resolution.provider;
  const modelId = resolution.modelId;
  const modelLabel = resolution.modelLabel;
  const language = audioSettings.language || "en";
  const sourceRevision = session.transcriptRevision ?? 0;
  const frozenAt = new Date().toISOString();

  if (provider === "local") {
    return {
      ok: true,
      plan: {
        sessionId: session.id,
        assetId: session.assetId,
        transcriptRevision: sourceRevision,
        provider: "local",
        modelId,
        modelLabel,
        language,
        executor: "rust-local",
        isLocal: true,
        sourceRevision,
        privacyCategory: documentPrivacy.isLocalOnly ? "local-only" : "standard",
        frozenAt,
      },
    };
  }

  if (provider === "android-ondevice") {
    return {
      ok: true,
      plan: {
        sessionId: session.id,
        assetId: session.assetId,
        transcriptRevision: sourceRevision,
        provider: "android-ondevice",
        modelId,
        modelLabel,
        language,
        executor: "native-android",
        isLocal: true,
        sourceRevision,
        privacyCategory: documentPrivacy.isLocalOnly ? "local-only" : "standard",
        frozenAt,
      },
    };
  }

  if (provider === "apple") {
    return {
      ok: true,
      plan: {
        sessionId: session.id,
        assetId: session.assetId,
        transcriptRevision: sourceRevision,
        provider: "apple",
        modelId,
        modelLabel,
        language,
        executor: "native-apple",
        isLocal: true,
        sourceRevision,
        privacyCategory: documentPrivacy.isLocalOnly ? "local-only" : "standard",
        frozenAt,
      },
    };
  }

  // Cloud providers: groq or openrouter
  if (documentPrivacy.isLocalOnly) {
    return {
      ok: false,
      reason: "cloud-forbidden-for-local-only",
      blockedReason: "policy-excluded",
      messageKey: "recording.localOnlyPolicy",
    };
  }

  if (isOffline) {
    return {
      ok: false,
      reason: "offline-unsupported",
      blockedReason: "offline-required",
      messageKey: "recording.offlineRequired",
    };
  }

  // Check credentials at execution/plan generation
  if (provider === "groq") {
    if (!audioSettings.groq?.apiKey || audioSettings.groq.apiKey.trim() === "") {
      return {
        ok: false,
        reason: "missing-groq-key",
        blockedReason: "provider-unavailable",
        messageKey: "recording.missingGroqKey",
      };
    }
  } else if (provider === "openrouter") {
    const key =
      options.openRouterKey !== undefined
        ? options.openRouterKey
        : getOpenRouterApiKey();
    if (!key || key.trim() === "") {
      return {
        ok: false,
        reason: "missing-openrouter-key",
        blockedReason: "provider-unavailable",
        messageKey: "recording.missingOpenRouterKey",
      };
    }
  }

  // Cloud AI disclosure / durable consent check
  const providerClass = resolveCloudAiProviderClass(provider);
  let consented = options.hasDurableConsent === true || isCloudAiDisclosed(providerClass);

  if (!consented) {
    // Missing presenter blocks remote session execution
    if (!options.disclosurePresenter) {
      return {
        ok: false,
        reason: "missing-presenter",
        blockedReason: "consent-required",
        messageKey: "recording.consentRequired",
      };
    }

    const accepted = await options.disclosurePresenter({
      featureClass: "transcription",
      providerClass,
      provider,
    });

    if (!accepted) {
      return {
        ok: false,
        reason: "consent-declined",
        blockedReason: "consent-required",
        messageKey: "recording.consentDeclined",
      };
    }

    acknowledgeCloudAiDisclosure(providerClass);
    consented = true;
  }

  const endpoint =
    provider === "groq"
      ? "https://api.groq.com/openai/v1"
      : "https://openrouter.ai/api/v1";

  const authorization: SessionTranscriptionAuthorization = {
    sessionId: session.id,
    providerClass,
    provider,
    endpoint,
    sourceKind: session.origin ?? "recorded",
    sourceRevision,
    userConsented: true,
    authorizedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    plan: {
      sessionId: session.id,
      assetId: session.assetId,
      transcriptRevision: sourceRevision,
      provider,
      modelId,
      modelLabel,
      language,
      executor: "frontend-service",
      isLocal: false,
      sourceRevision,
      privacyCategory: "cloud-authorized",
      frozenAt,
    },
    authorization,
  };
}

