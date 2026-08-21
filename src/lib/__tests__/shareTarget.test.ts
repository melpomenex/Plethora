import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeSharedBatch, registerShareListener, fetchPendingShares } from "../shareTarget";
import * as tauriLib from "../tauri";

vi.mock("../tauri", () => ({
  isTauri: vi.fn(() => false),
  invokeCommand: vi.fn(),
}));

describe("shareTarget utilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("normalizeSharedBatch", () => {
    it("normalizes a raw URL string", () => {
      const batch = normalizeSharedBatch("https://arxiv.org/abs/2301.00001");
      expect(batch).not.toBeNull();
      expect(batch?.items).toHaveLength(1);
      expect(batch?.items[0]).toEqual({
        type: "url",
        url: "https://arxiv.org/abs/2301.00001",
      });
    });

    it("normalizes a raw text note string", () => {
      const batch = normalizeSharedBatch("Interesting quote from chapter 4");
      expect(batch).not.toBeNull();
      expect(batch?.items).toHaveLength(1);
      expect(batch?.items[0]).toEqual({
        type: "text",
        text: "Interesting quote from chapter 4",
      });
    });

    it("normalizes an object containing URL and title", () => {
      const batch = normalizeSharedBatch({
        url: "https://incrementum.app",
        title: "Incrementum",
        text: "Check this reader out",
      });
      expect(batch).not.toBeNull();
      expect(batch?.items[0]).toEqual({
        type: "url",
        url: "https://incrementum.app",
        title: "Incrementum",
        text: "Check this reader out",
      });
    });

    it("normalizes a multi-item batch", () => {
      const rawBatch = {
        timestamp: 1723700000000,
        items: [
          {
            type: "file",
            filePath: "/data/user/0/com.incrementum.app/files/imports/paper.pdf",
            fileName: "paper.pdf",
            mimeType: "application/pdf",
            fileSize: 504200,
          },
          {
            type: "url",
            url: "https://arxiv.org/pdf/2301.00001",
          },
        ],
      };

      const batch = normalizeSharedBatch(rawBatch);
      expect(batch).not.toBeNull();
      expect(batch?.timestamp).toBe(1723700000000);
      expect(batch?.items).toHaveLength(2);
      expect(batch?.items[0].fileName).toBe("paper.pdf");
      expect(batch?.items[1].url).toBe("https://arxiv.org/pdf/2301.00001");
    });
  });

  describe("registerShareListener", () => {
    it("dispatches batches from custom events and unregisters cleanly", () => {
      const onBatch = vi.fn();
      const unsubscribe = registerShareListener(onBatch);

      const testEvent = new CustomEvent("plethora-native-share", {
        detail: {
          items: [{ type: "url", url: "https://example.com/doc" }],
        },
      });
      window.dispatchEvent(testEvent);

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(onBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ url: "https://example.com/doc" })],
        })
      );

      unsubscribe();

      window.dispatchEvent(testEvent);
      expect(onBatch).toHaveBeenCalledTimes(1); // not called again
    });

    it("delivers warm-start file/text batches on 'plethora-native-share' (regression: event-name mismatch dropped these)", () => {
      const onBatch = vi.fn();
      const unsubscribe = registerShareListener(onBatch);

      // This is exactly the payload Kotlin builds for ACTION_SEND with a
      // stream attachment plus note — previously emitted under the
      // 'incrementum-native-share' name and silently dropped.
      window.dispatchEvent(
        new CustomEvent("plethora-native-share", {
          detail: {
            timestamp: 1723700000000,
            items: [
              {
                type: "file",
                filePath: "/data/user/0/com.plethora.app/files/imports/paper.pdf",
                fileName: "paper.pdf",
                mimeType: "application/pdf",
                fileSize: 12345,
                title: "A paper",
                text: "read later",
              },
              { type: "text", text: "plain note" },
            ],
          },
        })
      );

      expect(onBatch).toHaveBeenCalledTimes(1);
      const batch = onBatch.mock.calls[0][0];
      expect(batch.items).toHaveLength(2);
      expect(batch.items[0]).toMatchObject({ type: "file", fileName: "paper.pdf" });
      expect(batch.items[1]).toMatchObject({ type: "text", text: "plain note" });

      unsubscribe();
    });

    it("still delivers the legacy 'android-shared-url' single-URL path", () => {
      const onBatch = vi.fn();
      const unsubscribe = registerShareListener(onBatch);

      window.dispatchEvent(
        new CustomEvent("android-shared-url", { detail: "https://example.com/legacy" })
      );

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(onBatch.mock.calls[0][0].items[0]).toMatchObject({
        type: "url",
        url: "https://example.com/legacy",
      });

      unsubscribe();
    });

    it("ignores the retired 'incrementum-native-share' event name", () => {
      const onBatch = vi.fn();
      const unsubscribe = registerShareListener(onBatch);

      window.dispatchEvent(
        new CustomEvent("incrementum-native-share", {
          detail: { items: [{ type: "url", url: "https://example.com/old" }] },
        })
      );

      expect(onBatch).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe("fetchPendingShares (cold-start drain)", () => {
    it("returns [] when not running inside Tauri", async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
      await expect(fetchPendingShares()).resolves.toEqual([]);
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it("drains pending batches via get_pending_shares and normalizes them", async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue([
        {
          id: "batch-1",
          timestamp: 1723700000000,
          items: [{ type: "url", url: "https://example.com/cold" }],
        },
      ]);

      const batches = await fetchPendingShares();

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith(
        "plugin:plethora-folder-import|get_pending_shares"
      );
      expect(batches).toHaveLength(1);
      expect(batches[0].id).toBe("batch-1");
      expect(batches[0].items[0]).toMatchObject({ type: "url", url: "https://example.com/cold" });
    });

    it("resolves to [] when the command fails instead of throwing", async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
      vi.mocked(tauriLib.invokeCommand).mockRejectedValue(new Error("plugin missing"));
      await expect(fetchPendingShares()).resolves.toEqual([]);
    });
  });
});
