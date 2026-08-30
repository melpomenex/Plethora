import { describe, expect, it, vi } from "vitest";
import { TranscriptionError } from "../errors";
import { PseudoStreamingSession } from "../streaming/PseudoStreamingSession";
import type {
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
} from "../types";

const SAMPLE_RATE = 16_000;

function loudChunk(durationMs: number): ArrayBuffer {
  const sampleCount = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  return new Float32Array(sampleCount).fill(0.5).buffer;
}

function silentChunk(durationMs: number): ArrayBuffer {
  const sampleCount = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  return new Float32Array(sampleCount).fill(0).buffer;
}

function mockProvider(
  responses: Array<string | Error>,
): TranscriptionProvider {
  let callIndex = 0;
  return {
    id: "openrouter:nemotron-3.5" as TranscriptionProviderId,
    capabilities: () => ({
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: true,
      segmentTimestamps: true,
      wordTimestamps: false,
      diarization: false,
      languageDetection: true,
      customVocabulary: false,
      offline: false,
      supportedLanguages: "auto",
    }),
    transcribe: vi.fn(async (): Promise<TranscriptionResult> => {
      const next = responses[callIndex];
      callIndex += 1;
      if (next instanceof Error) throw next;
      return {
        text: next ?? "",
        segments: [],
        providerId: "openrouter:nemotron-3.5",
      };
    }),
  };
}

describe("PseudoStreamingSession", () => {
  it("merges chunk transcripts via reconciliation for partial callbacks", async () => {
    const partialTexts: string[] = [];
    const provider = mockProvider(["hello brave", "brave new world"]);

    const session = new PseudoStreamingSession({
      provider,
      vad: { minSpeechMs: 200, maxChunkSeconds: 2, energyThreshold: 0.01 },
    });
    session.onPartial((partial) => partialTexts.push(partial.text));

    await session.pushAudio(loudChunk(400));
    await session.pushAudio(silentChunk(300));
    await session.pushAudio(loudChunk(400));
    await session.pushAudio(silentChunk(300));

    const result = await session.close();

    expect(partialTexts.at(-1)).toBe("hello brave new world");
    expect(result.text).toBe("hello brave new world");
    expect(provider.transcribe).toHaveBeenCalledTimes(2);
  });

  it("invokes onFinal for each transcribed chunk", async () => {
    const finals: string[] = [];
    const provider = mockProvider(["first chunk", "second chunk"]);

    const session = new PseudoStreamingSession({
      provider,
      vad: { minSpeechMs: 200, energyThreshold: 0.01 },
    });
    session.onFinal((segment) => finals.push(segment.text));

    await session.pushAudio(loudChunk(400));
    await session.pushAudio(silentChunk(300));
    await session.pushAudio(loudChunk(400));
    await session.pushAudio(silentChunk(300));
    await session.close();

    expect(finals).toEqual(["first chunk", "second chunk"]);
  });

  it("routes provider errors through onError", async () => {
    const errors: TranscriptionError[] = [];
    const provider = mockProvider([new Error("network down")]);

    const session = new PseudoStreamingSession({
      provider,
      vad: { minSpeechMs: 200, energyThreshold: 0.01 },
    });
    session.onError((error) => errors.push(error));

    await session.pushAudio(loudChunk(400));
    await session.pushAudio(silentChunk(300));
    await session.close();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("NETWORK_ERROR");
  });

  it("emits a lag warning when processing exceeds 1.5× audio duration", async () => {
    const warnings: TranscriptionError[] = [];
    const provider: TranscriptionProvider = {
      id: "openrouter:nemotron-3.5",
      capabilities: () => ({
        fileTranscription: true,
        streaming: false,
        pseudoStreaming: true,
        segmentTimestamps: true,
        wordTimestamps: false,
        diarization: false,
        languageDetection: true,
        customVocabulary: false,
        offline: false,
        supportedLanguages: "auto",
      }),
      transcribe: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        return {
          text: "slow chunk",
          segments: [],
          providerId: "openrouter:nemotron-3.5",
        };
      }),
    };

    const session = new PseudoStreamingSession({
      provider,
      vad: { minSpeechMs: 100, maxChunkSeconds: 2, energyThreshold: 0.01 },
    });
    session.onError((error) => {
      if (error.recoverable) warnings.push(error);
    });

    await session.pushAudio(loudChunk(300));
    await session.pushAudio(silentChunk(100));
    await session.close();

    expect(warnings.some((warning) => warning.message.includes("falling behind"))).toBe(true);
    expect(session.getRealtimeFactor()).toBeGreaterThan(1.5);
  });
});
