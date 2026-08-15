import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireImageAsset,
  getFilePathFromUrl,
  ImageAcquisitionError,
  isPublicRemoteImageUrl,
  planStrategies,
  type ImageAcquisitionDeps,
} from "../imageAcquisition";
import type { ImageAsset } from "../../api/image-registry";

const asset = { id: "asset-1" } as ImageAsset;
const rect = { left: 10, top: 20, width: 100, height: 80 };

function makeDeps(overrides: Partial<ImageAcquisitionDeps> = {}): ImageAcquisitionDeps {
  return {
    isTauri: () => true,
    fetchBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
    ingestBlob: vi.fn(async () => asset),
    ingestRemote: vi.fn(async () => asset),
    ingestFromPath: vi.fn(async () => asset),
    captureElement: vi.fn(async () => new Blob(["el"], { type: "image/png" })),
    captureRect: vi.fn(async () => new Blob(["y"], { type: "image/png" })),
    ...overrides,
  };
}

/** WebKit's cross-origin rejection, verbatim. */
const loadFailed = () => Promise.reject(new Error("Load failed"));

describe("strategy planning", () => {
  it("leads with native ingestion for public remote URLs", () => {
    const plan = planStrategies({ src: "https://example.com/a.png", rect }, { isTauri: () => true });
    expect(plan[0]).toBe("native");
  });

  it("leads with a direct read for data and blob URLs", () => {
    expect(planStrategies({ src: "data:image/png;base64,AAA" }, { isTauri: () => true })[0]).toBe("direct");
    expect(planStrategies({ src: "blob:http://localhost/abc" }, { isTauri: () => true })[0]).toBe("direct");
  });

  it("offers pixel capture as a last resort for every source with a rect", () => {
    for (const src of [
      "https://example.com/a.png",
      "asset://localhost/tmp/a.png",
      "http://localhost:1420/img.png",
      "blob:http://localhost/abc",
    ]) {
      const plan = planStrategies({ src, rect }, { isTauri: () => true });
      expect(plan.at(-1), src).toBe("pixel-capture");
    }
  });

  it("omits native strategies outside the desktop app", () => {
    const plan = planStrategies({ src: "https://example.com/a.png", rect }, { isTauri: () => false });
    expect(plan).toEqual(["direct", "element-canvas"]);
  });

  it("omits pixel capture when there is no rect to capture", () => {
    const plan = planStrategies({ src: "https://example.com/a.png" }, { isTauri: () => true });
    expect(plan).not.toContain("pixel-capture");
  });
});

describe("acquiring an image", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers a document-local image via native ingestion when the webview fetch fails", async () => {
    // The reported occlusion bug: an image inside an imported article, served
    // over loopback. Rust can reach it even though the webview cannot.
    const deps = makeDeps({ fetchBlob: loadFailed, ingestFromPath: () => Promise.reject(new Error("ENOENT")) });

    const result = await acquireImageAsset({ src: "http://localhost:1420/article/img.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.ingestRemote).toHaveBeenCalled();
  });

  it("falls back to pixel capture for a document-local image nothing can download", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      ingestFromPath: () => Promise.reject(new Error("ENOENT")),
      ingestRemote: () => Promise.reject(new Error("HTTP 404 Not Found")),
      captureElement: () => Promise.reject(new Error("the image is no longer on screen")),
    });

    const result = await acquireImageAsset({ src: "http://localhost:1420/article/img.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalledWith(rect);
  });

  it("falls back to pixel capture for an in-app viewer blob the webview cannot read", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      captureElement: () => Promise.reject(new Error("the image is no longer on screen")),
    });

    const result = await acquireImageAsset({ src: "blob:http://localhost/abc", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalled();
  });

  it("reads an app asset from disk when the webview fetch fails", async () => {
    const deps = makeDeps({ fetchBlob: loadFailed });

    const result = await acquireImageAsset({ src: "asset://localhost/tmp/pic.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.ingestFromPath).toHaveBeenCalledWith("/tmp/pic.png", "pic.png", "image/png");
    expect(deps.captureRect).not.toHaveBeenCalled();
  });

  it("ingests a loopback media-server image from its URL-named file when the webview fetch is CORS-blocked", async () => {
    // The Android report: "denied because of cross origin" while saving an
    // image from a document (or creating an occlusion card from it). The
    // image is served by the app's own 127.0.0.1 media server, which sends
    // no CORS headers; the URL carries the backing path.
    const deps = makeDeps({
      fetchBlob: loadFailed,
      ingestRemote: () => Promise.reject(new Error("Image URL is not allowed: private address")),
    });
    const src = `http://127.0.0.1:39591/stream?path=${encodeURIComponent("/data/user/0/com.incrementum.app/files/documents/img 1.png")}`;

    const result = await acquireImageAsset({ src, rect }, deps);

    expect(result).toBe(asset);
    expect(deps.ingestFromPath).toHaveBeenCalledWith(
      "/data/user/0/com.incrementum.app/files/documents/img 1.png",
      "img 1.png",
      "image/png",
    );
  });

  it("ingests a loopback epub-server image URL from its backing file", async () => {
    const deps = makeDeps({ fetchBlob: loadFailed });
    const src = `http://127.0.0.1:39591/epub/book.epub?path=${encodeURIComponent("/tmp/book.epub")}`;

    const result = await acquireImageAsset({ src, rect }, deps);

    expect(result).toBe(asset);
    expect(deps.ingestFromPath).toHaveBeenCalledWith("/tmp/book.epub", "book.epub", "application/epub+zip");
  });

  it("uses native ingestion for a remote URL without touching fetch", async () => {
    const deps = makeDeps();

    await acquireImageAsset(
      { src: "https://example.com/pic.png", referrerUrl: "https://example.com/article", rect },
      deps,
    );

    expect(deps.ingestRemote).toHaveBeenCalledWith(
      "https://example.com/pic.png",
      "pic.png",
      "https://example.com/article",
    );
    expect(deps.fetchBlob).not.toHaveBeenCalled();
  });

  it("captures rendered pixels when a protected remote host refuses every download", async () => {
    const deps = makeDeps({
      ingestRemote: () => Promise.reject(new Error("HTTP 403 Forbidden")),
      fetchBlob: loadFailed,
      captureElement: () => Promise.reject(new Error("canvas export failed (cross-origin pixels)")),
    });

    const result = await acquireImageAsset({ src: "https://example.com/pic.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalled();
  });

  it("never surfaces the raw platform error when everything fails", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      ingestRemote: loadFailed,
      ingestFromPath: () => Promise.reject(new Error("ENOENT")),
      captureElement: () => Promise.reject(new Error("the image is no longer on screen")),
      captureRect: () => Promise.reject(new Error("capture unavailable")),
    });

    const error = (await acquireImageAsset({ src: "https://example.com/pic.png", rect }, deps).catch(
      (e) => e,
    )) as ImageAcquisitionError;

    expect(error).toBeInstanceOf(ImageAcquisitionError);
    expect(error.message).not.toBe("Load failed");
    expect(error.message).toContain("pic.png");
    expect(error.message).toContain("cross-origin");
    expect(error.message).toMatch(/Image Registry/);
  });

  it("records every strategy it tried", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      ingestRemote: () => Promise.reject(new Error("HTTP 403 Forbidden")),
      captureElement: () => Promise.reject(new Error("canvas export failed (cross-origin pixels)")),
      captureRect: () => Promise.reject(new Error("capture unavailable")),
    });

    const error = (await acquireImageAsset({ src: "https://example.com/pic.png", rect }, deps).catch(
      (e) => e,
    )) as ImageAcquisitionError;

    expect(error.attempts.map((a) => a.strategy)).toEqual([
      "native",
      "direct",
      "element-canvas",
      "pixel-capture",
    ]);
  });

  it("recovers a revoked blob image by reading the on-screen element's pixels", async () => {
    // The Android EPUB report: epub.js substitutes archived images with
    // blob: URLs and revokes them, so the displayed image's src no longer
    // fetches — but the <img> still carries decoded, same-origin pixels.
    const deps = makeDeps({ fetchBlob: loadFailed });

    const result = await acquireImageAsset({ src: "blob:http://tauri.localhost/abc", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureElement).toHaveBeenCalledWith("blob:http://tauri.localhost/abc");
    expect(deps.ingestBlob).toHaveBeenCalled();
  });

  it("reports a revoked object URL — not a cross-origin block — when a blob image cannot be reread", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      captureElement: () => Promise.reject(new Error("the image is no longer on screen")),
    });

    const error = (await acquireImageAsset({ src: "blob:http://tauri.localhost/abc" }, deps).catch(
      (e) => e,
    )) as ImageAcquisitionError;

    expect(error).toBeInstanceOf(ImageAcquisitionError);
    expect(error.attempts.map((a) => a.strategy)).toEqual(["direct", "element-canvas"]);
    expect(error.attempts[0].reason).toContain("revoked");
    expect(error.message).not.toContain("cross-origin");
  });
});

describe("source classification", () => {
  it("treats loopback and app hosts as non-public", () => {
    expect(isPublicRemoteImageUrl("https://example.com/a.png")).toBe(true);
    expect(isPublicRemoteImageUrl("http://localhost:1420/a.png")).toBe(false);
    expect(isPublicRemoteImageUrl("https://asset.localhost/a.png")).toBe(false);
    expect(isPublicRemoteImageUrl("data:image/png;base64,AAA")).toBe(false);
  });

  it("extracts local paths from every app URL shape", () => {
    expect(getFilePathFromUrl("asset://localhost/tmp/a.png")).toBe("/tmp/a.png");
    expect(getFilePathFromUrl("file:///tmp/a.png")).toBe("/tmp/a.png");
    expect(getFilePathFromUrl("https://asset.localhost/tmp/a.png")).toBe("/tmp/a.png");
    expect(
      getFilePathFromUrl(`http://127.0.0.1:39591/stream?path=${encodeURIComponent("/data/user/0/app/files/a.png")}`),
    ).toBe("/data/user/0/app/files/a.png");
    expect(
      getFilePathFromUrl(`http://localhost:39591/epub?path=${encodeURIComponent("/tmp/b.epub")}`),
    ).toBe("/tmp/b.epub");
    expect(
      getFilePathFromUrl(`http://127.0.0.1:39591/epub/book.epub?path=${encodeURIComponent("/tmp/b.epub")}`),
    ).toBe("/tmp/b.epub");
    // Loopback URLs without our stream routes or path params are not files.
    expect(getFilePathFromUrl("http://127.0.0.1:39591/other")).toBeNull();
    expect(getFilePathFromUrl("http://127.0.0.1:39591/stream")).toBeNull();
    expect(getFilePathFromUrl("https://example.com/a.png")).toBeNull();
  });
});
