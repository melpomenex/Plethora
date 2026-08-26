import { describe, expect, it } from "vitest";
import { prepareHtmlDocument } from "../prepareHtmlDocument";

describe("prepareHtmlDocument canonical assets", () => {
  it("resolves plethora-asset URLs for offline rendering", () => {
    const prepared = prepareHtmlDocument({
      html: '<article class="inc-article"><div class="inc-body"><figure><img src="plethora-asset://asset-42" alt="MoE routing"><figcaption>Figure 1</figcaption></figure></div></article>',
      kind: "canonical-article",
      title: "Paper",
      baseUrl: "https://arxiv.org/html/2410.07524v1/",
      preserveImages: true,
      assetRenderUrls: {
        "asset-42": "data:image/svg+xml;base64,PHN2Zy8+",
      },
    });
    const doc = new DOMParser().parseFromString(prepared, "text/html");
    expect(doc.querySelector("img")?.src).toBe("data:image/svg+xml;base64,PHN2Zy8+");
    expect(doc.body.textContent).toContain("Figure 1");
  });

  it("drops unresolved plethora-asset images without network", () => {
    const prepared = prepareHtmlDocument({
      html: '<article class="inc-article"><div class="inc-body"><img src="plethora-asset://missing" alt="x"></div></article>',
      kind: "canonical-article",
      title: "Paper",
      baseUrl: "https://arxiv.org/html/2410.07524v1/",
      preserveImages: true,
      assetRenderUrls: {},
    });
    const doc = new DOMParser().parseFromString(prepared, "text/html");
    expect(doc.querySelector("img")).toBeNull();
  });
});
