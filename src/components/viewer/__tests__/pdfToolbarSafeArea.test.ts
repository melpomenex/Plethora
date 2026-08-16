import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Mobile PDF chrome edge clearance (spec: mobile-pdf-chrome-spacing).
 *
 * The PDF reader toolbar and the DocumentViewer mobile compact toolbar are the
 * only in-flow mobile headers that sit directly on the shell padding; without
 * an explicit horizontal rule their controls hug the screen edge (and the
 * landscape notch). Both must consume the shared `.safe-x-pad` utility —
 * max(safe-area inset, 12px) per side — and must not carry a shorthand padding
 * utility that would compete with those longhands.
 */

const viewerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(viewerDir, "../../../..");

function readSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8");
}

describe("mobile PDF toolbar safe-area clearance", () => {
  it("defines the shared .safe-x-pad utility with a 12px floor and inset expansion", () => {
    const indexCss = readSource("src/index.css");
    const match = indexCss.match(/\.safe-x-pad\s*\{[^}]*\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("padding-left: max(env(safe-area-inset-left, 0px), 12px)");
    expect(match![0]).toContain("padding-right: max(env(safe-area-inset-right, 0px), 12px)");
  });

  it("applies safe-x-pad to the PDF reader toolbar with vertical-only utility padding", () => {
    const source = readSource("src/components/viewer/PDFViewer.tsx");
    const toolbar = source.match(/pdf-reader-toolbar[^"]*"/);
    expect(toolbar).not.toBeNull();
    const classList = toolbar![0];
    expect(classList).toContain("safe-x-pad");
    expect(classList).toContain("py-1");
    // Shorthand padding would fight the safe-area longhands.
    expect(classList).not.toMatch(/\bp-1\b/);
    expect(classList).not.toMatch(/\bp-2\b/);
  });

  it("applies safe-x-pad to the DocumentViewer mobile compact toolbar", () => {
    const source = readSource("src/components/viewer/DocumentViewer.tsx");
    const compact = source.match(/Mobile Compact Toolbar[\s\S]{0,200}?className="([^"]+)"/);
    expect(compact).not.toBeNull();
    expect(compact![1]).toContain("safe-x-pad");
    expect(compact![1]).toContain("py-2");
    expect(compact![1]).not.toMatch(/\bp-2\b/);
  });

  it("keeps the 44px touch-target rule for toolbar controls", () => {
    const css = readSource("src/components/viewer/PDFViewer.css");
    expect(css).toContain(".pdf-reader-toolbar button");
    expect(css).toMatch(/min-width:\s*44px/);
    expect(css).toMatch(/min-height:\s*44px/);
  });
});
