import type { ModelProfile } from "../api/transcription";

export interface TranscriptionAudioSettings {
  provider: "local" | "groq" | "apple" | "android-ondevice";
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
  "parakeet-tdt-ctc-110m",
  "sense-voice-small",
  "small",
  "distil-small.en",
  "base",
] as const;

export type TranscriptionPlatform = "desktop" | "native-mobile";

export type Resolution =
  | {
      ok: true;
      provider: "local" | "groq" | "apple" | "android-ondevice";
      modelId: string;
      modelLabel: string;
      /** Android on-device was chosen even though the user never picked it. */
      autoOnDevice?: boolean;
      substitution?: "mobile-no-local" | "on-device-unavailable";
    }
  | {
      ok: false;
      reason:
        | "missing-groq-key"
        | "model-not-installed"
        | "no-model-selected"
        | "on-device-model-not-ready";
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
    .sort((left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )[0];
}

function appleResolution(): Extract<Resolution, { ok: true }> {
  return {
    ok: true,
    provider: "apple",
    modelId: "apple-speech",
    modelLabel: "Apple Speech",
  };
}

export function resolveTranscription(
  audioSettings: TranscriptionAudioSettings,
  profiles: ModelProfile[],
  platform: TranscriptionPlatform,
  options: { appleReady?: boolean; androidSttReady?: boolean } = {},
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
  const mobileLocalUnavailable =
    (platform === "native-mobile" && audioSettings.provider === "local") || appleUnavailable;
  if (mobileLocalUnavailable && androidSttEligible) {
    // Default routing picks on-device on Android when a model is ready
    // (spec: "Default routing picks on-device on Android").
    const modelId = audioSettings.androidOnDevice?.modelId?.trim() || "auto";
    return {
      ok: true,
      provider: "android-ondevice",
      modelId,
      modelLabel: modelId === "auto" ? "On-Device STT (auto)" : modelId,
      autoOnDevice: true,
    };
  }
  const mobileSubstitution = mobileLocalUnavailable;
  const provider = mobileSubstitution ? "groq" : audioSettings.provider;

  if (provider === "groq") {
    const modelId = audioSettings.groq.model;
    const modelLabel = groqModelLabel(modelId);
    if (!audioSettings.groq.apiKey.trim()) {
      return {
        ok: false,
        reason: "missing-groq-key",
        modelId,
        modelLabel,
        ...(mobileSubstitution ? { substitution: "mobile-no-local" as const } : {}),
      };
    }
    return {
      ok: true,
      provider: "groq",
      modelId,
      modelLabel,
      ...(mobileSubstitution ? { substitution: "mobile-no-local" as const } : {}),
    };
  }

  const preferredModelId = audioSettings.preferredModelId?.trim();
  if (preferredModelId) {
    const preferred = profiles.find((profile) => profile.id === preferredModelId);
    if (!preferred?.installed) {
      return {
        ok: false,
        reason: "model-not-installed",
        modelId: preferredModelId,
        modelLabel: preferred?.name ?? preferredModelId,
      };
    }
    return {
      ok: true,
      provider: "local",
      modelId: preferred.id,
      modelLabel: preferred.name,
    };
  }

  const fallback = bestInstalledProfile(profiles);
  if (!fallback) {
    return { ok: false, reason: "no-model-selected" };
  }
  return {
    ok: true,
    provider: "local",
    modelId: fallback.id,
    modelLabel: profileLabel(profiles, fallback.id),
  };
}

/**
 * Async resolve with engine-readiness probes (Apple Speech + Android STT).
 * Probes run only for the options not supplied; failures default to not-ready
 * so resolution degrades to the pre-on-device behavior.
 */
export async function resolveTranscriptionWithReadiness(
  audioSettings: TranscriptionAudioSettings,
  profiles: ModelProfile[],
  platform: TranscriptionPlatform,
  options: { appleReady?: boolean; androidSttReady?: boolean } = {},
): Promise<Resolution> {
  const [appleReady, androidSttReady] = await Promise.all([
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
  ]);
  return resolveTranscription(audioSettings, profiles, platform, {
    appleReady,
    androidSttReady,
  });
}

export function describeResolution(resolution: Resolution): string {
  if (resolution.ok === false) {
    if (resolution.reason === "missing-groq-key") {
      return resolution.substitution === "mobile-no-local"
        ? "Local transcription is unavailable on mobile. Add a Groq API key to use Groq instead."
        : "A Groq API key is required.";
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
    resolution.provider === "groq"
      ? "Groq"
      : resolution.provider === "apple"
        ? "Apple Speech"
        : resolution.provider === "android-ondevice"
          ? "On-Device STT"
          : "Local STT";
  const engine = `${providerLabel} · ${resolution.modelLabel}`;
  if (resolution.substitution === "on-device-unavailable") {
    return `${engine}. On-device transcription is unavailable (no model downloaded), so Groq is being used instead.`;
  }
  return resolution.substitution === "mobile-no-local"
    ? `${engine}. Local transcription is unavailable on mobile, so Groq is being used instead.`
    : engine;
}
