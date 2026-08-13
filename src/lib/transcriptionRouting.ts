import { transcribeAudiobookWithGroq } from "../api/audiobooks";
import {
  transcribePodcastEpisode,
  transcribePodcastEpisodeWithGroq,
} from "../api/podcast";
import { enqueueAutoTranscription } from "../api/transcription";
import type { Document } from "../types/document";
import type { SuccessfulResolution } from "./transcriptionProvider";

export async function routeDocumentTranscription(
  document: Pick<Document, "id" | "filePath">,
  resolution: SuccessfulResolution,
  language: string,
): Promise<"groq" | "local"> {
  if (resolution.provider === "groq") {
    await transcribeAudiobookWithGroq(
      document.id,
      document.filePath,
      language === "auto" ? undefined : language,
    );
    return "groq";
  }

  await enqueueAutoTranscription(
    document.id,
    document.filePath,
    "local",
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
): Promise<"groq" | "local"> {
  if (resolution.provider === "groq") {
    if (!audioUrl) throw new Error("No audio URL available for this episode.");
    await transcribePodcastEpisodeWithGroq(episodeId, audioUrl, language);
    return "groq";
  }

  await transcribePodcastEpisode(
    episodeId,
    resolution.modelId,
    language,
    autoSegment,
  );
  return "local";
}
