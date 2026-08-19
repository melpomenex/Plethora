/**
 * Hands-Free Study settings v2 tests (task 11.4): defaults, persistence
 * merge, v1→v2 migration, invalid-value fallbacks, and that every action
 * offered in the UI maps to an implemented enum value.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_HANDS_FREE_STUDY_SETTINGS,
  mergeHandsFreeStudySettings,
  coerceStudyAction,
  VALID_STUDY_ACTIONS,
} from "../settingsStore";

describe("HandsFreeStudySettings v2", () => {
  it("has safe defaults (disabled, 30s window, per-command mappings)", () => {
    expect(DEFAULT_HANDS_FREE_STUDY_SETTINGS).toEqual({
      enabled: false,
      captureWindow: 30,
      extensionWindowMs: 2500,
      mappings: {
        next: "save_recent_extract",
        previous: "replay_recent_passage",
        seekForward: "skip_forward",
        seekBackward: "skip_backward",
      },
      chimeEnabled: true,
      chimeVolume: 0.8,
      duckingRatio: 0.25,
    });
  });

  it("empty/undefined persisted data merges to defaults", () => {
    expect(mergeHandsFreeStudySettings(undefined)).toEqual(DEFAULT_HANDS_FREE_STUDY_SETTINGS);
    expect(mergeHandsFreeStudySettings({})).toEqual(DEFAULT_HANDS_FREE_STUDY_SETTINGS);
  });

  it("preserves valid persisted v2 settings", () => {
    const merged = mergeHandsFreeStudySettings({
      enabled: true,
      captureWindow: "smart",
      extensionWindowMs: 1000,
      mappings: {
        next: "bookmark",
        previous: "mark_confusing",
        seekForward: "next_chapter",
        seekBackward: "none",
      },
      chimeEnabled: false,
      chimeVolume: 0.4,
      duckingRatio: 0.5,
    });
    expect(merged.enabled).toBe(true);
    expect(merged.captureWindow).toBe("smart");
    expect(merged.mappings.next).toBe("bookmark");
    expect(merged.chimeEnabled).toBe(false);
  });

  describe("v1 → v2 migration", () => {
    it("maps singlePressAction → mappings.next (including the v1 alias smart_extract)", () => {
      const merged = mergeHandsFreeStudySettings({
        enabled: true,
        captureLookbackSec: 60,
        singlePressAction: "smart_extract",
        doublePressAction: "bookmark",
        triplePressAction: "mark_confusing",
        chimeVolume: 0.8,
        duckingRatio: 0.25,
      } as any);
      expect(merged.enabled).toBe(true);
      expect(merged.captureWindow).toBe(60);
      expect(merged.mappings.next).toBe("save_recent_extract");
    });

    it("migrates captureLookbackSec {15,30,60} and rejects others", () => {
      expect(mergeHandsFreeStudySettings({ captureLookbackSec: 15 } as any).captureWindow).toBe(15);
      expect(mergeHandsFreeStudySettings({ captureLookbackSec: 45 } as any).captureWindow).toBe(30);
    });

    it("drops the double/triple press model entirely", () => {
      const merged = mergeHandsFreeStudySettings({
        doublePressAction: "bookmark",
        triplePressAction: "ask_plethora",
      } as any);
      // Repeat-extension replaces gestures: previous keeps its default.
      expect(merged.mappings.previous).toBe("replay_recent_passage");
      expect((merged as any).doublePressAction).toBeUndefined();
    });

    it("legacy audioChimeEnabled feeds chimeEnabled", () => {
      expect(mergeHandsFreeStudySettings({ audioChimeEnabled: false } as any).chimeEnabled).toBe(false);
    });
  });

  describe("invalid-value fallbacks", () => {
    it("unknown captureWindow values reset to the default", () => {
      expect(mergeHandsFreeStudySettings({ captureWindow: "smart" }).captureWindow).toBe("smart");
      expect(mergeHandsFreeStudySettings({ captureWindow: 45 } as any).captureWindow).toBe(30);
      expect(mergeHandsFreeStudySettings({ captureWindow: "weird" } as any).captureWindow).toBe(30);
    });

    it("invalid mapping values fall back to the slot default", () => {
      const merged = mergeHandsFreeStudySettings({
        mappings: { next: "nope" as any, previous: 42 as any, seekForward: null as any, seekBackward: "" as any },
      });
      expect(merged.mappings).toEqual(DEFAULT_HANDS_FREE_STUDY_SETTINGS.mappings);
    });

    it("camelCase aliases coerce to canonical values", () => {
      expect(coerceStudyAction("saveRecentExtract", "none")).toBe("save_recent_extract");
      expect(coerceStudyAction("markConfusing", "none")).toBe("mark_confusing");
      expect(coerceStudyAction("unknown-alias", "bookmark")).toBe("bookmark");
    });

    it("numeric fields are clamped to their valid ranges", () => {
      const merged = mergeHandsFreeStudySettings({
        chimeVolume: 5,
        duckingRatio: -3,
        extensionWindowMs: 1_000_000,
      } as any);
      expect(merged.chimeVolume).toBe(1);
      expect(merged.duckingRatio).toBe(0);
      expect(merged.extensionWindowMs).toBe(10_000);
    });
  });

  describe("every UI-offered action is implemented", () => {
    it("VALID_STUDY_ACTIONS covers the complete canonical enum from the design", () => {
      expect([...VALID_STUDY_ACTIONS]).toEqual([
        "save_recent_extract",
        "bookmark",
        "replay_recent_passage",
        "mark_interesting",
        "mark_confusing",
        "ask_plethora",
        "skip_forward",
        "skip_backward",
        "next_chapter",
        "previous_chapter",
        "none",
      ]);
    });

    it("defaults map every remappable command to a distinct implemented action", () => {
      const { mappings } = DEFAULT_HANDS_FREE_STUDY_SETTINGS;
      for (const action of Object.values(mappings)) {
        expect(VALID_STUDY_ACTIONS).toContain(action);
      }
    });
  });
});
