import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static containment contract for the Universe overlay. The full WebGL engine
 * is impractical to mount in jsdom, so this pins the layout contract that the
 * browser harness and the graph page test rely on: the Universe root is a
 * constrained child of the canvas wrapper, its top chrome is positioned
 * relative to that root (not the window), and the floating controls clear the
 * bottom safe area.
 */
describe("KnowledgeUniverse containment contract", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../KnowledgeUniverse.tsx"),
    "utf8",
  );

  it("renders inside a constrained full-size canvas wrapper", () => {
    expect(source).toContain('data-testid="knowledge-universe"');
    expect(source).toContain("relative h-full min-h-0 min-w-0 w-full overflow-hidden");
  });

  it("positions its top chrome relative to the canvas wrapper", () => {
    expect(source).toContain('"absolute top-3 left-3 right-3');
    expect(source).toContain('"absolute top-4 left-6 right-6');
    expect(source).not.toContain('"fixed top-3 left-3 right-3');
  });

  it("keeps the floating controls clear of the bottom safe area", () => {
    expect(source).toContain("calc(1.5rem + env(safe-area-inset-bottom))");
  });
});
