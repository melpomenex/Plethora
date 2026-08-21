/**
 * Source audit for the scroll-mode-entry capability: Scroll Mode launcher UI
 * must not branch on theme identity and must not contain literal accent
 * colors — all mode-accent values flow through the semantic token layer
 * (src/components/queue/scrollModeEntry.ts) fed by the theme system.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const CONTRACT = read("../scrollModeEntry.ts");
const DESKTOP = read("../../review/ReviewQueueView.tsx");
const MOBILE = read("../../mobile/MobileQueueView.tsx");

describe("Scroll Mode UI source audit", () => {
  it("shared contract uses only mode-accent token utilities", () => {
    expect(CONTRACT).toContain("mode-accent");
    // No literal color values of any kind.
    expect(CONTRACT).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CONTRACT).not.toMatch(/\b(?:purple|pink|violet|fuchsia|magenta)\b/i);
    // No Tailwind palette classes outside the mode-accent token.
    expect(CONTRACT).not.toMatch(/-(?:purple|pink|violet|fuchsia)-\d{2,3}/);
  });

  it("shared contract does not branch on theme identity", () => {
    expect(CONTRACT).not.toMatch(/theme\.id|themeId|themeName|data-theme/);
    expect(CONTRACT).not.toMatch(/switch\s*\(/);
  });

  it.each([
    ["desktop", DESKTOP],
    ["mobile", MOBILE],
  ])("%s launcher source carries no pink/purple gradient classes", (_name, source) => {
    expect(source).not.toContain("from-purple-500");
    expect(source).not.toContain("to-pink-500");
    expect(source).not.toMatch(/bg-gradient-to-\w+[^`]*from-purple/);
  });

  it.each([
    ["desktop", DESKTOP],
    ["mobile", MOBILE],
  ])("%s launcher consumes the shared contract instead of local colors", (_name, source) => {
    expect(source).toContain("scrollModeEntry");
  });

  it("shared contract is the only place launcher classes are defined", () => {
    // Both views must import from the same module so the platforms cannot
    // drift (design D4).
    expect(DESKTOP).toMatch(/import\s+\{[^}]*scrollModeEntryProminentClasses[^}]*\}\s+from\s+"[^"]*scrollModeEntry"/);
    expect(MOBILE).toMatch(/import\s+\{[^}]*scrollModeEntryProminentClasses[^}]*\}\s+from\s+"[^"]*scrollModeEntry"/);
  });
});
