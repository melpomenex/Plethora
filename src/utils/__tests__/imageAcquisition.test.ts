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
    readLocalFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
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
    expect(plan).toEqual(["direct"]);
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
    const deps = makeDeps({ fetchBlob: loadFailed, readLocalFile: () => Promise.reject(new Error("ENOENT")) });

    const result = await acquireImageAsset({ src: "http://localhost:1420/article/img.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.ingestRemote).toHaveBeenCalled();
  });

  it("falls back to pixel capture for a document-local image nothing can download", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      readLocalFile: () => Promise.reject(new Error("ENOENT")),
      ingestRemote: () => Promise.reject(new Error("HTTP 404 Not Found")),
    });

    const result = await acquireImageAsset({ src: "http://localhost:1420/article/img.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalledWith(rect);
  });

  it("falls back to pixel capture for an in-app viewer blob the webview cannot read", async () => {
    const deps = makeDeps({ fetchBlob: loadFailed });

    const result = await acquireImageAsset({ src: "blob:http://localhost/abc", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalled();
  });

  it("reads an app asset from disk when the webview fetch fails", async () => {
    const deps = makeDeps({ fetchBlob: loadFailed });

    const result = await acquireImageAsset({ src: "asset://localhost/tmp/pic.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.readLocalFile).toHaveBeenCalledWith("/tmp/pic.png");
    expect(deps.captureRect).not.toHaveBeenCalled();
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
    });

    const result = await acquireImageAsset({ src: "https://example.com/pic.png", rect }, deps);

    expect(result).toBe(asset);
    expect(deps.captureRect).toHaveBeenCalled();
  });

  it("never surfaces the raw platform error when everything fails", async () => {
    const deps = makeDeps({
      fetchBlob: loadFailed,
      ingestRemote: loadFailed,
      readLocalFile: () => Promise.reject(new Error("ENOENT")),
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
      captureRect: () => Promise.reject(new Error("capture unavailable")),
    });

    const error = (await acquireImageAsset({ src: "https://example.com/pic.png", rect }, deps).catch(
      (e) => e,
    )) as ImageAcquisitionError;

    expect(error.attempts.map((a) => a.strategy)).toEqual(["native", "direct", "pixel-capture"]);
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
    expect(getFilePathFromUrl("https://example.com/a.png")).toBeNull();
  });
});
