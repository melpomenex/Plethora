import { describe, expect, it } from "vitest";
import { resolveViteBuildTargets } from "../runtimeTarget";
import { prepareHtmlDocument } from "../../components/viewer/htmlReader/prepareHtmlDocument";

/**
 * Regression: production Tauri classification must include canonical reader
 * asset resolution — the two concerns must not diverge silently.
 */
describe("production Tauri + canonical reader parity", () => {
  it("Tauri production env is not PWA and canonical assets resolve offline", () => {
    const build = resolveViteBuildTargets(
      {
        TAURI_ENV_PLATFORM: "darwin",
        TAURI_ENV_ARCH: "aarch64",
        TAURI_ENV_FAMILY: "unix",
        TAURI_ENV_TARGET_TRIPLE: "aarch64-apple-darwin",
      },
      "production"
    );
    expect(build.isPWA).toBe(false);
    expect(build.runtimeTarget).toBe("tauri");

    const prepared = prepareHtmlDocument({
      html: '<article class="inc-article"><div class="inc-body"><img src="plethora-asset://local-fig" alt="Figure"></div></article>',
      kind: "canonical-article",
      title: "MoE",
      baseUrl: "https://arxiv.org/html/2410.07524v1/",
      preserveImages: true,
      assetRenderUrls: { "local-fig": "data:image/svg+xml;base64,PHN2Zy8+" },
    });
    expect(prepared).toContain("data:image/svg+xml;base64,PHN2Zy8+");
    expect(prepared).not.toContain("plethora-asset://");
  });
});
