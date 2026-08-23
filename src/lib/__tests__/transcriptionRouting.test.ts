import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "../../api/transcription";
import type { AudioTranscriptionSettings } from "../../types/settings";
import { resolveTranscription } from "../transcriptionProvider";
import {
  routeDocumentTranscription,
  routePodcastTranscription,
} from "../transcriptionRouting";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  transcribeAudiobookWithGroq: vi.fn(),
  transcribePodcastEpisode: vi.fn(),
  transcribePodcastEpisodeWithGroq: vi.fn(),
}));

vi.mock("../../api/transcription", () => ({ enqueueAutoTranscription: mocks.enqueue }));
vi.mock("../../api/audiobooks", () => ({
  transcribeAudiobookWithGroq: mocks.transcribeAudiobookWithGroq,
}));
vi.mock("../../api/podcast", () => ({
  transcribePodcastEpisode: mocks.transcribePodcastEpisode,
  transcribePodcastEpisodeWithGroq: mocks.transcribePodcastEpisodeWithGroq,
}));

const profile = (id: string, name: string): ModelProfile => ({
  id,
  name,
  installed: true,
  description: "",
  url: "",
  sha256: "",
  size_bytes: 1,
});
const parakeet = profile("parakeet-tdt-ctc-110m", "Parakeet TDT-CTC 110M");
const whisper = profile("distil-small.en", "Whisper Distil Small");

const baseSettings = (): AudioTranscriptionSettings => ({
  provider: "local",
  autoTranscription: false,
  autoTranscribeLocalVideos: true,
  preferredModelId: parakeet.id,
  language: "en",
  timestampGeneration: true,
  speakerDiarization: false,
  confidenceScores: false,
  confidenceThreshold: 0.7,
  idleTranscriptionEnabled: false,
  idleThresholdMinutes: 10,
  groq: {
    apiKey: "key",
    model: "whisper-large-v3-turbo",
    useFreeTier: true,
    usage: { lastResetDate: "", audioSecondsProcessed: 0, requestsMade: 0 },
  },
});

beforeEach(() => vi.clearAllMocks());

describe("document transcription routing", () => {
  it("routes Groq to the cloud path without creating a local queue entry", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), provider: "groq" },
      [parakeet],
      "desktop",
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.mp3" },
      resolution,
      "en",
    );
    expect(mocks.transcribeAudiobookWithGroq).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.mp3",
      "en",
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("routes local work to the queue with the resolved model", async () => {
    const resolution = resolveTranscription(baseSettings(), [whisper, parakeet], "desktop");
    if (resolution.ok === false) throw new Error("unexpected failure");
    await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.mp3" },
      resolution,
      "en",
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.mp3",
      "local",
      parakeet.id,
      "en",
    );
    expect(mocks.transcribeAudiobookWithGroq).not.toHaveBeenCalled();
  });

  it("routes Apple Speech to the local queue without Groq", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), provider: "apple" },
      [parakeet],
      "desktop",
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.mp3" },
      resolution,
      "en",
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.mp3",
      "apple",
      "apple-speech",
      "en",
    );
    expect(mocks.transcribeAudiobookWithGroq).not.toHaveBeenCalled();
  });
});

describe("podcast transcription routing", () => {
  it("passes Parakeet through even when Whisper is also installed", async () => {
    const resolution = resolveTranscription(baseSettings(), [whisper, parakeet], "desktop");
    if (resolution.ok === false) throw new Error("unexpected failure");
    await routePodcastTranscription("episode-1", "https://audio", resolution, "en", true);
    expect(mocks.transcribePodcastEpisode).toHaveBeenCalledWith(
      "episode-1",
      parakeet.id,
      "en",
      true,
    );
    expect(mocks.transcribePodcastEpisodeWithGroq).not.toHaveBeenCalled();
  });
});
