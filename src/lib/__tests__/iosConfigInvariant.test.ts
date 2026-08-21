import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Change A §3.4 invariant: desktop sidecars/resources must never leak into
 * the iOS bundle. `src-tauri/tauri.ios.conf.json` overrides the base config
 * and MUST keep `bundle.externalBin` and `bundle.resources` empty.
 */
const IOS_CONF_PATH = resolve(__dirname, "../../../src-tauri/tauri.ios.conf.json");

describe("tauri.ios.conf.json packaging invariants", () => {
  const conf = JSON.parse(readFileSync(IOS_CONF_PATH, "utf8"));

  it("exists and has a bundle section", () => {
    expect(conf.bundle).toBeTruthy();
  });

  it("keeps bundle.externalBin empty (no desktop sidecars on iOS)", () => {
    expect(Array.isArray(conf.bundle.externalBin)).toBe(true);
    expect(conf.bundle.externalBin).toEqual([]);
  });

  it("keeps bundle.resources empty (no desktop resources on iOS)", () => {
    expect(Array.isArray(conf.bundle.resources)).toBe(true);
    expect(conf.bundle.resources).toEqual([]);
  });

  it("pins the iOS minimum system version to match the generated project", () => {
    // project.yml / Info.plist deployment target is iOS 14.0 (see
    // scripts/apply-ios-project-overrides.js DEFAULTS.deploymentTarget).
    expect(conf.bundle.iOS?.minimumSystemVersion).toBe("14.0");
  });
});
