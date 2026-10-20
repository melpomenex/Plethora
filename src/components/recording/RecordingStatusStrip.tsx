import { useEffect, useState } from "react";
import { ArrowUpRight, WarningCircle } from "@phosphor-icons/react";
import { useRecordingSessionStore } from "../../stores/recordingSessionStore";
import { useUIStore } from "../../stores/uiStore";
import { formatDurationMs } from "./ActiveRecording";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";

export function RecordingStatusStrip() {
  const { t } = useI18n();
  const recordingStore = useRecordingSessionStore();
  const state = recordingStore.state;
  const health = recordingStore.health;
  const activeRecordingOpen = useUIStore((s) => s.activeRecordingOpen);
  const setActiveRecordingOpen = useUIStore((s) => s.setActiveRecordingOpen);

  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (state === "recording") {
      const interval = setInterval(() => {
        setElapsedMs((prev) => prev + 1000);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [state]);

  useEffect(() => {
    if (health?.acknowledgedMs && health.acknowledgedMs > elapsedMs) {
      setElapsedMs(health.acknowledgedMs);
    }
  }, [health?.acknowledgedMs]);

  // Only render if recording is active/paused/interrupted and the main dialog is minimized/closed
  const isVisible =
    (state === "recording" || state === "paused" || state === "interrupted") &&
    !activeRecordingOpen;

  if (!isVisible) return null;

  const savedThrough = health && health.acknowledgedMs > 0 ? formatDurationMs(health.acknowledgedMs) : null;
  const elapsedStr = formatDurationMs(elapsedMs);

  return (
    <div
      role="status"
      aria-label="Active recording status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-full bg-card/95 border border-border shadow-xl backdrop-blur-md text-xs font-medium text-foreground transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
    >
      <span
        className={cn(
          "w-2.5 h-2.5 rounded-full shrink-0",
          state === "recording" && "bg-destructive animate-pulse",
          state === "paused" && "bg-amber-500",
          state === "interrupted" && "bg-amber-500"
        )}
      />

      <div className="flex items-center gap-1.5 tabular-nums">
        <span className="font-semibold capitalize">
          {state === "recording" && t("recording.stateRecording", "Recording")}
          {state === "paused" && t("recording.statePaused", "Paused")}
          {state === "interrupted" && (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <WarningCircle className="w-3.5 h-3.5" />
              {t("recording.stateInterrupted", "Interrupted")}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">·</span>
        <span>{elapsedStr}</span>
        {savedThrough && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {t("recording.savedThrough", "Saved through")} {savedThrough}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setActiveRecordingOpen(true)}
        className="ml-1 flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground font-semibold rounded-full hover:bg-primary/90 transition-colors text-xs min-h-[32px]"
      >
        <span>{t("recording.open", "Open")}</span>
        <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
