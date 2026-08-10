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
  SOURCE_RESOLUTION_TIMEOUT_MS,
  inferMimeType,
  resolveLocalMediaSource,
  withTimeout,
} from "../localMediaSource";

describe("local media source resolution", () => {
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

  it("resolves desktop media through the loopback server and never an asset URL", async () => {
    mobileMocks.isNativeMobile.mockReturnValue(false);
    mobileMocks.invokeCommand.mockResolvedValue("http://127.0.0.1:43123/stream?path=%2FDownloads%2Fbook.m4b");

    const source = await resolveLocalMediaSource("/Downloads/book.m4b", "audio");

    expect(source.strategy).toBe("local-media-server");
    expect(source.src.startsWith("http://127.0.0.1:")).toBe(true);
    expect(source.src).not.toContain("asset:");
    expect(source.revokeSrcOnDispose).toBe(false);
    expect(mobileMocks.invokeCommand).toHaveBeenCalledWith("get_media_stream_url", { filePath: "/Downloads/book.m4b" });
  });

  it("fails instead of waiting forever when source resolution hangs", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      new Promise<string>(() => undefined),
      SOURCE_RESOLUTION_TIMEOUT_MS,
      "source resolution timed out",
    );

    const assertion = expect(pending).rejects.toThrow("source resolution timed out");
    await vi.advanceTimersByTimeAsync(SOURCE_RESOLUTION_TIMEOUT_MS);
    await assertion;
  });

  it("maps m4b files to the Android-compatible MP4 audio MIME type", () => {
    expect(inferMimeType("/books/title.m4b", "audio")).toBe("audio/mp4");
  });
});
