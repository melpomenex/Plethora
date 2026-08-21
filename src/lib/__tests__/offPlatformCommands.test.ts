import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isPlatformCapabilityAvailable,
  getPlatformCapability,
} from "../platformCapabilities";

/**
 * §2.7 — off-platform native commands must never be user-facing on iOS
 * because no iOS-reachable UI path invokes them.
 *
 * Strategy (static, no simulator required):
 *  1. Registry assertions: `apk_install` and `desktop_capture_dom` are
 *     unavailable on iOS (and under the store profile, everywhere).
 *  2. Source scan: the ONLY frontend files that may reference these commands
 *     are the allow-listed ones below, each of which is verified (by code
 *     audit, recorded in ios-surface-audit.md) to guard the invocation behind
 *     an Android/desktop platform check that the iOS UI cannot pass.
 *  3. The UI entry points that would reach those files are gated through the
 *     registry (SettingsPage updater row → `app_updater`; capture client
 *     selection → desktop only).
 */

const REPO_ROOT = process.cwd();
const SRC_DIR = join(REPO_ROOT, "src");

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      listFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Files allowed to mention the off-platform commands, with their verified guard. */
const ALLOWED_REFERENCES: Record<string, string> = {
  "src/utils/updateChecker.ts":
    "install_apk invoke is inside the Android-only updater handle constructed under `isTauri() && nativePlatform() === 'android'`; the sole UI entry (Settings updater row) is registry-gated via `app_updater` (hidden on iOS).",
  "src/utils/articleImport/renderedFallback/captureClient.ts":
    "desktopCapture client invokes `capture_rendered_dom`; getCaptureClient() selects it for desktop only — iOS resolves to the typed-unavailable path (native:false/iframe:false matrix).",
};

describe("§2.7 off-platform native command reachability", () => {
  it("registry marks apk_install and desktop_capture_dom unavailable on iOS", () => {
    expect(isPlatformCapabilityAvailable("apk_install", { platform: "ios" })).toBe(false);
    expect(isPlatformCapabilityAvailable("desktop_capture_dom", { platform: "ios" })).toBe(false);
    // And under the store profile, unavailable everywhere.
    for (const platform of ["ios", "android", "desktop", "web"] as const) {
      expect(
        getPlatformCapability("apk_install", { platform, buildProfile: "store" }).available
      ).toBe(false);
    }
  });

  it("no un-allow-listed frontend file references the off-platform commands", () => {
    const files = listFiles(SRC_DIR).filter((f) => !f.includes("__tests__"));
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      const content = readFileSync(file, "utf8");
      const references =
        content.includes("install_apk") || content.includes("capture_rendered_dom");
      if (references && !(rel in ALLOWED_REFERENCES)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("every allowed reference site is documented with its verified guard", () => {
    const files = listFiles(SRC_DIR).filter((f) => !f.includes("__tests__"));
    const referencing = files
      .map((f) => relative(REPO_ROOT, f))
      .filter((rel) => {
        const content = readFileSync(join(REPO_ROOT, rel), "utf8");
        return (
          content.includes("install_apk") || content.includes("capture_rendered_dom")
        );
      });

    for (const rel of referencing) {
      expect(ALLOWED_REFERENCES[rel], `undocumented reference site: ${rel}`).toBeDefined();
    }
    // Sanity: the allow-list is not vacuous.
    expect(referencing.length).toBeGreaterThan(0);
  });
});
