import { afterEach, describe, expect, it } from "vitest";
import {
  combosEqual,
  eventMatchesCombo,
  findConflicts,
  formatKeyCombo,
  type KeyCombo,
  type ShortcutAction,
  ShortcutCategory,
} from "../KeyboardShortcuts";

const originalPlatform = navigator.platform;

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  });
}

describe("eventMatchesCombo", () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("matches primary-modifier shortcuts with Ctrl on Linux and Windows", () => {
    const combo: KeyCombo = { key: "k", ctrl: true, meta: true };

    setPlatform("Linux x86_64");
    expect(eventMatchesCombo(keydown({ key: "k", ctrlKey: true }), combo)).toBe(true);
    expect(eventMatchesCombo(keydown({ key: "k", metaKey: true }), combo)).toBe(false);

    setPlatform("Win32");
    expect(eventMatchesCombo(keydown({ key: "K", ctrlKey: true }), combo)).toBe(true);
    expect(eventMatchesCombo(keydown({ key: "k", metaKey: true }), combo)).toBe(false);
  });

  it("matches primary-modifier shortcuts with Meta on macOS", () => {
    const combo: KeyCombo = { key: "k", ctrl: true, meta: true };

    setPlatform("MacIntel");
    expect(eventMatchesCombo(keydown({ key: "k", metaKey: true }), combo)).toBe(true);
    expect(eventMatchesCombo(keydown({ key: "k", ctrlKey: true }), combo)).toBe(false);
  });

  it("rejects wrong keys and extra modifiers", () => {
    const combo: KeyCombo = { key: "k", ctrl: true, meta: true };

    setPlatform("Linux x86_64");
    expect(eventMatchesCombo(keydown({ key: "p", ctrlKey: true }), combo)).toBe(false);
    expect(eventMatchesCombo(keydown({ key: "k", ctrlKey: true, altKey: true }), combo)).toBe(false);
  });
});

describe("formatKeyCombo", () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("renders the equals key as a browser-like plus on Linux/Windows", () => {
    setPlatform("Linux x86_64");
    expect(formatKeyCombo({ key: "=", ctrl: true, meta: true })).toBe("Ctrl++");
    setPlatform("Win32");
    expect(formatKeyCombo({ key: "=", ctrl: true, meta: true })).toBe("Ctrl++");
  });

  it("renders the equals key as a plus on macOS", () => {
    setPlatform("MacIntel");
    expect(formatKeyCombo({ key: "=", ctrl: true, meta: true })).toBe("⌘+");
  });

  it("keeps minus and zero readable", () => {
    setPlatform("Linux x86_64");
    expect(formatKeyCombo({ key: "-", ctrl: true, meta: true })).toBe("Ctrl+-");
    expect(formatKeyCombo({ key: "0", ctrl: true, meta: true })).toBe("Ctrl+0");
  });
});

describe("shortcut conflict helpers", () => {
  it("compares key combos case-insensitively", () => {
    expect(
      combosEqual(
        { key: "K", ctrl: true, meta: true },
        { key: "k", ctrl: true, meta: true }
      )
    ).toBe(true);
  });

  it("finds conflicts against default and customized shortcut combos", () => {
    const shortcuts: ShortcutAction[] = [
      {
        id: "nav.command-palette",
        name: "Open Command Palette",
        description: "Quickly access commands",
        category: ShortcutCategory.Navigation,
        defaultCombo: { key: "k", ctrl: true, meta: true },
      },
      {
        id: "doc.import",
        name: "Import Document",
        description: "Import a document",
        category: ShortcutCategory.Documents,
        defaultCombo: { key: "o", ctrl: true, meta: true },
        currentCombo: { key: "k", ctrl: true, meta: true },
      },
    ];

    expect(findConflicts({ key: "k", ctrl: true, meta: true }, "nav.command-palette", shortcuts))
      .toHaveLength(1);
  });
});
