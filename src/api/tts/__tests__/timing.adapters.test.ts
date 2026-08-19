/**
 * Provider timing adapter tests: the with-timestamps request path and
 * normalization (ElevenLabs), rawOutput timing shapes (fal), the Azure-style
 * JSON probe with binary fallback (openai-compatible), and capability flags.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { elevenlabsAdapter } from "../providers/elevenlabs";
import { falAdapter } from "../providers/fal";
import { openAICompatibleAdapter } from "../providers/openai-compatible";
import type { TTSAdapterContext } from "../types";

function makeCtx(provider: string): TTSAdapterContext {
  const tts = {
    providers: {
      [provider]: { apiKey: "test-key", baseUrl: "https://relay.example/v1" },
    },
  } as any;
  return { settings: { tts } as any, tts, config: tts.providers[provider] };
}

function jsonFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(8),
    headers: new Map([["content-type", "application/json"]]),
  })) as unknown as typeof fetch;
}

function binaryFetch() {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
    arrayBuffer: async () => bytes.buffer,
    headers: new Map([["content-type", "audio/mpeg"]]),
  })) as unknown as typeof fetch;
}

describe("elevenlabs timing adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("atob", (b64: string) => Buffer.from(b64, "base64").toString("binary"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the with-timestamps endpoint when includeTimings is set and normalizes measured timings", async () => {
    const text = "hello world again";
    const chars = Array.from(text);
    const fetchMock = jsonFetch({
      audio_base64: Buffer.from("fakeaudio").toString("base64"),
      alignment: {
        characters: chars,
        character_start_times_seconds: chars.map((_, i) => i * 0.1),
        character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.1),
      },
    });
    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    vi.stubGlobal("fetch", fetchMock);
    const result = await elevenlabsAdapter.synthesize(makeCtx("elevenlabs"), {
      text,
      model: "eleven_multilingual_v2",
      voice: "21m00Tcm4TlvDq8ikWAM",
      responseFormat: "mp3",
      includeTimings: true,
    });
    const url = calls[0][0] as string;
    expect(url).toContain("/with-timestamps");
    expect(result.wordTimings).toBeDefined();
    expect(result.wordTimings!.every((t) => t.source === "measured")).toBe(true);
    expect(result.wordTimings!.map((t) => t.word)).toEqual(["hello", "world", "again"]);
  });

  it("falls back to the binary endpoint when the timed response has no alignment", async () => {
    const fetchMock = jsonFetch({ audio_base64: "" });
    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    vi.stubGlobal("fetch", fetchMock);
    const result = await elevenlabsAdapter.synthesize(makeCtx("elevenlabs"), {
      text: "hello world",
      model: "m",
      voice: "v",
      responseFormat: "mp3",
      includeTimings: true,
    });
    expect(result.wordTimings).toBeUndefined();
    expect((calls[1]?.[0] as string) ?? "").toContain("/text-to-speech/v");
  });

  it("declares supportsWordTimings", () => {
    expect(elevenlabsAdapter.capabilities.supportsWordTimings).toBe(true);
  });
});

describe("fal timing adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes known word-timestamp shapes from rawOutput", async () => {
    const text = "one two three four";
    const words = text.split(" ");
    vi.stubGlobal(
      "fetch",
      jsonFetch({
        data: {
          audio: { url: "https://cdn.fal.run/a.mp3" },
          words: words.map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })),
        },
      }),
    );
    const result = await falAdapter.synthesize(makeCtx("fal"), {
      text,
      model: "fal-ai/tts",
      responseFormat: "mp3",
      includeTimings: true,
    });
    expect(result.wordTimings).toBeDefined();
    expect(result.wordTimings![2]).toMatchObject({ word: "three", start_ms: 1000, end_ms: 1400 });
  });

  it("yields no timings for unknown shapes", async () => {
    vi.stubGlobal("fetch", jsonFetch({ data: { audio: { url: "https://cdn.fal.run/b.mp3" } } }));
    const result = await falAdapter.synthesize(makeCtx("fal"), {
      text: "one two",
      model: "fal-ai/tts",
      responseFormat: "mp3",
      includeTimings: true,
    });
    expect(result.wordTimings).toBeUndefined();
  });
});

describe("openai-compatible timing probe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("consumes Azure-style JSON word boundaries when the relay returns them", async () => {
    const text = "alpha beta gamma";
    const words = text.split(" ");
    const fetchMock = jsonFetch({
      audio_url: "https://relay.example/a.mp3",
      WordBoundaries: words.map((w, i) => ({ text: w, offset: i * 10_000_000, duration: 5_000_000 })),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await openAICompatibleAdapter.synthesize(makeCtx("openai-compatible"), {
      text,
      model: "tts-1",
      voice: "alloy",
      responseFormat: "mp3",
      includeTimings: true,
    });
    expect(result.wordTimings).toBeDefined();
    expect(result.wordTimings![1]).toMatchObject({ word: "beta", start_ms: 1000, end_ms: 1500 });
    expect(result.audioUrl).toBe("https://relay.example/a.mp3");
  });

  it("falls back to binary when the endpoint is binary-only", async () => {
    const fetchMock = binaryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await openAICompatibleAdapter.synthesize(makeCtx("openai-compatible"), {
      text: "alpha beta",
      model: "tts-1",
      voice: "alloy",
      responseFormat: "mp3",
      includeTimings: true,
    });
    expect(result.wordTimings).toBeUndefined();
    expect(result.audioUrl.startsWith("blob:")).toBe(true);
  });

  it("does not declare word timing support (endpoint-dependent)", () => {
    expect(openAICompatibleAdapter.capabilities.supportsWordTimings).toBe(false);
  });
});
