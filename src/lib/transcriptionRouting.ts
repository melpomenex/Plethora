import {
  transcribeAudiobookWithGroq,
  transcribeAudiobookOnDevice,
  transcribeAudiobookWithOpenRouter,
} from "../api/audiobooks";
import {
  transcribePodcastEpisode,
  transcribePodcastEpisodeOnDevice,
  transcribePodcastEpisodeWithGroq,
  transcribePodcastEpisodeWithOpenRouter,
} from "../api/podcast";
import { enqueueAutoTranscription } from "../api/transcription";
import type { Document } from "../types/document";
import type { SuccessfulResolution } from "./transcriptionProvider";

export async function routeDocumentTranscription(
  document: Pick<Document, "id" | "filePath">,
  resolution: SuccessfulResolution,
  language: string,
): Promise<"groq" | "local" | "android-ondevice" | "openrouter"> {
  if (resolution.provider === "openrouter") {
    await transcribeAudiobookWithOpenRouter(
      document.id,
      document.filePath,
      resolution.modelId,
      language === "auto" ? undefined : language,
    );
    return "openrouter";
  }

  if (resolution.provider === "groq") {
    await transcribeAudiobookWithGroq(
      document.id,
      document.filePath,
      language === "auto" ? undefined : language,
    );
    return "groq";
  }

  if (resolution.provider === "android-ondevice") {
    await transcribeAudiobookOnDevice(
      document.id,
      document.filePath,
      language === "auto" ? undefined : language,
    );
    return "android-ondevice";
  }

  await enqueueAutoTranscription(
    document.id,
    document.filePath,
    resolution.provider === "apple" ? "apple" : "local",
    resolution.modelId,
    language || "en",
  );
  return "local";
}

export async function routePodcastTranscription(
  episodeId: string,
  audioUrl: string | undefined,
  resolution: SuccessfulResolution,
  language: string,
  autoSegment: boolean,
): Promise<"groq" | "local" | "android-ondevice" | "openrouter"> {
  if (resolution.provider === "openrouter") {
    if (!audioUrl) throw new Error("No audio URL available for this episode.");
    await transcribePodcastEpisodeWithOpenRouter(
      episodeId,
      audioUrl,
      resolution.modelId,
      language === "auto" ? undefined : language,
    );
    return "openrouter";
  }

  if (resolution.provider === "groq") {
    if (!audioUrl) throw new Error("No audio URL available for this episode.");
    await transcribePodcastEpisodeWithGroq(episodeId, audioUrl, language);
    return "groq";
  }

  if (resolution.provider === "android-ondevice") {
    // The on-device engine needs a local file: non-local episodes are
    // downloaded through the existing episode-download path first (the
    // transcription itself stays fully offline).
    if (!audioUrl) throw new Error("No audio URL available for this episode.");
    await transcribePodcastEpisodeOnDevice(episodeId, audioUrl, language);
    return "android-ondevice";
  }

  await transcribePodcastEpisode(
    episodeId,
    resolution.modelId,
    language,
    autoSegment,
  );
  return "local";
}
