import { describe, expect, it } from "vitest";
import { processHtmlContent } from "../documentImport";

describe("processHtmlContent", () => {
  it("restores lazy-loaded images as absolute eager image sources", () => {
    const html = processHtmlContent(
      '<article><img src="placeholder.gif" data-src="../images/map.png" srcset="placeholder.png 1x"></article>',
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

  it("isolates the article body from MediaWiki navigation chrome", () => {
    const html = processHtmlContent(
      '<main><nav>Jump to content Main menu</nav><div id="mw-content-text"><div class="mw-parser-output"><h1>History</h1><p>The real article.</p><div class="navbox">Related navigation</div></div></div></main>',
      "https://en.wikipedia.org/wiki/History",
      "History",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.body.textContent).toContain("The real article.");
    expect(parsed.body.textContent).not.toContain("Jump to content");
    expect(parsed.body.textContent).not.toContain("Related navigation");
  });
});
