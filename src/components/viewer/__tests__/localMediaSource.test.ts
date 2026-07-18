import { beforeEach, describe, expect, it, vi } from "vitest";

const mobileMocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isNativeMobile: vi.fn(() => true),
}));

vi.mock("../../../lib/tauri", () => ({
  convertFileSrc: vi.fn(),
  invokeCommand: mobileMocks.invokeCommand,
  isNativeMobile: mobileMocks.isNativeMobile,
  isTauri: vi.fn(() => true),
}));

vi.mock("../../../api/documents", () => ({
  readDocumentFile: vi.fn(),
}));

vi.mock("../../../lib/browser-file-store", () => ({
  getBrowserFile: vi.fn(),
}));

import {
  MOBILE_SOURCE_RESOLUTION_TIMEOUT_MS,
  inferMimeType,
  resolveLocalMediaSource,
  withTimeout,
} from "../localMediaSource";

describe("local mobile media source resolution", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mobileMocks.invokeCommand.mockReset();
    mobileMocks.isNativeMobile.mockReturnValue(true);
  });

  it("uses the bounded loopback media server source for mobile audiobooks", async () => {
    mobileMocks.invokeCommand.mockResolvedValue("http://127.0.0.1:43123/stream?path=%2Fbook.m4b");

    const source = await resolveLocalMediaSource("/book.m4b", "audio");

    expect(source.strategy).toBe("local-media-server");
    expect(source.mimeType).toBe("audio/mp4");
    expect(source.revokeSrcOnDispose).toBe(false);
    expect(mobileMocks.invokeCommand).toHaveBeenCalledWith("get_media_stream_url", { filePath: "/book.m4b" });
  });

  it("fails instead of waiting forever when mobile source resolution hangs", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      new Promise<string>(() => undefined),
      MOBILE_SOURCE_RESOLUTION_TIMEOUT_MS,
      "source resolution timed out",
    );

    const assertion = expect(pending).rejects.toThrow("source resolution timed out");
    await vi.advanceTimersByTimeAsync(MOBILE_SOURCE_RESOLUTION_TIMEOUT_MS);
    await assertion;
  });

  it("maps m4b files to the Android-compatible MP4 audio MIME type", () => {
    expect(inferMimeType("/books/title.m4b", "audio")).toBe("audio/mp4");
  });
});
