import { describe, expect, it, vi } from "vitest";
import { handleVolumeRockerNavigation } from "../volumeRockerNavigation";

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
});

