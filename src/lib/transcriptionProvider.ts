import type { ModelProfile } from "../api/transcription";

export interface TranscriptionAudioSettings {
  provider: "local" | "groq";
  preferredModelId?: string;
  language: string;
  groq: {
    apiKey: string;
    model: "whisper-large-v3" | "whisper-large-v3-turbo";
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
      provider: "local" | "groq";
      modelId: string;
      modelLabel: string;
      substitution?: "mobile-no-local";
    }
  | {
      ok: false;
      reason: "missing-groq-key" | "model-not-installed" | "no-model-selected";
      modelId?: string;
      modelLabel?: string;
      substitution?: "mobile-no-local";
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

export function resolveTranscription(
  audioSettings: TranscriptionAudioSettings,
  profiles: ModelProfile[],
  platform: TranscriptionPlatform,
): Resolution {
  const mobileSubstitution =
    platform === "native-mobile" && audioSettings.provider === "local";
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

export function describeResolution(resolution: Resolution): string {
  if (resolution.ok === false) {
    if (resolution.reason === "missing-groq-key") {
      return resolution.substitution === "mobile-no-local"
        ? "Local transcription is unavailable on mobile. Add a Groq API key to use Groq instead."
        : "A Groq API key is required.";
    }
    if (resolution.reason === "model-not-installed") {
      return `${resolution.modelLabel ?? resolution.modelId ?? "The selected model"} is not installed.`;
    }
    return "No transcription model is selected.";
  }

  const providerLabel = resolution.provider === "groq" ? "Groq" : "Local STT";
  const engine = `${providerLabel} · ${resolution.modelLabel}`;
  return resolution.substitution === "mobile-no-local"
    ? `${engine}. Local transcription is unavailable on mobile, so Groq is being used instead.`
    : engine;
}
