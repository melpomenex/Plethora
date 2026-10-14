import { describe, expect, it, vi } from "vitest";
import {
  handleVolumeRockerNavigation,
  isVolumeRockerNavigationKey,
} from "../volumeRockerNavigation";

function callbacks() {
  return {
    pageUp: vi.fn(),
    pageDown: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
  };
}

describe("handleVolumeRockerNavigation", () => {
  it.each([
    ["VolumeUp", "pageUp"],
    ["PageUp", "pageUp"],
    ["VolumeDown", "pageDown"],
    ["PageDown", "pageDown"],
  ] as const)("maps %s in page mode", (key, callback) => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    const handlers = callbacks();

    expect(handleVolumeRockerNavigation(event, "page", handlers)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers[callback]).toHaveBeenCalledOnce();
  });

  it("uses repeat events for continuous smooth scrolling", () => {
    const event = new KeyboardEvent("keydown", {
      key: "VolumeDown",
      repeat: true,
      cancelable: true,
    });
    const handlers = callbacks();

    handleVolumeRockerNavigation(event, "scroll", handlers);
    expect(handlers.scrollDown).toHaveBeenCalledOnce();
  });

  it("suppresses repeat page turns and leaves disabled keys untouched", () => {
    const repeated = new KeyboardEvent("keydown", { key: "VolumeUp", repeat: true });
    const disabled = new KeyboardEvent("keydown", { key: "VolumeDown", cancelable: true });
    const handlers = callbacks();

    expect(handleVolumeRockerNavigation(repeated, "page", handlers)).toBe(true);
    expect(handlers.pageUp).not.toHaveBeenCalled();
    expect(handleVolumeRockerNavigation(disabled, "none", handlers)).toBe(false);
    expect(disabled.defaultPrevented).toBe(false);
  });

  it.each(
    [
      ["VolumeUp", "page"],
      ["VolumeDown", "page"],
      ["VolumeUp", "scroll"],
      ["VolumeDown", "scroll"],
      ["VolumeUp", "none"],
      ["VolumeDown", "none"],
    ] as const,
  )("leaves %s to the device during media playback in %s mode", (key, mode) => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    const handlers = callbacks();

    expect(
      handleVolumeRockerNavigation(event, mode, handlers, {
        mediaPlaybackActive: true,
      }),
    ).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(handlers.pageUp).not.toHaveBeenCalled();
    expect(handlers.pageDown).not.toHaveBeenCalled();
    expect(handlers.scrollUp).not.toHaveBeenCalled();
    expect(handlers.scrollDown).not.toHaveBeenCalled();
  });

  it("keeps PageUp and PageDown navigation available during media playback", () => {
    const event = new KeyboardEvent("keydown", {
      key: "PageDown",
      cancelable: true,
    });
    const handlers = callbacks();

    expect(
      handleVolumeRockerNavigation(event, "page", handlers, {
        mediaPlaybackActive: true,
      }),
    ).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.pageDown).toHaveBeenCalledOnce();
  });

  it("uses configured rocker navigation when media playback is paused", () => {
    const pageEvent = new KeyboardEvent("keydown", {
      key: "VolumeDown",
      cancelable: true,
    });
    const scrollEvent = new KeyboardEvent("keydown", {
      key: "VolumeDown",
      cancelable: true,
    });
    const pageHandlers = callbacks();
    const scrollHandlers = callbacks();

    handleVolumeRockerNavigation(pageEvent, "page", pageHandlers, {
      mediaPlaybackActive: false,
    });
    handleVolumeRockerNavigation(scrollEvent, "scroll", scrollHandlers, {
      mediaPlaybackActive: false,
    });

    expect(pageEvent.defaultPrevented).toBe(true);
    expect(pageHandlers.pageDown).toHaveBeenCalledOnce();
    expect(scrollEvent.defaultPrevented).toBe(true);
    expect(scrollHandlers.scrollDown).toHaveBeenCalledOnce();
  });

  it("identifies hardware and configured e-ink rocker keys", () => {
    expect(isVolumeRockerNavigationKey("VolumeUp", "none")).toBe(true);
    expect(isVolumeRockerNavigationKey("VolumeDown", "scroll")).toBe(true);
    expect(isVolumeRockerNavigationKey("PageDown", "scroll")).toBe(true);
    expect(isVolumeRockerNavigationKey("PageUp", "none")).toBe(false);
  });

  it("scrolls without changing an independently managed overlay state", () => {
    let overlayVisible = false;
    let scrollTop = 0;
    const event = new KeyboardEvent("keydown", { key: "VolumeDown", cancelable: true });

    handleVolumeRockerNavigation(event, "scroll", {
      pageUp: vi.fn(),
      pageDown: vi.fn(),
      scrollUp: () => { scrollTop -= 120; },
      scrollDown: () => { scrollTop += 120; },
    });

    expect(scrollTop).toBe(120);
    expect(overlayVisible).toBe(false);
    overlayVisible = true;
    handleVolumeRockerNavigation(event, "scroll", {
      pageUp: vi.fn(),
      pageDown: vi.fn(),
      scrollUp: vi.fn(),
      scrollDown: () => { scrollTop += 120; },
    });
    expect(overlayVisible).toBe(true);
  });
});
