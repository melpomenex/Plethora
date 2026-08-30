import {
  downloadTranscriptionModel,
  getTranscriptionProfiles,
} from "../api/transcription";
import type { FailedResolution } from "./transcriptionProvider";

export interface ResolutionToastApi {
  error: (
    title: string,
    message?: string,
    options?: { action?: { label: string; onClick: () => void } },
  ) => unknown;
  info: (title: string, message?: string) => unknown;
  success: (title: string, message?: string) => unknown;
}

export function showTranscriptionResolutionFailure(
  resolution: FailedResolution,
  toast: ResolutionToastApi,
  retry?: () => void | Promise<void>,
): void {
  if (resolution.reason === "missing-openrouter-key") {
    toast.error(
      "OpenRouter API Key Required",
      resolution.substitution === "mobile-no-local"
        ? "Local Nemotron cannot run on mobile. Add an OpenRouter API key in AI settings to use Nemotron via OpenRouter cloud."
        : "Add an OpenRouter API key in AI provider settings to transcribe with OpenRouter.",
      {
        action: {
          label: "Open AI Settings",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("navigate-to-settings", {
              detail: { section: "ai" },
            }));
          },
        },
      },
    );
    return;
  }

  if (resolution.reason === "mobile-local-unsupported") {
    toast.error(
      "Local STT Unavailable on Mobile",
      "Local desktop models cannot run on mobile. Download an On-Device STT model (SenseVoice or Parakeet) in On-Device AI settings, or add a Groq API key for cloud transcription.",
      {
        action: {
          label: "Open AI Settings",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("navigate-to-settings", {
              detail: { section: "on-device-ai" },
            }));
          },
        },
      },
    );
    return;
  }

  if (resolution.reason === "missing-groq-key") {
    toast.error(
      resolution.substitution === "mobile-no-local"
        ? "Speech-to-Text Setup Required"
        : "Groq API Key Required",
      resolution.substitution === "mobile-no-local"
        ? "Local desktop models cannot run directly on mobile. Download an On-Device STT model (SenseVoice or Parakeet) in On-Device AI settings, or configure a Groq API key for cloud transcription."
        : "Add a Groq API key in Audio Transcription settings to use Groq transcription.",
      {
        action: {
          label: resolution.substitution === "mobile-no-local" ? "Open On-Device AI" : "Open Settings",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("navigate-to-settings", {
              detail: { section: resolution.substitution === "mobile-no-local" ? "on-device-ai" : "audio-transcription" },
            }));
          },
        },
      },
    );
    return;
  }

  if (resolution.reason === "on-device-model-not-ready") {
    toast.error(
      "On-device model required",
      "On-device transcription is selected but no speech model is downloaded. Download one in On-Device AI settings (or configure Groq).",
      {
        action: {
          label: "Open Settings",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("navigate-to-settings", {
              detail: { section: "audio-transcription" },
            }));
          },
        },
      },
    );
    return;
  }

  if (resolution.reason === "model-not-installed") {
    const modelId = resolution.modelId;
    const modelLabel = resolution.modelLabel ?? modelId ?? "Selected model";
    toast.error(
      "Model not installed",
      `The selected model, ${modelLabel}, is not downloaded.`,
      modelId
        ? {
            action: {
              label: `Download ${modelLabel}`,
              onClick: () => {
                void (async () => {
                  try {
                    const profiles = await getTranscriptionProfiles();
                    const target = profiles.find((profile) => profile.id === modelId);
                    if (!target) {
                      toast.error("Download failed", `${modelLabel} is not available in the model catalog.`);
                      return;
                    }
                    toast.info(
                      `Downloading ${modelLabel}`,
                      `${Math.round(target.size_bytes / 1024 / 1024)} MB`,
                    );
                    await downloadTranscriptionModel(modelId);
                    toast.success("Model downloaded", `${modelLabel} is ready. Retrying transcription…`);
                    await retry?.();
                  } catch (error) {
                    toast.error(
                      `Could not download ${modelLabel}`,
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                })();
              },
            },
          }
        : undefined,
    );
    return;
  }

  toast.error(
    "No transcription model selected",
    "Choose and download a local transcription model in Audio Transcription settings.",
    {
      action: {
        label: "Open Settings",
        onClick: () => {
          window.dispatchEvent(new CustomEvent("navigate-to-settings", {
            detail: { section: "audio-transcription" },
          }));
        },
      },
    },
  );
}
