/**
 * Command Palette entries for application interface zoom (change:
 * desktop-global-interface-zoom).
 *
 * Thin clients of the shared controller, exactly like the Settings control and
 * keyboard shortcuts. Built through the one authoritative command registry;
 * this module never registers a second palette path.
 */

import {
  ArrowsInSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import { CommandCategory, createCommand, type Command } from "./commandModel";
import type { TranslateFn } from "./homeModel";
import {
  formatKeyCombo,
  getShortcutCombo,
} from "../components/common/KeyboardShortcuts";
import { isDesktopInterfaceZoomSupported } from "../lib/interfaceZoom/native";
import {
  resetInterfaceZoom,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "../lib/interfaceZoom/controller";

function activeShortcut(shortcutId: string): string | undefined {
  const combo = getShortcutCombo(shortcutId);
  return combo ? formatKeyCombo(combo) : undefined;
}

export function buildInterfaceZoomCommands(translate: TranslateFn): Command[] {
  if (!isDesktopInterfaceZoomSupported()) return [];
  const t = translate;

  return [
    createCommand({
      id: "interface-zoom-in",
      intentId: "action:interface-zoom-in",
      label: t("commandPalette.interfaceZoomIn"),
      description: t("commandPalette.interfaceZoomInDesc"),
      icon: <MagnifyingGlassPlus className="w-4 h-4" />,
      category: CommandCategory.General,
      keywords: ["zoom", "interface", "ui", "app", "scale", "larger", "bigger"],
      aliases: [
        "interface zoom in",
        "ui zoom in",
        "app zoom in",
        "increase interface size",
      ],
      shortcut: activeShortcut("view.zoom-in"),
      action: () => zoomInterfaceIn(),
    }),
    createCommand({
      id: "interface-zoom-out",
      intentId: "action:interface-zoom-out",
      label: t("commandPalette.interfaceZoomOut"),
      description: t("commandPalette.interfaceZoomOutDesc"),
      icon: <MagnifyingGlassMinus className="w-4 h-4" />,
      category: CommandCategory.General,
      keywords: ["zoom", "interface", "ui", "app", "scale", "smaller"],
      aliases: [
        "interface zoom out",
        "ui zoom out",
        "app zoom out",
        "decrease interface size",
      ],
      shortcut: activeShortcut("view.zoom-out"),
      action: () => zoomInterfaceOut(),
    }),
    createCommand({
      id: "interface-zoom-reset",
      intentId: "action:interface-zoom-reset",
      label: t("commandPalette.interfaceZoomReset"),
      description: t("commandPalette.interfaceZoomResetDesc"),
      icon: <ArrowsInSimple className="w-4 h-4" />,
      category: CommandCategory.General,
      keywords: ["zoom", "interface", "ui", "app", "reset", "100"],
      aliases: ["reset interface zoom", "ui zoom reset", "app zoom reset"],
      shortcut: activeShortcut("view.zoom-reset"),
      action: () => resetInterfaceZoom(),
    }),
  ];
}
