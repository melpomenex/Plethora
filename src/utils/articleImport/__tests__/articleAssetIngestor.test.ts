import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestRemoteImage = vi.fn();
const ingestImageBlob = vi.fn();

vi.mock("../../../api/image-registry", () => ({
  ingestRemoteImage: (...args: unknown[]) => ingestRemoteImage(...args),
  ingestImageBlob: (...args: unknown[]) => ingestImageBlob(...args),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
}));

import { ingestArticleAssets } from "../articleAssetIngestor";

describe("ingestArticleAssets", () => {
  beforeEach(() => {
    ingestRemoteImage.mockReset();
    ingestImageBlob.mockReset();
  });

  it("rewrites remote img src to plethora-asset URLs", async () => {
    ingestRemoteImage.mockResolvedValue({
      id: "asset-1",
      byte_size: 1200,
      mime_type: "image/png",
      data_url: "data:image/png;base64,abc",
    });

    const html =
      '<article class="inc-article"><div class="inc-body"><figure><img src="https://arxiv.org/html/2410.07524v1/moe-routing.svg" alt="routing"><figcaption>Figure 1</figcaption></figure></div></article>';

    const result = await ingestArticleAssets(html, {
      referrerUrl: "https://arxiv.org/html/2410.07524v1/",
    });

    expect(result.diagnostics.discovered).toBe(1);
    expect(result.diagnostics.imported).toBe(1);
    expect(result.diagnostics.assetIds).toEqual(["asset-1"]);
    expect(result.html).toContain('src="plethora-asset://asset-1"');
    expect(result.html).toContain("Figure 1");
    expect(ingestRemoteImage).toHaveBeenCalledWith(
      "https://arxiv.org/html/2410.07524v1/moe-routing.svg",
      "moe-routing.svg",
      "https://arxiv.org/html/2410.07524v1/"
    );
  });

  it("skips ingestion when preserveImages is false", async () => {
    const html = '<img src="https://example.com/a.png">';
    const result = await ingestArticleAssets(html, { preserveImages: false });
    expect(result.html).toBe(html);
    expect(result.diagnostics.discovered).toBe(0);
    expect(ingestRemoteImage).not.toHaveBeenCalled();
  });

  it("degrades gracefully when an image fetch fails", async () => {
    ingestRemoteImage.mockRejectedValue(new Error("HTTP 404"));

    const html =
      '<figure><img src="https://example.com/missing.png" alt="lost"><figcaption>Caption</figcaption></figure>';
    const result = await ingestArticleAssets(html);

    expect(result.diagnostics.failed).toBe(1);
    expect(result.html).toContain("Caption");
    expect(result.html).not.toContain('src="https://example.com/missing.png"');
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("deduplicates identical source URLs", async () => {
    ingestRemoteImage.mockResolvedValue({ id: "dup", byte_size: 100, mime_type: "image/png" });
    const html =
      '<img src="https://example.com/same.png"><img src="https://example.com/same.png">';
    const result = await ingestArticleAssets(html);
    expect(ingestRemoteImage).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.discovered).toBe(2);
    expect(result.diagnostics.imported).toBe(1);
    expect(result.html.match(/plethora-asset:\/\/dup/g)?.length).toBe(2);
  });
});
