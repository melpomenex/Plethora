import { describe, expect, it } from "vitest";
import { processHtmlContent } from "../documentImport";

describe("processHtmlContent", () => {
  it("restores lazy-loaded images as absolute eager image sources", () => {
    const html = processHtmlContent(
      '<article><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" data-src="../images/map.png" srcset="placeholder.png 1x"></article>',
      "https://en.example.org/wiki/History",
      "History",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    const image = parsed.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://en.example.org/images/map.png");
    expect(image?.hasAttribute("srcset")).toBe(false);
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });
});
