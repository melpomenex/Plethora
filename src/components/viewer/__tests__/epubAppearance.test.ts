import { describe, expect, it } from "vitest";
import {
  epubUsesPublisherAppearance,
  preserveEpubPublisherStyles,
  restoreEpubPublisherStyles,
} from "../epubAppearance";
describe("EPUB source appearance", () => {
  it("uses spine overrides before package layout and preserves malformed explicit layouts", () => {
    expect(
      epubUsesPublisherAppearance(
        { section: { properties: ["rendition:layout-reflowable"] } },
        { packaging: { metadata: { layout: "pre-paginated" } } }
      )
    ).toBe(false);
    expect(
      epubUsesPublisherAppearance(
        { section: { properties: ["rendition:layout-pre-paginated"] } },
        {}
      )
    ).toBe(true);
    expect(epubUsesPublisherAppearance({}, {})).toBe(false);
    expect(epubUsesPublisherAppearance({}, {packaging:{metadata:{layout:""}}})).toBe(false);
    expect(
      epubUsesPublisherAppearance({}, { packaging: { metadata: { layout: "unknown" } } })
    ).toBe(true);
    expect(epubUsesPublisherAppearance({}, {}, "publisher")).toBe(true);
  });
  it("restores publisher styling without replacing text nodes or changing source data", () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><style>p{color:blue}</style></head><body style="background:white"><p style="color:red">Original words</p></body></html>',
      "text/html"
    );
    const p = doc.querySelector("p");
    const node = p.firstChild;
    preserveEpubPublisherStyles(doc);
    doc.querySelector("style").remove();
    p.removeAttribute("style");
    doc.body.style.background = "yellow";
    const own = doc.createElement("style");
    own.id = "epub-override-styles";
    doc.head.appendChild(own);
    restoreEpubPublisherStyles(doc);
    expect(doc.querySelector("p").firstChild).toBe(node);
    expect(p.style.color).toBe("red");
    expect(doc.body.style.background).toBe("white");
    expect(doc.getElementById("epub-override-styles")).toBeNull();
    restoreEpubPublisherStyles(doc);
    expect(doc.querySelectorAll("style")).toHaveLength(1);
  });
});
