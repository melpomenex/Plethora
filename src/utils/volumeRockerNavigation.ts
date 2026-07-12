import type { VolumeRockerMode } from "../stores/settingsStore";

type VolumeNavigationCallbacks = {
  pageUp: () => void;
  pageDown: () => void;
  scrollUp: () => void;
  scrollDown: () => void;
};

export function isVolumeRockerNavigationKey(key: string, mode: VolumeRockerMode): boolean {
  if (key === "VolumeUp" || key === "VolumeDown") return true;
  return mode !== "none" && (key === "PageUp" || key === "PageDown");
}

/** Handle both Android volume keys and e-ink firmware page-key remappings. */
export function handleVolumeRockerNavigation(
  event: KeyboardEvent,
  mode: VolumeRockerMode,
  callbacks: VolumeNavigationCallbacks,
): boolean {
  const up = event.key === "VolumeUp" || event.key === "PageUp";
  const down = event.key === "VolumeDown" || event.key === "PageDown";
  if ((!up && !down) || mode === "none") return false;

  event.preventDefault();
  event.stopPropagation();

  if (mode === "page") {
    if (!event.repeat) (up ? callbacks.pageUp : callbacks.pageDown)();
  } else {
    (up ? callbacks.scrollUp : callbacks.scrollDown)();
  }
  return true;
}
