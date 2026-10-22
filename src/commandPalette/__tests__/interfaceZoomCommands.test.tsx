import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeSupport = vi.hoisted(() => ({ value: true }));

vi.mock("../../lib/interfaceZoom/native", () => ({
  isDesktopInterfaceZoomSupported: () => nativeSupport.value,
  applyNativeInterfaceZoom: async () => {},
}));

vi.mock("../../lib/interfaceZoom/controller", () => ({
  zoomInterfaceIn: vi.fn(),
  zoomInterfaceOut: vi.fn(),
  resetInterfaceZoom: vi.fn(),
}));

import { buildInterfaceZoomCommands } from "../interfaceZoomCommands";
import type { TranslateFn } from "../homeModel";
import { en } from "../../lib/i18n/locales/en";
import { useShortcutStore } from "../../components/common/KeyboardShortcuts";
import {
  resetInterfaceZoom,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "../../lib/interfaceZoom/controller";

const translate: TranslateFn = (key: string) => en[key] ?? key;

beforeEach(() => {
  nativeSupport.value = true;
  useShortcutStore.getState().resetAll();
  vi.mocked(zoomInterfaceIn).mockReset();
  vi.mocked(zoomInterfaceOut).mockReset();
  vi.mocked(resetInterfaceZoom).mockReset();
});

describe("buildInterfaceZoomCommands", () => {
  it("returns three unique application commands on desktop", () => {
    const commands = buildInterfaceZoomCommands(translate);

    expect(commands).toHaveLength(3);
    expect(new Set(commands.map((command) => command.id)).size).toBe(3);
    expect(commands.map((command) => command.id)).toEqual([
      "interface-zoom-in",
      "interface-zoom-out",
      "interface-zoom-reset",
    ]);
  });

  it("uses the localized labels, descriptions, keywords, and aliases", () => {
    const [zoomIn, zoomOut, zoomReset] = buildInterfaceZoomCommands(translate);

    expect(zoomIn.label).toBe("Zoom In");
    expect(zoomIn.description).toBe("Increase the whole interface scale");
    expect(zoomIn.keywords).toContain("interface");
    expect(zoomIn.aliases).toContain("interface zoom in");

    expect(zoomOut.label).toBe("Zoom Out");
    expect(zoomOut.aliases).toContain("app zoom out");

    expect(zoomReset.label).toBe("Reset Zoom");
    expect(zoomReset.aliases).toContain("reset interface zoom");
  });

  it("routes each action through the shared controller", () => {
    const [zoomIn, zoomOut, zoomReset] = buildInterfaceZoomCommands(translate);

    zoomIn.action();
    expect(zoomInterfaceIn).toHaveBeenCalledTimes(1);
    zoomOut.action();
    expect(zoomInterfaceOut).toHaveBeenCalledTimes(1);
    zoomReset.action();
    expect(resetInterfaceZoom).toHaveBeenCalledTimes(1);
  });

  it("shows the active shortcut combo", () => {
    const commands = buildInterfaceZoomCommands(translate);
    expect(commands[0].shortcut).toBe("Ctrl++");
    expect(commands[1].shortcut).toBe("Ctrl+-");
    expect(commands[2].shortcut).toBe("Ctrl+0");
  });

  it("returns no commands on browser, mobile, or old macOS", () => {
    nativeSupport.value = false;
    expect(buildInterfaceZoomCommands(translate)).toEqual([]);
  });
});
