import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSavedDisplayMode,
  saveDisplayMode,
  loadSavedEinkSettings,
  saveEinkSettings,
  resolveEffectiveEinkMode,
  detectEinkCapabilities,
  resetEinkCapabilitiesCache,
  DEFAULT_EINK_SETTINGS,
} from "../displayMode";

describe("displayMode utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEinkCapabilitiesCache();
    vi.restoreAllMocks();
  });

  describe("persistence", () => {
    it("loads default 'standard' mode when empty", () => {
      expect(loadSavedDisplayMode()).toBe("standard");
    });

    it("saves and loads custom display modes", () => {
      saveDisplayMode("eink");
      expect(loadSavedDisplayMode()).toBe("eink");

      saveDisplayMode("auto");
      expect(loadSavedDisplayMode()).toBe("auto");

      saveDisplayMode("standard");
      expect(loadSavedDisplayMode()).toBe("standard");
    });

    it("saves and merges partial EinkSettings", () => {
      const initial = loadSavedEinkSettings();
      expect(initial.preferPaginated).toBe(true);

      saveEinkSettings({ preferPaginated: false, invertVolumeKeys: true });
      const updated = loadSavedEinkSettings();
      expect(updated.preferPaginated).toBe(false);
      expect(updated.invertVolumeKeys).toBe(true);
      expect(updated.tapZones).toBe(true); // default preserved
    });
  });

  describe("effective E-Ink mode resolution", () => {
    it("resolves explicitly configured 'eink' to true", () => {
      expect(resolveEffectiveEinkMode("eink")).toBe(true);
    });

    it("resolves explicitly configured 'standard' to false", () => {
      expect(resolveEffectiveEinkMode("standard")).toBe(false);
    });

    it("resolves 'auto' based on hardware capabilities", () => {
      // Mock navigator userAgent for BOOX device
      const originalUA = navigator.userAgent;
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Linux; U; Android 11; BOOX Palma Build/RQ3A.210905.001)",
        configurable: true,
      });
      resetEinkCapabilitiesCache();

      const caps = detectEinkCapabilities();
      expect(caps.isEinkDevice).toBe(true);
      expect(caps.detectedManufacturer).toBe("BOOX");
      expect(resolveEffectiveEinkMode("auto")).toBe(true);

      // Restore UA
      Object.defineProperty(navigator, "userAgent", {
        value: originalUA,
        configurable: true,
      });
      resetEinkCapabilitiesCache();
    });
  });
});
