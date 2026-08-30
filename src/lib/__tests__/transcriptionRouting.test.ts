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
  transcribeAudiobookOnDevice: vi.fn(),
  transcribeAudiobookWithOpenRouter: vi.fn(),
  transcribePodcastEpisode: vi.fn(),
  transcribePodcastEpisodeWithGroq: vi.fn(),
  transcribePodcastEpisodeOnDevice: vi.fn(),
  transcribePodcastEpisodeWithOpenRouter: vi.fn(),
}));

vi.mock("../../api/transcription", () => ({ enqueueAutoTranscription: mocks.enqueue }));
vi.mock("../../api/audiobooks", () => ({
  transcribeAudiobookWithGroq: mocks.transcribeAudiobookWithGroq,
  transcribeAudiobookOnDevice: mocks.transcribeAudiobookOnDevice,
  transcribeAudiobookWithOpenRouter: mocks.transcribeAudiobookWithOpenRouter,
}));
vi.mock("../../api/podcast", () => ({
  transcribePodcastEpisode: mocks.transcribePodcastEpisode,
  transcribePodcastEpisodeWithGroq: mocks.transcribePodcastEpisodeWithGroq,
  transcribePodcastEpisodeOnDevice: mocks.transcribePodcastEpisodeOnDevice,
  transcribePodcastEpisodeWithOpenRouter: mocks.transcribePodcastEpisodeWithOpenRouter,
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

describe("android on-device transcription routing", () => {
  it("routes documents to the on-device command without queueing", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), provider: "android-ondevice" },
      [],
      "native-mobile",
      { androidSttReady: true },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.m4b" },
      resolution,
      "en",
    );
    expect(route).toBe("android-ondevice");
    expect(mocks.transcribeAudiobookOnDevice).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.m4b",
      "en",
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.transcribeAudiobookWithGroq).not.toHaveBeenCalled();
  });

  it("routes podcasts to the on-device wrapper with the audio URL", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), provider: "android-ondevice" },
      [],
      "native-mobile",
      { androidSttReady: true },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routePodcastTranscription("episode-1", "https://audio", resolution, "en", true);
    expect(route).toBe("android-ondevice");
    expect(mocks.transcribePodcastEpisodeOnDevice).toHaveBeenCalledWith(
      "episode-1",
      "https://audio",
      "en",
    );
    expect(mocks.transcribePodcastEpisodeWithGroq).not.toHaveBeenCalled();
  });

  it("routes auto on-device (mobile substitution) documents to on-device", async () => {
    const resolution = resolveTranscription(baseSettings(), [parakeet], "native-mobile", {
      androidSttReady: true,
    });
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.m4b" },
      resolution,
      "auto",
    );
    expect(route).toBe("android-ondevice");
    expect(mocks.transcribeAudiobookOnDevice).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.m4b",
      undefined,
    );
  });

  it("routes local Nemotron resolution for documents to the auto queue", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), preferredModelId: undefined, preferLocal: true },
      [whisper],
      "desktop",
      { localNemotronReady: true },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routeDocumentTranscription(
      { id: "doc-1", filePath: "/audio/book.mp3" },
      resolution,
      "en",
    );
    expect(route).toBe("local");
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "doc-1",
      "/audio/book.mp3",
      "local",
      "nemotron-3.5-asr-0.6b",
      "en",
    );
    expect(mocks.transcribeAudiobookWithGroq).not.toHaveBeenCalled();
  });

  it("routes local Nemotron resolution for podcasts to transcribePodcastEpisode", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), preferredModelId: undefined, preferLocal: true },
      [whisper],
      "desktop",
      { localNemotronReady: true },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routePodcastTranscription(
      "episode-nemotron",
      "https://audio/ep.mp3",
      resolution,
      "en",
      true,
    );
    expect(route).toBe("local");
    expect(mocks.transcribePodcastEpisode).toHaveBeenCalledWith(
      "episode-nemotron",
      "nemotron-3.5-asr-0.6b",
      "en",
      true,
    );
    expect(mocks.transcribePodcastEpisodeWithGroq).not.toHaveBeenCalled();
  });

  it("routes openrouter resolution for podcasts to transcribePodcastEpisodeWithOpenRouter", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), sttProvider: "openrouter", sttModel: "nemotron-3.5-asr-0.6b" },
      [],
      "native-mobile",
      { openRouterKey: "sk-or-test" },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routePodcastTranscription(
      "episode-openrouter",
      "https://audio/ep.mp3",
      resolution,
      "en",
      true,
    );
    expect(route).toBe("openrouter");
    expect(mocks.transcribePodcastEpisodeWithOpenRouter).toHaveBeenCalledWith(
      "episode-openrouter",
      "https://audio/ep.mp3",
      "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      "en",
    );
    expect(mocks.transcribePodcastEpisodeWithGroq).not.toHaveBeenCalled();
    expect(mocks.transcribePodcastEpisode).not.toHaveBeenCalled();
  });

  it("routes openrouter resolution for documents to transcribeAudiobookWithOpenRouter", async () => {
    const resolution = resolveTranscription(
      { ...baseSettings(), sttProvider: "openrouter", sttModel: "nemotron-3.5-asr-0.6b" },
      [],
      "desktop",
      { openRouterKey: "sk-or-test" },
    );
    if (resolution.ok === false) throw new Error("unexpected failure");
    const route = await routeDocumentTranscription(
      { id: "doc-openrouter", filePath: "/audio/book.mp3" },
      resolution,
      "en",
    );
    expect(route).toBe("openrouter");
    expect(mocks.transcribeAudiobookWithOpenRouter).toHaveBeenCalledWith(
      "doc-openrouter",
      "/audio/book.mp3",
      "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      "en",
    );
    expect(mocks.transcribeAudiobookWithGroq).not.toHaveBeenCalled();
  });
});
