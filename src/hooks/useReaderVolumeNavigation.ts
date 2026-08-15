/**
 * Unified hook for reader hardware volume key and page button navigation.
 *
 * Implements requirement: Hardware Volume Button Page Navigation with
 * media-playback safety and clean unmount cleanup.
 */

import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { loadSavedEinkSettings } from "../lib/displayMode";
import { useIsEink } from "../contexts/PresentationContext";

export interface VolumeNavigationActions {
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onScrollDown?: () => void;
  onScrollUp?: () => void;
  disabled?: boolean;
}

/**
 * Checks whether audio, podcast, or TTS media is currently playing.
 */
function isMediaPlaying(): boolean {
  if (typeof document === "undefined") return false;
  const mediaElements = Array.from(
    document.querySelectorAll<HTMLMediaElement>("audio, video")
  );
  return mediaElements.some((el) => !el.paused && !el.ended && el.readyState > 2);
}

export function useReaderVolumeNavigation(actions: VolumeNavigationActions) {
  const isEink = useIsEink();
  const volumeRockerScroll = useSettingsStore(
    (s) => s.settings.interface.volumeRockerScroll
  );
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (actions.disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const isVolumeUp = e.key === "VolumeUp" || e.key === "PageUp";
      const isVolumeDown = e.key === "VolumeDown" || e.key === "PageDown";

      if (!isVolumeUp && !isVolumeDown) {
        return;
      }

      // Check if media playback is actively consuming volume buttons
      if (isMediaPlaying()) {
        return;
      }

      const einkSettings = loadSavedEinkSettings();
      const mode = volumeRockerScroll || "none";
      const isEinkActive = isEink && einkSettings.volumeTurnPages;

      if (mode === "none" && !isEinkActive) {
        return;
      }

      // Prevent system volume dialog and consume event
      e.preventDefault();
      e.stopPropagation();

      if (e.repeat) return;

      const invert = isEink && einkSettings.invertVolumeKeys;
      const isNext = invert ? isVolumeUp : isVolumeDown;

      const act = actionsRef.current;
      if (mode === "scroll" && !isEinkActive) {
        if (isNext) {
          act.onScrollDown?.() ?? act.onNextPage?.();
        } else {
          act.onScrollUp?.() ?? act.onPrevPage?.();
        }
      } else {
        // Page mode
        if (isNext) {
          act.onNextPage?.();
        } else {
          act.onPrevPage?.();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isEink, volumeRockerScroll, actions.disabled]);
}
