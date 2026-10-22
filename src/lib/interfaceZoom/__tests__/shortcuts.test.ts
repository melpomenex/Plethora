import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  zoomInterfaceIn: vi.fn(),
  zoomInterfaceOut: vi.fn(),
  resetInterfaceZoom: vi.fn(),
}));

const nativeSupport = vi.hoisted(() => ({ value: true }));

vi.mock("../controller", () => ({
  zoomInterfaceIn: actions.zoomInterfaceIn,
  zoomInterfaceOut: actions.zoomInterfaceOut,
  resetInterfaceZoom: actions.resetInterfaceZoom,
}));

vi.mock("../native", () => ({
  isDesktopInterfaceZoomSupported: () => nativeSupport.value,
}));

import {
  handleInterfaceZoomKeyDown,
  matchInterfaceZoomShortcut,
  type InterfaceZoomCommand,
} from "../shortcuts";
import { useShortcutStore } from "../../../components/common/KeyboardShortcuts";
import { useUIStore } from "../../../stores/uiStore";

const NO_COMBOS = { in: null, out: null, reset: null };
const LINUX = { isMac: false, paletteOpen: false };
const MAC = { isMac: true, paletteOpen: false };

type MatchEvent = Parameters<typeof matchInterfaceZoomShortcut>[0];

function event(init: Partial<MatchEvent>): MatchEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    isComposing: false,
    defaultPrevented: false,
    ...init,
  };
}

function match(
  init: Partial<MatchEvent>,
  options = LINUX,
  combos = NO_COMBOS,
): InterfaceZoomCommand | null {
  return matchInterfaceZoomShortcut(event(init), combos, options);
}

const originalPlatform = navigator.platform;
function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
}

beforeEach(() => {
  actions.zoomInterfaceIn.mockReset();
  actions.zoomInterfaceOut.mockReset();
  actions.resetInterfaceZoom.mockReset();
  nativeSupport.value = true;
  useShortcutStore.getState().resetAll();
  useUIStore.getState().setCommandPaletteOpen(false);
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("matchInterfaceZoomShortcut", () => {
  it("matches every default zoom-in variant with the Linux/Windows primary modifier", () => {
    expect(match({ key: "=", ctrlKey: true })).toBe("in");
    expect(match({ key: "+", ctrlKey: true })).toBe("in");
    expect(match({ key: "=", ctrlKey: true, shiftKey: true })).toBe("in");
    expect(match({ key: "+", ctrlKey: true, shiftKey: true })).toBe("in");
    expect(match({ key: "+", code: "NumpadAdd", ctrlKey: true })).toBe("in");
  });

  it("matches every default zoom-out variant", () => {
    expect(match({ key: "-", ctrlKey: true })).toBe("out");
    expect(match({ key: "_", ctrlKey: true, shiftKey: true })).toBe("out");
    expect(match({ key: "-", code: "NumpadSubtract", ctrlKey: true })).toBe("out");
  });

  it("matches reset only for unshifted zero", () => {
    expect(match({ key: "0", ctrlKey: true })).toBe("reset");
    expect(match({ key: "0", code: "Numpad0", ctrlKey: true })).toBe("reset");
    expect(match({ key: "0", ctrlKey: true, shiftKey: true })).toBeNull();
  });

  it("does not steal Ctrl+Insert (NumLock-off numeric keypad zero)", () => {
    expect(match({ key: "Insert", code: "Numpad0", ctrlKey: true })).toBeNull();
  });

  it("uses Cmd on macOS and rejects the non-platform Ctrl", () => {
    expect(match({ key: "=", metaKey: true }, MAC)).toBe("in");
    expect(match({ key: "=", ctrlKey: true }, MAC)).toBeNull();
    expect(match({ key: "=", ctrlKey: true, metaKey: true }, MAC)).toBeNull();
  });

  it("rejects Meta on Linux/Windows", () => {
    expect(match({ key: "=", metaKey: true }, LINUX)).toBeNull();
    expect(match({ key: "=", ctrlKey: true, metaKey: true }, LINUX)).toBeNull();
  });

  it("rejects Alt and missing primary modifiers", () => {
    expect(match({ key: "=", ctrlKey: true, altKey: true })).toBeNull();
    expect(match({ key: "=" })).toBeNull();
    expect(match({ key: "-" })).toBeNull();
    expect(match({ key: "0" })).toBeNull();
  });

  it("ignores composing events and already-handled events", () => {
    expect(match({ key: "=", ctrlKey: true, isComposing: true })).toBeNull();
    expect(match({ key: "=", ctrlKey: true, defaultPrevented: true })).toBeNull();
  });

  it("allows default primary chords while a text field is focused", () => {
    const input = document.createElement("input");
    expect(match({ key: "=", ctrlKey: true, target: input })).toBe("in");
  });

  it("allows default primary chords while the Command Palette is open", () => {
    expect(match({ key: "=", ctrlKey: true }, { isMac: false, paletteOpen: true })).toBe("in");
  });
});

describe("custom interface-zoom bindings", () => {
  it("honors a custom primary binding and stops the default from firing", () => {
    const combos = { in: { key: "k", ctrl: true, meta: true }, out: null, reset: null };
    setPlatform("Linux x86_64");
    expect(match({ key: "k", ctrlKey: true }, LINUX, combos)).toBe("in");
    expect(match({ key: "=", ctrlKey: true }, LINUX, combos)).toBeNull();
  });

  it("uses Meta for a primary custom binding on macOS", () => {
    const combos = { in: { key: "k", ctrl: true, meta: true }, out: null, reset: null };
    setPlatform("MacIntel");
    expect(match({ key: "k", metaKey: true }, MAC, combos)).toBe("in");
  });

  it("suppresses a custom non-primary binding in text fields and the palette", () => {
    const combos = { in: { key: "k" }, out: null, reset: null };
    const input = document.createElement("input");
    setPlatform("Linux x86_64");
    expect(match({ key: "k", target: input }, LINUX, combos)).toBeNull();
    expect(match({ key: "k" }, { isMac: false, paletteOpen: true }, combos)).toBeNull();
    expect(match({ key: "k" }, LINUX, combos)).toBe("in");
  });
});

describe("handleInterfaceZoomKeyDown", () => {
  it("prevents the event and runs exactly one controller action", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const keydown = new KeyboardEvent("keydown", { key: "=", ctrlKey: true });
    Object.assign(keydown, { preventDefault, stopPropagation, stopImmediatePropagation });

    expect(handleInterfaceZoomKeyDown(keydown)).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(actions.zoomInterfaceIn).toHaveBeenCalledTimes(1);
    expect(actions.zoomInterfaceOut).not.toHaveBeenCalled();
    expect(actions.resetInterfaceZoom).not.toHaveBeenCalled();
  });

  it("routes minus and zero to their actions", () => {
    expect(
      handleInterfaceZoomKeyDown(new KeyboardEvent("keydown", { key: "-", ctrlKey: true })),
    ).toBe(true);
    expect(actions.zoomInterfaceOut).toHaveBeenCalledTimes(1);

    expect(
      handleInterfaceZoomKeyDown(new KeyboardEvent("keydown", { key: "0", ctrlKey: true })),
    ).toBe(true);
    expect(actions.resetInterfaceZoom).toHaveBeenCalledTimes(1);
  });

  it("returns false and does not prevent an unrelated key", () => {
    const preventDefault = vi.fn();
    const keydown = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
    Object.assign(keydown, { preventDefault });
    expect(handleInterfaceZoomKeyDown(keydown)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(actions.zoomInterfaceIn).not.toHaveBeenCalled();
  });

  it("never preventDefaults browser zoom when the runtime is unsupported", () => {
    nativeSupport.value = false;
    const preventDefault = vi.fn();
    const keydown = new KeyboardEvent("keydown", { key: "=", ctrlKey: true });
    Object.assign(keydown, { preventDefault });

    expect(handleInterfaceZoomKeyDown(keydown)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(actions.zoomInterfaceIn).not.toHaveBeenCalled();
  });

  it("honors a rebound shortcut from the shortcut store", () => {
    useShortcutStore.getState().updateShortcut("view.zoom-in", {
      key: "k",
      ctrl: true,
      meta: true,
    });
    setPlatform("Linux x86_64");

    expect(
      handleInterfaceZoomKeyDown(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })),
    ).toBe(true);
    expect(actions.zoomInterfaceIn).toHaveBeenCalledTimes(1);

    expect(
      handleInterfaceZoomKeyDown(new KeyboardEvent("keydown", { key: "=", ctrlKey: true })),
    ).toBe(false);
  });
});
