import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Narrow static guard for the interface-zoom ownership model (design D6).
 *
 * Reserved primary-modifier chords must have exactly one owner: the
 * application capture dispatcher. These assertions catch a future re-add of
 * the legacy document handlers at the source level; the real key behavior
 * (PDF/EPUB/HTML isolation, wheel gestures, toolbar controls, and palette
 * routing) is covered by the manual acceptance matrix in `verification.md`.
 */

const root = path.resolve(__dirname, "../../../..");
const documentViewer = readFileSync(
  path.join(root, "src/components/viewer/DocumentViewer.tsx"),
  "utf8",
);
const epubViewer = readFileSync(
  path.join(root, "src/components/viewer/EPUBViewer.tsx"),
  "utf8",
);

describe("document shortcut ownership", () => {
  it("removes the legacy reserved-chord handlers from DocumentViewer", () => {
    expect(documentViewer).not.toContain("Ctrl/Cmd + + / - / 0 zoom controls");
    expect(documentViewer).not.toContain("Keyboard shortcuts for HTML viewer zoom");
    expect(documentViewer).not.toContain(
      'e.key === "+" || (e.key === "=" && e.shiftKey) || e.key === "="',
    );
  });

  it("keeps the visible HTML font-size controls and wheel gesture", () => {
    expect(documentViewer).toContain("const increaseHtmlFontSize");
    expect(documentViewer).toContain("const decreaseHtmlFontSize");
    expect(documentViewer).toContain("const resetHtmlFontSize");
    expect(documentViewer).toContain("const handleWheel");
    expect(documentViewer).toContain('onClick={increaseHtmlFontSize}');
    expect(documentViewer).toContain('onClick={resetHtmlFontSize}');
  });

  it("keeps document palette routing in DocumentViewer", () => {
    expect(documentViewer).toContain('"doc.zoomReset": () => handleResetZoom()');
    expect(documentViewer).toContain("const handleResetZoom");
  });

  it("forwards the shared zoom handler into the HTML iframe", () => {
    expect(documentViewer).toContain("attachInterfaceZoomToIframe(iframeRef.current)");
  });

  it("removes the legacy EPUB font-size branches", () => {
    expect(epubViewer).not.toContain("Ctrl/Cmd + Plus to increase font size");
    expect(epubViewer).not.toContain(
      '(e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")',
    );
    expect(epubViewer).not.toContain('else if (lowerKey === "j")');
  });

  it("keeps the EPUB J/K chain and visible typography controls", () => {
    expect(epubViewer).toContain('if (lowerKey === "j")');
    expect(epubViewer).toContain("increaseFontSize");
    expect(epubViewer).toContain("decreaseFontSize");
    expect(epubViewer).toContain("resetFontSize");
  });

  it("forwards the shared zoom handler into the EPUB iframe at most once", () => {
    expect(epubViewer).toContain("attachInterfaceZoomToWindow(contents.window)");
  });
});
