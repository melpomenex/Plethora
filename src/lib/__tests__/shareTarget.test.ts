import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeSharedBatch, registerShareListener } from "../shareTarget";

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

      const testEvent = new CustomEvent("incrementum-native-share", {
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
  });
});
