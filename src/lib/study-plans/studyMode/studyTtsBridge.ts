import { generateSpeech } from "../../../api/tts";
import type { Settings } from "../../../stores/settingsStore";
import {
  estimateSpeechDurationSec,
  hashMediaText,
  loadCachedStudyMedia,
  saveCachedStudyMedia,
  type StudyCachedMediaSegment,
} from "./studyMediaCache";

export interface SynthesizeStudySegmentInput {
  artifactId: string;
  kind: "audio_script" | "slides";
  scopeKey: string;
  sourceRevision: string;
  index: number;
  text: string;
  settings?: Settings | null;
  isOffline?: boolean;
  signal?: AbortSignal;
}

export interface SynthesizedStudySegment {
  audioUrl: string | null;
  durationSec: number;
  source: StudyCachedMediaSegment["source"];
  fromCache: boolean;
}

/**
 * Resolves a playable narration segment for a Study Mode audio turn or slide:
 * 1. Reuses local studyMediaCache if present (zero regeneration offline or online).
 * 2. Calls Plethora's existing generateSpeech (which also caches durably in IndexedDB ttsCache).
 * 3. Falls back cleanly to browser SpeechSynthesis or timed transcript playback.
 */
export async function synthesizeStudySegment(
  input: SynthesizeStudySegmentInput
): Promise<SynthesizedStudySegment> {
  const textHash = hashMediaText(input.text);
  const existingManifest = loadCachedStudyMedia(input.artifactId, input.sourceRevision);
  const cachedSeg = existingManifest?.segments.find(
    (s) => s.index === input.index && s.textHash === textHash
  );

  if (cachedSeg) {
    return {
      audioUrl: cachedSeg.audioUrl ?? null,
      durationSec: cachedSeg.durationSec,
      source: cachedSeg.source,
      fromCache: true,
    };
  }

  let result: SynthesizedStudySegment | null = null;

  if (!input.isOffline && input.settings?.tts?.enabled && input.text.trim().length > 0) {
    try {
      const speech = await generateSpeech(input.settings, {
        text: input.text,
        signal: input.signal,
        awaitCache: true,
      });
      result = {
        audioUrl: speech.audioUrl,
        durationSec: speech.durationSec ?? estimateSpeechDurationSec(input.text),
        source: speech.cacheSource ? "tts_cache" : "tts_provider",
        fromCache: Boolean(speech.cacheSource),
      };
    } catch {
      // Fall through to local speech synthesis / timed transcript playback
    }
  }

  if (!result) {
    const hasSpeechSynth =
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined" &&
      typeof SpeechSynthesisUtterance !== "undefined";
    result = {
      audioUrl: null,
      durationSec: estimateSpeechDurationSec(input.text),
      source: hasSpeechSynth ? "speech_synthesis" : "timed_transcript",
      fromCache: false,
    };
  }

  const nextSegments = [
    ...(existingManifest?.segments.filter((s) => s.index !== input.index) ?? []),
    {
      index: input.index,
      textHash,
      durationSec: result.durationSec,
      audioUrl: result.audioUrl,
      source: result.source,
    },
  ].sort((a, b) => a.index - b.index);

  saveCachedStudyMedia({
    artifactId: input.artifactId,
    kind: input.kind,
    scopeKey: input.scopeKey,
    sourceRevision: input.sourceRevision,
    lastPositionIndex: input.index,
    segments: nextSegments,
    cachedAt: new Date().toISOString(),
  });

  return result;
}
