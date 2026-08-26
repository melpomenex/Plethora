import { describe, expect, it } from "vitest";
import {
  isTauriEnvironment,
  resolveViteBuildTargets,
  type RuntimeTargetEnv,
} from "../runtimeTarget";

describe("isTauriEnvironment", () => {
  it("detects explicit Plethora override", () => {
    expect(isTauriEnvironment({ PLETHORA_TAURI: "1" })).toBe(true);
  });

  it("detects Tauri 2 production hook variables", () => {
    expect(
      isTauriEnvironment({
        TAURI_ENV_PLATFORM: "darwin",
        TAURI_ENV_ARCH: "aarch64",
        TAURI_ENV_FAMILY: "unix",
        TAURI_ENV_TARGET_TRIPLE: "aarch64-apple-darwin",
      })
    ).toBe(true);
  });

  it("detects legacy Tauri variables and dev host", () => {
    expect(isTauriEnvironment({ TAURI_PLATFORM: "darwin" })).toBe(true);
    expect(isTauriEnvironment({ TAURI_DEV_HOST: "127.0.0.1" })).toBe(true);
  });

  it("is false for plain web environments", () => {
    expect(isTauriEnvironment({})).toBe(false);
  });
});

describe("resolveViteBuildTargets", () => {
  const tauriProd: RuntimeTargetEnv = {
    TAURI_ENV_PLATFORM: "darwin",
    TAURI_ENV_ARCH: "aarch64",
    TAURI_ENV_FAMILY: "unix",
    TAURI_ENV_TARGET_TRIPLE: "aarch64-apple-darwin",
  };

  it("classifies Tauri dev (PLETHORA_TAURI + TAURI_DEV_HOST) as tauri, not PWA", () => {
    const result = resolveViteBuildTargets(
      { PLETHORA_TAURI: "1", TAURI_DEV_HOST: "127.0.0.1" },
      "development"
    );
    expect(result.runtimeTarget).toBe("tauri");
    expect(result.isTauriBuild).toBe(true);
    expect(result.isPWA).toBe(false);
  });

  it("classifies Tauri 2 production hooks as tauri, not PWA", () => {
    const result = resolveViteBuildTargets(tauriProd, "production");
    expect(result.runtimeTarget).toBe("tauri");
    expect(result.isTauriBuild).toBe(true);
    expect(result.isPWA).toBe(false);
  });

  it("classifies explicit PWA mode as pwa when not Tauri", () => {
    const result = resolveViteBuildTargets({}, "pwa");
    expect(result.runtimeTarget).toBe("pwa");
    expect(result.isPWA).toBe(true);
  });

  it("classifies plain production build as pwa (repository policy)", () => {
    const result = resolveViteBuildTargets({}, "production");
    expect(result.runtimeTarget).toBe("pwa");
    expect(result.isPWA).toBe(true);
  });

  it("classifies development without Tauri as web", () => {
    const result = resolveViteBuildTargets({}, "development");
    expect(result.runtimeTarget).toBe("web");
    expect(result.isPWA).toBe(false);
  });

  it("throws when Tauri production env would become PWA", () => {
    expect(() =>
      resolveViteBuildTargets({ ...tauriProd, PLETHORA_RUNTIME_TARGET: "pwa" }, "production")
    ).toThrow(/Tauri environment cannot use PLETHORA_RUNTIME_TARGET=pwa/);
  });

  it("throws when explicit web override conflicts with Tauri environment", () => {
    expect(() =>
      resolveViteBuildTargets({ ...tauriProd, PLETHORA_RUNTIME_TARGET: "web" }, "production")
    ).toThrow(/cannot use PLETHORA_RUNTIME_TARGET=web/);
  });

  it("throws on explicit pwa mode with Tauri environment", () => {
    expect(() => resolveViteBuildTargets(tauriProd, "pwa")).toThrow(/cannot compile with explicit PWA/);
  });
});
