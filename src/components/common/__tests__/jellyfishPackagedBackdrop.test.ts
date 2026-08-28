import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("packaged Jellyfish backdrop contract", () => {
  it("mounts ThemeBackdrop synchronously without a production lazy chunk", () => {
    const scaffold = readFileSync(
      join(repoRoot, "src/components/layout/AdaptiveAppScaffold.tsx"),
      "utf8",
    );

    expect(scaffold).toContain('import { ThemeBackdrop } from "../common/ThemeBackdrop"');
    expect(scaffold).not.toContain('lazy(() =>');
    expect(scaffold).not.toContain('import("../common/ThemeBackdrop")');
  });

  it("bundles a CSP-independent shell transparency fallback", () => {
    const css = readFileSync(join(repoRoot, "src/index.css"), "utf8");

    expect(css).toContain(':root[data-theme-animation="jellyfish"] .app-shell');
    expect(css).toContain(':root[data-theme-animation="jellyfish"] .bg-background:not(.app-shell)');
  });
});
