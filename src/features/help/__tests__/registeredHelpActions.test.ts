/**
 * Unit tests for Registered Help Actions (registeredHelpActions.ts)
 */

import { describe, it, expect, vi } from "vitest";
import {
  REGISTERED_HELP_ACTIONS,
  isRegisteredHelpAction,
  dispatchRegisteredHelpAction,
  type RegisteredHelpActionId,
} from "../registeredHelpActions";

describe("registeredHelpActions", () => {
  it("contains all core UI action keys across views, settings, and algorithms", () => {
    expect(REGISTERED_HELP_ACTIONS["action.view.dashboard"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["action.view.queue"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["action.view.review"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["settings.appearance.eink"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["settings.learning.algorithm"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["action.reader.toggle_tts"]).toBeDefined();
    expect(REGISTERED_HELP_ACTIONS["action.review.zen"]).toBeDefined();
  });

  it("validates registered action IDs correctly", () => {
    expect(isRegisteredHelpAction("action.view.dashboard")).toBe(true);
    expect(isRegisteredHelpAction("settings.appearance.themes")).toBe(true);
    expect(isRegisteredHelpAction("nonexistent.invalid.action")).toBe(false);
  });

  it("dispatches window custom events for navigation actions", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const ok = dispatchRegisteredHelpAction("action.view.queue");
    expect(ok).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "navigate",
        detail: "/queue",
      })
    );

    dispatchSpy.mockRestore();
  });

  it("dispatches window custom events for contextual palette actions", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const ok = dispatchRegisteredHelpAction("action.reader.reflow_toggle");
    expect(ok).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "palette-action",
        detail: {
          view: "document-viewer",
          actionId: "doc.reflow_toggle",
        },
      })
    );

    dispatchSpy.mockRestore();
  });

  it("returns false and logs warning for unregistered action IDs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ok = dispatchRegisteredHelpAction("fake.unregistered.id" as RegisteredHelpActionId);
    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
