/**
 * Interface-zoom shortcut dispatcher (change: desktop-global-interface-zoom).
 *
 * One capture-phase owner for the reserved primary-modifier chords. The pure
 * matcher is separated from the store lookup so every platform/key variant can
 * be tested without a DOM listener. `handleInterfaceZoomKeyDown` is the only
 * place that prevents the event and invokes the controller.
 */

import {
  eventMatchesCombo,
  useShortcutStore,
  type KeyCombo,
} from "../../components/common/KeyboardShortcuts";
import { useUIStore } from "../../stores/uiStore";
import { isDesktopInterfaceZoomSupported } from "./native";
import {
  resetInterfaceZoom,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "./controller";

export type InterfaceZoomCommand = "in" | "out" | "reset";

type MatchEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "target"
  | "isComposing"
  | "defaultPrevented"
>;

type ShortcutCombos = {
  in: KeyCombo | null;
  out: KeyCombo | null;
  reset: KeyCombo | null;
};

type MatchOptions = {
  isMac: boolean;
  paletteOpen: boolean;
};

const COMMANDS: readonly InterfaceZoomCommand[] = ["in", "out", "reset"];

const SHORTCUT_IDS: Record<InterfaceZoomCommand, string> = {
  in: "view.zoom-in",
  out: "view.zoom-out",
  reset: "view.zoom-reset",
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}

/** A custom combo is only "safe in text fields" when it uses Ctrl/Meta. */
function usesPlatformPrimary(combo: KeyCombo, isMac: boolean): boolean {
  return isMac ? combo.meta === true : combo.ctrl === true;
}

function matchesDefaultChord(event: MatchEvent, command: InterfaceZoomCommand): boolean {
  switch (command) {
    case "in":
      // `+`, `=` (bare or with Shift), and the numeric keypad's Add key.
      return event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
    case "out":
      return event.key === "-" || event.key === "_" || event.code === "NumpadSubtract";
    case "reset":
      // Numeric-keypad 0 with NumLock on reports "0"; with NumLock off it is
      // "Insert", which must not be stolen as a reset chord.
      return event.key === "0" && !event.shiftKey;
    default:
      return false;
  }
}

export function matchInterfaceZoomShortcut(
  event: MatchEvent,
  combos: ShortcutCombos,
  options: MatchOptions,
): InterfaceZoomCommand | null {
  if (event.isComposing || event.defaultPrevented) return null;

  const { isMac, paletteOpen } = options;
  const editable = isEditableTarget(event.target);

  // A customized binding replaces its default chord entirely; the old default
  // must not also fire. Non-primary custom bindings stay inert in text fields
  // and while the Command Palette is open so typing is never stolen.
  for (const command of COMMANDS) {
    const combo = combos[command];
    if (!combo) continue;
    if (!eventMatchesCombo(event as KeyboardEvent, combo)) continue;
    if (!usesPlatformPrimary(combo, isMac) && (editable || paletteOpen)) continue;
    return command;
  }

  // Defaults require the platform primary modifier and reject Alt as well as
  // the non-platform primary (Ctrl on macOS, Meta on Linux/Windows).
  const platformPrimary = isMac ? event.metaKey : event.ctrlKey;
  const foreignPrimary = isMac ? event.ctrlKey : event.metaKey;
  if (!platformPrimary || foreignPrimary || event.altKey) return null;

  for (const command of COMMANDS) {
    if (!combos[command] && matchesDefaultChord(event, command)) return command;
  }
  return null;
}

function currentCustomCombo(id: string): KeyCombo | null {
  const shortcut = useShortcutStore
    .getState()
    .shortcuts.find((candidate) => candidate.id === id);
  return shortcut?.currentCombo ?? null;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
}

/**
 * Capture-phase keydown handler for the application shell and same-origin
 * document iframes. Returns true when the event was claimed.
 */
export function handleInterfaceZoomKeyDown(event: KeyboardEvent): boolean {
  // Unsupported runtimes stay inert: never intercept the platform's own
  // browser zoom chords.
  if (!isDesktopInterfaceZoomSupported()) return false;

  const command = matchInterfaceZoomShortcut(
    event,
    {
      in: currentCustomCombo(SHORTCUT_IDS.in),
      out: currentCustomCombo(SHORTCUT_IDS.out),
      reset: currentCustomCombo(SHORTCUT_IDS.reset),
    },
    {
      isMac: isMacPlatform(),
      paletteOpen: useUIStore.getState().commandPaletteOpen,
    },
  );
  if (!command) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (command === "in") zoomInterfaceIn();
  else if (command === "out") zoomInterfaceOut();
  else resetInterfaceZoom();
  return true;
}
