import { describe, expect, it } from "vitest";

// The Vite `define` global is absent under vitest (vitest.config.ts does not
// inherit it), which exercises the documented default path: undefined →
// 'development'. Parsing itself is tested via the exported pure helper.
import {
  parseBuildProfile,
  BUILD_PROFILE,
  isStoreProfile,
  isDevelopmentProfile,
} from "../buildProfile";

describe("parseBuildProfile", () => {
  it("defaults to development when the global is undefined", () => {
    expect(parseBuildProfile(undefined)).toBe("development");
  });

  it("defaults to development for null and empty string", () => {
    expect(parseBuildProfile(null)).toBe("development");
    expect(parseBuildProfile("")).toBe("development");
  });

  it("accepts every valid profile", () => {
    expect(parseBuildProfile("development")).toBe("development");
    expect(parseBuildProfile("sideload")).toBe("sideload");
    expect(parseBuildProfile("store")).toBe("store");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(parseBuildProfile("  Store ")).toBe("store");
    expect(parseBuildProfile("SIDELOAD")).toBe("sideload");
  });

  it("rejects invalid values instead of silently degrading", () => {
    expect(() => parseBuildProfile("production")).toThrow(/Invalid PLETHORA_BUILD_PROFILE/);
    expect(() => parseBuildProfile("release")).toThrow(/Invalid PLETHORA_BUILD_PROFILE/);
    expect(() => parseBuildProfile("store dev")).toThrow(/Invalid PLETHORA_BUILD_PROFILE/);
  });
});

describe("module-level constants (vitest runs without the define global)", () => {
  it("BUILD_PROFILE falls back to development", () => {
    expect(BUILD_PROFILE).toBe("development");
  });

  it("isDevelopmentProfile() is true and isStoreProfile() is false by default", () => {
    expect(isDevelopmentProfile()).toBe(true);
    expect(isStoreProfile()).toBe(false);
  });
});
