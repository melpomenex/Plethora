import { isGroqConfigured, transcribeWithGroq } from "../../api/groqTranscription";
import type { ShadowingRecognitionProvider } from "./types";

/** Cloud adapter for the existing audio-transcription settings. */
export function createConfiguredShadowingProviders(): ShadowingRecognitionProvider[] {
  if (!isGroqConfigured()) return [];
  return [{
    id: "groq-whisper",
    version: "configured",
    route: "cloud",
    supports: (languageTag) => Boolean(languageTag.trim()),
    recognize: async (input, signal) => {
      if (signal?.aborted) throw new Error("cancelled");
      const response = await transcribeWithGroq({
        file: input.audio,
        language: input.languageTag,
        responseFormat: "verbose_json",
        timestampGranularities: ["word"],
      });
      if (signal?.aborted) throw new Error("cancelled");
      const confidences = response.segments
        ?.map((segment) => Math.exp(segment.avg_logprob))
        .filter((confidence) => Number.isFinite(confidence));
      const confidence = confidences?.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : undefined;
      return { text: response.text.trim(), confidence };
    },
  }];
}
