/**
 * Study Mode Quick Toggle (design Decision 7 / spec: discoverability)
 *
 * Persistent setting, togglable from the audio player, with a visible
 * indicator while active and distinct enable/disable earcons so users can
 * never unknowingly lose normal navigation controls.
 */

import { Bookmark, SpeakerSlash, Waveform } from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { playChime } from "../../utils/audioFeedback";
import { cn } from "../../utils";

export function StudyModeToggle({
  variant = "chip",
  className,
}: {
  variant?: "chip" | "icon";
  className?: string;
}) {
  // Defensive optional access: some tests construct partial settings states.
  const enabled = useSettingsStore((s) => s.settings.handsFreeStudy?.enabled ?? false);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);

  const toggle = () => {
    const next = !enabled;
    updateSettingsCategory("handsFreeStudy", { enabled: next });
    playChime(next ? "mode_study" : "mode_normal");
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={enabled ? "Disable Hands-Free Study Mode" : "Enable Hands-Free Study Mode"}
        aria-pressed={enabled}
        title={enabled ? "Study Mode active — headphone commands capture" : "Study Mode off"}
        className={cn(
          "rounded-lg p-1.5 transition-colors",
          enabled
            ? "bg-primary/15 text-primary ring-1 ring-primary/40"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
          className
        )}
      >
        {enabled ? <Waveform size={16} weight="bold" /> : <SpeakerSlash size={16} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={enabled ? "Disable Hands-Free Study Mode" : "Enable Hands-Free Study Mode"}
      aria-pressed={enabled}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
        enabled
          ? "bg-primary/15 text-primary ring-1 ring-primary/40"
          : "bg-muted/60 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {enabled ? <Waveform size={12} weight="bold" /> : <Bookmark size={12} />}
      <span>{enabled ? "Study Mode" : "Normal Mode"}</span>
    </button>
  );
}
