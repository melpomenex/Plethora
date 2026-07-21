import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeCommandMock, isTauriMock } = vi.hoisted(() => ({
  invokeCommandMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: invokeCommandMock,
  isTauri: isTauriMock,
  isNativeMobile: vi.fn(() => true),
  getPlatform: vi.fn(() => "unknown"),
}));

import { fetchYouTubeTranscript } from "../youtubeTranscriptBrowser";

const VIDEO_ID = "dQw4w9WgXcQ";
const SEGMENTS = [
  { text: "hello", start: 0, duration: 1.5 },
  { text: "world", start: 1.5, duration: 1.5 },
];

describe("fetchYouTubeTranscript on-device result handling", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network must not be reached"))));
  });

  it("accepts the serde-tagged success shape and short-circuits before any fallback", async () => {
    invokeCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_youtube_transcript_on_device") {
        return { status: "ok", segments: SEGMENTS, language: "en" };
      }
      throw new Error(`unexpected fallback command: ${cmd}`);
    });

    const res = await fetchYouTubeTranscript(VIDEO_ID);

    expect(res.segments).toEqual(SEGMENTS);
    expect(res.language).toBe("en");
    // Only the on-device command may run — no get_youtube_transcript_by_id, no fetch().
    expect(invokeCommandMock).toHaveBeenCalledTimes(1);
    expect(invokeCommandMock).toHaveBeenCalledWith(
      "fetch_youtube_transcript_on_device",
      expect.objectContaining({ videoId: VIDEO_ID })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Regression guard: this is the shape the old `kind === "Ok"` check could never match,
  // which sent every mobile request down to the bot-blocked Vercel scraper.
  it("does not mistake the success shape for a failure", async () => {
    invokeCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_youtube_transcript_on_device") {
        return { status: "ok", segments: SEGMENTS, language: "en" };
      }
      return null;
    });

    await expect(fetchYouTubeTranscript(VIDEO_ID)).resolves.toMatchObject({
      segments: SEGMENTS,
    });
    expect(invokeCommandMock).not.toHaveBeenCalledWith(
      "get_youtube_transcript_by_id",
      expect.anything()
    );
  });

  it("falls through to the next backend command on the error shape", async () => {
    const fallback = [{ text: "from fallback", start: 0, duration: 1 }];
    invokeCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_youtube_transcript_on_device") {
        return { status: "err", kind: "PoTokenRequired", detail: "gated" };
      }
      if (cmd === "get_youtube_transcript_by_id") return fallback;
      return null;
    });

    const res = await fetchYouTubeTranscript(VIDEO_ID);

    expect(res.segments).toEqual(fallback);
    expect(invokeCommandMock).toHaveBeenCalledWith(
      "get_youtube_transcript_by_id",
      expect.objectContaining({ videoId: VIDEO_ID })
    );
  });
});
