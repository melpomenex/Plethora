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

  describe("object-URL lifecycle invariant (task 5.4)", () => {
    let revokeSpy: ReturnType<typeof vi.fn>;

    /** Fake media element whose load() fires `playing`, so the probe passes. */
    function stubMediaElement() {
      const listeners: Record<string, Array<() => void>> = {};
      const fake = {
        preload: "",
        muted: false,
        _src: "",
        set src(value: string) {
          this._src = value;
        },
        get src() {
          return this._src;
        },
        error: null,
        canPlayType: () => "probably",
        addEventListener: (name: string, cb: () => void) => {
          (listeners[name] ??= []).push(cb);
        },
        removeEventListener: (name: string, cb: () => void) => {
          listeners[name] = (listeners[name] ?? []).filter((fn) => fn !== cb);
        },
        removeAttribute: () => {},
        pause: () => {},
        load: () => {
          queueMicrotask(() => (listeners["playing"] ?? []).forEach((fn) => fn()));
        },
        play: () => Promise.resolve(),
      };
      vi.spyOn(document, "createElement").mockReturnValue(fake as unknown as HTMLElement);
    }

    beforeEach(() => {
      mobileMocks.isNativeMobile.mockReturnValue(false);
      mobileMocks.invokeCommand.mockRejectedValue(new Error("no media server"));
      revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture-source");
    });

    it("every blob URL a reader is handed is marked revokeSrcOnDispose so unmount revokes it", async () => {
      stubMediaElement();
      const { readDocumentFile } = await import("../../../api/documents");
      (readDocumentFile as ReturnType<typeof vi.fn>).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      const source = await resolveLocalMediaSource("/audio.mp3", "audio");

      expect(source.src.startsWith("blob:")).toBe(true);
      expect(source.revokeSrcOnDispose).toBe(true); // the reader's unmount path must revoke it
      expect(revokeSpy).not.toHaveBeenCalled(); // nothing revokes before disposal

      // Simulate the reader's unmount disposal (DocumentViewer.tsx:847-849).
      URL.revokeObjectURL(source.src);
      expect(revokeSpy).toHaveBeenCalledWith(source.src);
    });

    it("a blob URL whose probe fails is revoked by the resolver itself (no dangling URL)", async () => {
      vi.useFakeTimers();
      vi.restoreAllMocks(); // undo the previous test's document.createElement stub
      revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture-source");
      const { readDocumentFile } = await import("../../../api/documents");
      (readDocumentFile as ReturnType<typeof vi.fn>).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      // With no stubbed element, jsdom never fires `playing`/`error`, so the
      // probe times out and the resolver must revoke the URL it created.
      const resolution = resolveLocalMediaSource("/audio.mp3", "audio");
      const assertion = expect(resolution).rejects.toThrow(/Could not resolve a playable media source/);
      await vi.advanceTimersByTimeAsync(9_000);
      await assertion;
      expect(revokeSpy).toHaveBeenCalledWith("blob:fixture-source");
    });
  });
});
